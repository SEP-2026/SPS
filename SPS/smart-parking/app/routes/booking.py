import math
import re
from datetime import datetime, timezone
import os
import unicodedata
import logging
from uuid import uuid4
from urllib.parse import quote_plus
from urllib.request import urlopen
import json

import qrcode

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Booking, ParkingLot, ParkingPrice, ParkingSlot, Payment, User, UserVehicle
from app.routes.auth import get_current_user
from app.services.wallet_service import (
    InsufficientWalletBalance,
    WalletError,
    get_wallet_summary,
    reserve_wallet_amount,
    settle_booking_payment,
)

logger = logging.getLogger(__name__)
router = APIRouter()
ACTIVE_BOOKING_STATUSES = ("pending", "booked", "checked_in")


class BookingCreateRequest(BaseModel):
    parking_id: int = Field(gt=0)
    slot_id: int = Field(gt=0)
    license_plate: str = Field(min_length=1, max_length=30)
    owner_name: str = Field(min_length=1, max_length=255)
    vehicle_type: str | None = Field(default=None, max_length=50)
    brand: str | None = Field(default=None, max_length=100)
    vehicle_model: str | None = Field(default=None, max_length=100)
    seat_count: int | None = Field(default=None, ge=1, le=99)
    vehicle_color: str | None = Field(default=None, max_length=50)
    booking_mode: str = Field(default="hourly", max_length=20)
    month_count: int | None = Field(default=None, ge=1, le=24)
    checkin_time: datetime
    checkout_time: datetime | None = None


def _normalize_text(value: str) -> str:
    plain = unicodedata.normalize("NFD", value)
    plain = "".join(ch for ch in plain if unicodedata.category(ch) != "Mn")
    return plain.lower().strip()


def _local_geocode_fallback(address: str):
    normalized = _normalize_text(address)
    candidates = {
        "nguyen van sang": (10.7910, 106.6255),
        "tan ky tan quy": (10.7932, 106.6250),
        "luy ban bich": (10.7818, 106.6364),
        "au co": (10.7864, 106.6402),
        "truong chinh": (10.8031, 106.6287),
        "tan phu": (10.7910, 106.6255),
    }
    for key, point in candidates.items():
        if key in normalized:
            return point
    return None


def geocode_address(address: str):
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    encoded_address = quote_plus(address)

    if api_key:
        geocode_url = (
            "https://maps.googleapis.com/maps/api/geocode/json"
            f"?address={encoded_address}&key={api_key}"
        )

        try:
            with urlopen(geocode_url, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
            results = payload.get("results", [])
            status = payload.get("status")
            if status == "OK" and results:
                location = results[0]["geometry"]["location"]
                return float(location["lat"]), float(location["lng"])
        except Exception:
            pass

    # Fallback khi chưa cấu hình Google API key hoặc Google API không phản hồi.
    nominatim_url = (
        "https://nominatim.openstreetmap.org/search"
        f"?q={encoded_address}&format=json&limit=1"
    )
    try:
        req_headers = {"User-Agent": "smart-parking-app/1.0"}
        from urllib.request import Request

        req = Request(nominatim_url, headers=req_headers)
        with urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=502, detail="Không gọi được dịch vụ geocoding")

    if payload:
        return float(payload[0]["lat"]), float(payload[0]["lon"])

    local_point = _local_geocode_fallback(address)
    if local_point:
        return local_point

    raise HTTPException(status_code=404, detail="Không tìm thấy tọa độ cho địa chỉ đã nhập")


@router.get("/slots")
def get_slots(parking_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(ParkingSlot)
    if parking_id is not None:
        query = query.filter(ParkingSlot.parking_id == parking_id)

    slots = query.all()
    return slots


@router.get("/search-parking")
def search_parking(
    address: str,
    limit: int = 5,
    sort_by: str = "nearest",
    covered_only: bool = False,
    db: Session = Depends(get_db),
):
    if not address or not address.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập địa điểm")

    safe_limit = max(1, min(limit, 20))
    lat, lng = geocode_address(address.strip())

    order_by = "distance ASC"
    if sort_by == "cheapest":
        order_by = "pr.price_per_hour ASC, distance ASC"

    covered_sql = "AND p.has_roof = 1" if covered_only else ""

    query = text(
        f"""
        SELECT
            p.id,
            p.name,
            p.address,
            p.latitude,
            p.longitude,
            p.has_roof,
            pr.price_per_hour,
            pr.price_per_day,
            pr.price_per_month,
            (
                6371 * ACOS(
                    COS(RADIANS(:lat))
                    * COS(RADIANS(p.latitude))
                    * COS(RADIANS(p.longitude) - RADIANS(:lng))
                    + SIN(RADIANS(:lat))
                    * SIN(RADIANS(p.latitude))
                )
            ) AS distance
        FROM parking_lots p
        JOIN parking_prices pr ON p.id = pr.parking_id
                WHERE p.is_active = 1
                    AND p.latitude IS NOT NULL
                    AND p.longitude IS NOT NULL
                    {covered_sql}
        ORDER BY {order_by}
        LIMIT :limit
        """
    )

    rows = db.execute(query, {"lat": lat, "lng": lng, "limit": safe_limit}).mappings().all()

    return {
        "query": address,
        "center": {"lat": lat, "lng": lng},
        "nearest": [
            {
                **dict(row),
                "distance": round(float(row["distance"] or 0), 3),
            }
            for row in rows
        ],
    }


@router.get("/search-parking-by-coords")
def search_parking_by_coords(
    lat: float,
    lng: float,
    limit: int = 5,
    sort_by: str = "nearest",
    covered_only: bool = False,
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 20))

    order_by = "distance ASC"
    if sort_by == "cheapest":
        order_by = "pr.price_per_hour ASC, distance ASC"

    covered_sql = "AND p.has_roof = 1" if covered_only else ""

    query = text(
        f"""
        SELECT
            p.id,
            p.name,
            p.address,
            p.latitude,
            p.longitude,
            p.has_roof,
            pr.price_per_hour,
            pr.price_per_day,
            pr.price_per_month,
            (
                6371 * ACOS(
                    COS(RADIANS(:lat))
                    * COS(RADIANS(p.latitude))
                    * COS(RADIANS(p.longitude) - RADIANS(:lng))
                    + SIN(RADIANS(:lat))
                    * SIN(RADIANS(p.latitude))
                )
            ) AS distance
        FROM parking_lots p
        JOIN parking_prices pr ON p.id = pr.parking_id
        WHERE p.is_active = 1
          AND p.latitude IS NOT NULL
          AND p.longitude IS NOT NULL
          {covered_sql}
        ORDER BY {order_by}
        LIMIT :limit
        """
    )

    rows = db.execute(query, {"lat": lat, "lng": lng, "limit": safe_limit}).mappings().all()

    return {
        "query": "current_location",
        "center": {"lat": lat, "lng": lng},
        "nearest": [
            {
                **dict(row),
                "distance": round(float(row["distance"] or 0), 3),
            }
            for row in rows
        ],
    }


def _ensure_qr_directory() -> None:
    os.makedirs("qrcodes", exist_ok=True)


def _save_booking_qr(content: str, file_path: str) -> None:
    _ensure_qr_directory()
    image = qrcode.make(content)
    image.save(file_path)


def _validate_booking_window(checkin_time: datetime, checkout_time: datetime) -> None:
    now = datetime.utcnow()
    if checkin_time >= checkout_time:
        raise HTTPException(status_code=400, detail="Thời gian vào phải nhỏ hơn thời gian ra")
    if checkin_time < now:
        raise HTTPException(status_code=400, detail="Thời gian vào phải lớn hơn thời gian hiện tại")


def _to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _normalize_booking_mode(value: str | None) -> str:
    mode = (value or "hourly").strip().lower()
    if mode not in {"hourly", "daily", "monthly"}:
        raise HTTPException(status_code=400, detail="booking_mode chỉ hỗ trợ: hourly, daily, monthly")
    return mode


def _add_months(start: datetime, months: int) -> datetime:
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    month_lengths = [
        31,
        29
        if (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
        else 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ]
    day = min(start.day, month_lengths[month - 1])
    return start.replace(year=year, month=month, day=day)


def _resolve_checkout_time(payload: BookingCreateRequest, booking_mode: str) -> datetime:
    if booking_mode == "monthly":
        if payload.month_count is None:
            raise HTTPException(status_code=400, detail="Vui lòng nhập số tháng khi đặt theo tháng")
        return _add_months(payload.checkin_time, payload.month_count)

    if payload.checkout_time is None:
        raise HTTPException(status_code=400, detail="Vui lòng chọn thời gian checkout")
    return payload.checkout_time


def _calculate_booking_amount(
    booking_mode: str,
    checkin_time: datetime,
    checkout_time: datetime,
    parking_price: ParkingPrice,
    month_count: int | None,
) -> dict:
    duration_hours = (checkout_time - checkin_time).total_seconds() / 3600

    if booking_mode == "monthly":
        billed_units = float(month_count or 1)
        unit_price = float(parking_price.price_per_month)
        return {
            "resolved_mode": "monthly",
            "billed_unit": "month",
            "billed_units": billed_units,
            "unit_price": unit_price,
            "total_amount": billed_units * unit_price,
            "duration_hours": duration_hours,
        }

    if booking_mode == "daily":
        billed_units = float(max(1, math.ceil(duration_hours / 24)))
        unit_price = float(parking_price.price_per_day)
        return {
            "resolved_mode": "daily",
            "billed_unit": "day",
            "billed_units": billed_units,
            "unit_price": unit_price,
            "total_amount": billed_units * unit_price,
            "duration_hours": duration_hours,
        }

    if duration_hours > 12:
        billed_units = 1.0
        unit_price = float(parking_price.price_per_day)
        return {
            "resolved_mode": "daily",
            "billed_unit": "day",
            "billed_units": billed_units,
            "unit_price": unit_price,
            "total_amount": billed_units * unit_price,
            "duration_hours": duration_hours,
            "auto_converted": True,
        }

    billed_units = float(max(1, math.ceil(duration_hours)))
    unit_price = float(parking_price.price_per_hour)
    return {
        "resolved_mode": "hourly",
        "billed_unit": "hour",
        "billed_units": billed_units,
        "unit_price": unit_price,
        "total_amount": billed_units * unit_price,
        "duration_hours": duration_hours,
    }


def _create_booking_qr_content(booking: Booking, slot: ParkingSlot, user: User) -> str:
    qr_payload = {
        "qr_type": "parking_access",
        "actions": ["check_in", "check_out"],
        "booking_id": booking.id,
        "user_id": user.id,
        "parking_id": booking.parking_lot_id,
        "slot_id": slot.id,
        "license_plate": user.vehicle_plate or "",
        "checkin_time": booking.start_time.isoformat() if booking.start_time else None,
        "checkout_time": booking.expire_time.isoformat() if booking.expire_time else None,
    }
    return json.dumps(qr_payload, ensure_ascii=False, separators=(",", ":"))


def _extract_seat_count(vehicle_type: str | None) -> int | None:
    if not vehicle_type:
        return None
    match = re.search(r"(\d+)", vehicle_type)
    if not match:
        return None
    value = int(match.group(1))
    return value if value > 0 else None


def _extract_vehicle_model(vehicle_type: str | None) -> str | None:
    if not vehicle_type:
        return None
    if "-" in vehicle_type:
        return vehicle_type.split("-", 1)[0].strip() or None
    return vehicle_type.strip() or None


def _serialize_booking_response(
    booking: Booking,
    slot: ParkingSlot,
    parking_lot: ParkingLot,
    vehicle: dict,
    billing: dict,
    booking_mode: str,
    month_count: int | None,
    existing_pending_booking: bool = False,
    wallet: dict | None = None,
) -> dict:
    return {
        "message": "Booking created successfully" if not existing_pending_booking else "Đã có booking pending, vui lòng kiểm tra lại",
        "booking_id": booking.id,
        "booking_status": booking.status,
        "qr_code": booking.qr_code,
        "parking": {
            "id": parking_lot.id,
            "name": parking_lot.name,
            "address": parking_lot.address,
        },
        "slot": {
            "id": slot.id,
            "code": slot.code,
        },
        "vehicle": vehicle,
        "billing": billing,
        "booking_mode": booking_mode,
        "month_count": month_count,
        "total_amount": booking.total_amount,
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
        "payment_required": booking.status == "pending",
        "existing_pending_booking": existing_pending_booking,
        "wallet": wallet,
    }


@router.get("/booking/my/{booking_id}")
def get_my_booking_detail(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem booking này")

    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_lot_id).first()
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first()
    vehicle_profile = db.query(UserVehicle).filter(UserVehicle.user_id == current_user.id).first()

    payment_required = booking.status == "pending"

    # Compute upfront amount (30% of total) and potential overtime info
    total_amount = float(booking.total_amount or 0)
    upfront_amount = round(total_amount * 0.3, 2)

    overtime_fee = 0.0
    overtime_hours = 0.0
    try:
        now = datetime.utcnow()
        if booking.expire_time and now > booking.expire_time:
            extra_hours = (now - booking.expire_time).total_seconds() / 3600
            price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_lot_id).first()
            if price and extra_hours > 0:
                overtime_hours = round(extra_hours, 2)
                overtime_fee = round(max(0, extra_hours) * float(price.price_per_hour), 2)
    except Exception:
        # Fail gracefully; leave overtime as zero
        overtime_fee = 0.0
        overtime_hours = 0.0

    return {
        "booking_id": booking.id,
        "booking_status": booking.status,
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
        "booking_mode": booking.booking_mode,
        "billed_units": booking.billed_units,
        "total_amount": total_amount,
        "upfront_amount": upfront_amount,
        "overtime_fee": overtime_fee,
        "overtime_hours": overtime_hours,
        "qr_code": booking.qr_code,
        "qr_url": booking.qr_code,
        "payment_required": payment_required,
        "wallet": get_wallet_summary(db, current_user.id),
        "parking": {
            "id": parking_lot.id if parking_lot else None,
            "name": parking_lot.name if parking_lot else None,
            "address": parking_lot.address if parking_lot else None,
        },
        "slot": {
            "id": slot.id if slot else None,
            "code": slot.code if slot else None,
        },
        "vehicle": {
            "owner_name": current_user.name,
            "phone": current_user.phone,
            "license_plate": current_user.vehicle_plate,
            "vehicle_color": current_user.vehicle_color,
            "brand": vehicle_profile.brand if vehicle_profile else None,
            "vehicle_model": vehicle_profile.vehicle_model if vehicle_profile else None,
            "seat_count": vehicle_profile.seat_count if vehicle_profile else None,
        },
    }


@router.post("/booking/create")
def create_booking(
    payload: BookingCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        booking_mode = _normalize_booking_mode(payload.booking_mode)
        normalized_checkin_time = _to_utc_naive(payload.checkin_time)
        resolved_checkout_time = _resolve_checkout_time(payload, booking_mode)
        normalized_checkout_time = _to_utc_naive(resolved_checkout_time)
        _validate_booking_window(normalized_checkin_time, normalized_checkout_time)

        parking_lot = (
            db.query(ParkingLot)
            .filter(ParkingLot.id == payload.parking_id, ParkingLot.is_active == 1)
            .first()
        )
        if not parking_lot:
            raise HTTPException(status_code=404, detail="Bãi xe không tồn tại")

        parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == parking_lot.id).first()
        if not parking_price:
            raise HTTPException(status_code=400, detail="Bãi xe chưa được cấu hình bảng giá")

        billing = _calculate_booking_amount(
            booking_mode=booking_mode,
            checkin_time=normalized_checkin_time,
            checkout_time=normalized_checkout_time,
            parking_price=parking_price,
            month_count=payload.month_count,
        )

        user = db.query(User).filter(User.id == current_user.id).with_for_update().first()
        if not user:
            raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

        normalized_license_plate = payload.license_plate.strip().upper()
        if not normalized_license_plate:
            raise HTTPException(status_code=400, detail="Biển số xe không hợp lệ")

        active_vehicle_booking = (
            db.query(Booking.id)
            .join(User, User.id == Booking.user_id)
            .filter(
                Booking.user_id != user.id,
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
                User.vehicle_plate.isnot(None),
                func.upper(func.trim(User.vehicle_plate)) == normalized_license_plate,
            )
            .order_by(Booking.created_at.desc(), Booking.id.desc())
            .first()
        )
        if active_vehicle_booking:
            raise HTTPException(
                status_code=400,
                detail="Biển số xe này đã có booking chưa hoàn tất. Không thể đặt thêm bãi khác trước khi booking hiện tại kết thúc.",
            )

        vehicle_profile = (
            db.query(UserVehicle)
            .filter(UserVehicle.user_id == user.id)
            .with_for_update()
            .first()
        )
        if not vehicle_profile:
            vehicle_profile = UserVehicle(user_id=user.id)
            db.add(vehicle_profile)

        resolved_vehicle_model = (
            payload.vehicle_model.strip()
            if payload.vehicle_model and payload.vehicle_model.strip()
            else _extract_vehicle_model(payload.vehicle_type)
        )
        resolved_seat_count = payload.seat_count or _extract_seat_count(payload.vehicle_type)

        active_booking = (
            db.query(Booking)
            .filter(
                Booking.user_id == user.id,
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            )
            .order_by(Booking.created_at.desc(), Booking.id.desc())
            .first()
        )
        if active_booking:
            raise HTTPException(
                status_code=400,
                detail="Bạn đã có booking chưa hoàn tất. Vui lòng hủy booking hiện tại hoặc checkout xong rồi đặt bãi khác.",
            )

        slot = (
            db.query(ParkingSlot)
            .filter(
                ParkingSlot.id == payload.slot_id,
                ParkingSlot.parking_id == payload.parking_id,
            )
            .with_for_update()
            .first()
        )
        if not slot:
            raise HTTPException(status_code=404, detail="Slot không tồn tại")

        if slot.status != "available":
            raise HTTPException(status_code=400, detail="Slot đã được đặt hoặc không còn trống")

        overlapping_slot_booking = (
            db.query(Booking)
            .filter(
                Booking.slot_id == slot.id,
                Booking.status.in_(["pending", "booked", "checked_in"]),
                Booking.start_time < normalized_checkout_time,
                Booking.expire_time > normalized_checkin_time,
            )
            .first()
        )
        if overlapping_slot_booking:
            raise HTTPException(status_code=400, detail="Slot đã được đặt trong khung giờ này")

        user.vehicle_plate = normalized_license_plate
        vehicle_profile.license_plate = user.vehicle_plate
        if payload.vehicle_color and payload.vehicle_color.strip():
            user.vehicle_color = payload.vehicle_color.strip()
            vehicle_profile.vehicle_color = user.vehicle_color
        if payload.brand and payload.brand.strip():
            vehicle_profile.brand = payload.brand.strip()
        if resolved_vehicle_model:
            vehicle_profile.vehicle_model = resolved_vehicle_model
        if resolved_seat_count is not None:
            vehicle_profile.seat_count = resolved_seat_count
        if payload.owner_name.strip() and not user.name:
            user.name = payload.owner_name.strip()

        booking = Booking(
            user_id=user.id,
            slot_id=slot.id,
            parking_id=parking_lot.id,
            parking_lot_id=parking_lot.id,
            start_time=normalized_checkin_time,
            expire_time=normalized_checkout_time,
            booking_mode=billing["resolved_mode"],
            billed_units=billing["billed_units"],
            total_amount=billing["total_amount"],
            status="pending",
            # Keep a unique placeholder before QR image is generated to satisfy DB unique constraint.
            qr_code=f"pending://{uuid4()}",
        )

        db.add(booking)
        db.flush()

        reserved_amount = round(float(billing["total_amount"] or 0) * 0.3, 2)
        remaining_amount = round(float(billing["total_amount"] or 0) - reserved_amount, 2)
        if reserved_amount > 0:
            reserve_wallet_amount(
                db=db,
                user_id=user.id,
                amount=reserved_amount,
                reference_type="booking",
                reference_id=booking.id,
                note=f"Giữ 30% cho booking #{booking.id}",
            )

        booking.status = "booked"

        qr_content = _create_booking_qr_content(booking, slot, user)
        qr_path = f"qrcodes/booking_{booking.id}.png"
        _save_booking_qr(qr_content, qr_path)

        booking.qr_code = qr_path
        slot.status = "reserved"

        db.commit()
        db.refresh(booking)
        db.refresh(slot)

        return _serialize_booking_response(
            booking=booking,
            slot=slot,
            parking_lot=parking_lot,
            vehicle={
                "owner_name": payload.owner_name.strip(),
                "phone": user.phone,
                "license_plate": user.vehicle_plate,
                "vehicle_color": user.vehicle_color,
                "vehicle_type": payload.vehicle_type,
                "brand": vehicle_profile.brand,
                "vehicle_model": vehicle_profile.vehicle_model,
                "seat_count": vehicle_profile.seat_count,
            },
            billing={
                "requested_mode": booking_mode,
                "resolved_mode": billing["resolved_mode"],
                "billed_unit": billing["billed_unit"],
                "billed_units": billing["billed_units"],
                "unit_price": billing["unit_price"],
                "duration_hours": round(billing["duration_hours"], 2),
                "auto_converted_to_daily": bool(billing.get("auto_converted", False)),
                "total_amount": billing["total_amount"],
            },
            booking_mode=booking.booking_mode,
            month_count=payload.month_count,
            wallet=get_wallet_summary(db, user.id),
        )
    except (WalletError, InsufficientWalletBalance) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.post("/check-in")
def check_in(booking_id: int, db: Session = Depends(get_db)):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking không tồn tại")

    if booking.status == "pending":
        raise HTTPException(status_code=400, detail="Booking chưa được thanh toán")

    if booking.status != "booked":
        raise HTTPException(status_code=400, detail="Booking không hợp lệ")

    booking.status = "checked_in"
    booking.start_time = datetime.utcnow()
    if booking.slot:
        booking.slot.status = "occupied"

    db.commit()

    return {"message": "Check-in thành công"}


@router.post("/check-out")
def check_out(booking_id: int, db: Session = Depends(get_db)):
    logger.info(f"[CHECKOUT] Starting checkout for booking_id={booking_id}")
    
    booking = db.query(Booking).filter(Booking.id == booking_id).first()

    if not booking:
        logger.error(f"[CHECKOUT] Booking not found: {booking_id}")
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    logger.info(f"[CHECKOUT] Booking status: {booking.status}, user_id: {booking.user_id}, total_amount: {booking.total_amount}")
    
    if booking.status not in ["checked_in", "booked"]:
        logger.error(f"[CHECKOUT] Invalid status for checkout: {booking.status}")
        raise HTTPException(status_code=400, detail=f"Booking ở trạng thái {booking.status}, không thể checkout")

    actual_checkout = datetime.utcnow()
    overtime_fee = 0.0

    if booking.expire_time and actual_checkout > booking.expire_time:
        extra_hours = (actual_checkout - booking.expire_time).total_seconds() / 3600
        price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_lot_id).first()
        if price:
            overtime_fee = round(max(0, extra_hours) * float(price.price_per_hour), 2)
            logger.info(f"[CHECKOUT] Overtime detected: {extra_hours:.2f} hours, fee: {overtime_fee}")

    reserved_amount = round(float(booking.total_amount or 0) * 0.3, 2)
    base_remaining = round(float(booking.total_amount or 0) - reserved_amount, 2)
    remaining_amount = round(base_remaining + overtime_fee, 2)
    
    logger.info(f"[CHECKOUT] Payment breakdown - total: {booking.total_amount}, reserved: {reserved_amount}, remaining: {remaining_amount}, overtime: {overtime_fee}")

    # Check wallet before settle
    wallet_before = get_wallet_summary(db, booking.user_id)
    logger.info(f"[CHECKOUT] Wallet BEFORE settle - balance: {wallet_before.get('balance')}, reserved: {wallet_before.get('reserved_balance')}")

    try:
        logger.info(f"[CHECKOUT] Calling settle_booking_payment with reserved={reserved_amount}, capture={remaining_amount}")
        settle_result = settle_booking_payment(
            db=db,
            user_id=booking.user_id,
            reserved_amount=reserved_amount,
            capture_amount=remaining_amount,
            reference_type="booking",
            reference_id=booking.id,
            note=f"Chốt thanh toán booking #{booking.id}",
        )
        logger.info(f"[CHECKOUT] settle_booking_payment returned: {settle_result}")
    except (WalletError, InsufficientWalletBalance) as exc:
        logger.error(f"[CHECKOUT] Wallet error during settle: {str(exc)}")
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Lỗi thanh toán: {str(exc)}") from exc
    except Exception as exc:
        logger.error(f"[CHECKOUT] Unexpected error during settle: {str(exc)}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi hệ thống: {str(exc)}") from exc

    booking.status = "completed"
    if booking.slot:
        booking.slot.status = "available"

    db.commit()
    logger.info(f"[CHECKOUT] Booking #{booking.id} marked as completed and committed to DB")

    # Check wallet after settle
    wallet_after = get_wallet_summary(db, booking.user_id)
    logger.info(f"[CHECKOUT] Wallet AFTER settle - balance: {wallet_after.get('balance')}, reserved: {wallet_after.get('reserved_balance')}")

    return {
        "message": "Check-out thành công",
        "booking_id": booking.id,
        "booking_status": booking.status,
        "overtime_fee": overtime_fee,
        "total_paid": round(float(booking.total_amount or 0) + overtime_fee, 2),
        "wallet": wallet_after,
    }
