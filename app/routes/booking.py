import math
import re
from datetime import datetime, timedelta, timezone
import os
import unicodedata
from urllib.parse import quote_plus
from urllib.request import urlopen
import json
import logging
from uuid import uuid4

import qrcode

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database import get_db
from app.models.models import Booking, District, ParkingLot, ParkingPrice, ParkingSlot, Payment, User, UserVehicle
from app.routes.auth import get_current_user
from app.services.qr_service import invalidate_booking_qr_code
from app.services.wallet_service import get_wallet_summary, settle_booking_payment, WalletError, InsufficientWalletBalance
from app.utils.timezone import ensure_vn_local_naive, vn_now

router = APIRouter()
VN_TZ = timezone(timedelta(hours=7))
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


class BookingUpdateRequest(BaseModel):
    slot_id: int | None = Field(default=None, gt=0)
    booking_mode: str | None = Field(default=None, max_length=20)
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


def _overview_slot_status(raw_status: str | None, booking_statuses: set[str]) -> str:
    normalized = (raw_status or "").lower()
    if normalized == "maintenance":
        return "maintenance"
    if booking_statuses.intersection({"pending", "booked", "checked_in"}):
        return "occupied"
    if normalized in {"reserved", "occupied", "in_use"}:
        return "occupied"
    return "available"


@router.get("/slots")
def get_slots(parking_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(ParkingSlot)
    if parking_id is not None:
        query = query.filter(ParkingSlot.parking_id == parking_id)

    slots = query.all()
    return slots


@router.get("/parking-lots/slots-overview")
def get_parking_lots_slots_overview(db: Session = Depends(get_db)):
    lots = db.query(ParkingLot).filter(ParkingLot.is_active == 1).order_by(ParkingLot.id.asc()).all()

    slot_rows = (
        db.query(ParkingSlot)
        .order_by(ParkingSlot.parking_id.asc(), ParkingSlot.slot_number.asc(), ParkingSlot.code.asc())
        .all()
    )

    slots_by_parking: dict[int, list[ParkingSlot]] = {}
    for slot in slot_rows:
        if slot.parking_id is None:
            continue
        slots_by_parking.setdefault(slot.parking_id, []).append(slot)

    active_bookings = (
        db.query(Booking)
        .filter(Booking.status.in_(["pending", "booked", "checked_in"]))
        .all()
    )
    booking_statuses_by_slot: dict[int, set[str]] = {}
    for booking in active_bookings:
        if not booking.slot_id:
            continue
        booking_statuses_by_slot.setdefault(int(booking.slot_id), set()).add((booking.status or "").lower())

    result = []
    for lot in lots:
        lot_slots = slots_by_parking.get(lot.id, [])
        effective_slots = [
            {
                "id": slot.id,
                "code": slot.slot_number or slot.code,
                "status": _overview_slot_status(slot.status, booking_statuses_by_slot.get(int(slot.id), set())),
            }
            for slot in lot_slots
        ]
        available_count = sum(1 for slot in effective_slots if slot["status"] == "available")
        occupied_count = len(lot_slots) - available_count

        result.append(
            {
                "parking_id": lot.id,
                "parking_name": lot.name,
                "parking_address": lot.address,
                "avg_rating": float(lot.avg_rating or 0),
                "review_count": int(lot.review_count or 0),
                "district": lot.district.name if lot.district else None,
                "available_slots": available_count,
                "occupied_or_reserved_slots": occupied_count,
                "total_slots": len(lot_slots),
                "slots": effective_slots,
            }
        )

    return result


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
            d.name AS district,
            p.latitude,
            p.longitude,
            p.has_roof,
            p.avg_rating,
            p.review_count,
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
        LEFT JOIN districts d ON d.id = p.district_id
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
            d.name AS district,
            p.latitude,
            p.longitude,
            p.has_roof,
            p.avg_rating,
            p.review_count,
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
                LEFT JOIN districts d ON d.id = p.district_id
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


@router.get("/parking-lots/{parking_id}")
def get_parking_lot_detail(parking_id: int, db: Session = Depends(get_db)):
    parking_lot = (
        db.query(ParkingLot)
        .filter(ParkingLot.id == parking_id, ParkingLot.is_active == 1)
        .first()
    )
    if not parking_lot:
        raise HTTPException(status_code=404, detail="Không tìm thấy bãi xe")

    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == parking_id).first()

    return {
        "id": parking_lot.id,
        "name": parking_lot.name,
        "address": parking_lot.address,
        "district": parking_lot.district.name if parking_lot.district else None,
        "latitude": parking_lot.latitude,
        "longitude": parking_lot.longitude,
        "has_roof": bool(parking_lot.has_roof),
        "avg_rating": float(parking_lot.avg_rating or 0),
        "review_count": int(parking_lot.review_count or 0),
        "price_per_hour": float(parking_price.price_per_hour or 0) if parking_price else 0,
        "price_per_day": float(parking_price.price_per_day or 0) if parking_price else 0,
        "price_per_month": float(parking_price.price_per_month or 0) if parking_price else 0,
    }


@router.get("/owner/parking-lots")
def get_owner_parking_lots(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Chỉ owner mới được xem danh sách bãi theo quận quản lý")

    if not current_user.managed_district_id:
        raise HTTPException(status_code=400, detail="Owner chưa được gán quận quản lý")

    district = db.query(District).filter(District.id == current_user.managed_district_id).first()
    if not district:
        raise HTTPException(status_code=400, detail="Quận quản lý của owner không hợp lệ")

    lots = (
        db.query(ParkingLot)
        .filter(
            ParkingLot.is_active == 1,
            ParkingLot.district_id == district.id,
        )
        .order_by(ParkingLot.id.asc())
        .all()
    )

    return lots


def _ensure_qr_directory() -> None:
    os.makedirs("qrcodes", exist_ok=True)


def _save_booking_qr(content: str, file_path: str) -> None:
    _ensure_qr_directory()
    image = qrcode.make(content)
    image.save(file_path)


def _validate_booking_window(checkin_time: datetime, checkout_time: datetime) -> None:
    now = vn_now()
    if checkin_time >= checkout_time:
        raise HTTPException(status_code=400, detail="Thời gian vào phải nhỏ hơn thời gian ra")
    if checkin_time < now:
        raise HTTPException(status_code=400, detail="Thời gian vào phải lớn hơn thời gian hiện tại")


def _to_utc_naive(value: datetime) -> datetime:
    return ensure_vn_local_naive(value)


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
        "parking_id": booking.parking_id,
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


def _format_vi_datetime(value: datetime | None) -> str:
    if value is None:
        return "N/A"
    return value.strftime("%d/%m/%Y %H:%M")


def _booking_status_label(value: str | None) -> str:
    mapping = {
        "pending": "chờ thanh toán",
        "booked": "chưa check-in",
        "checked_in": "đang check-in",
    }
    return mapping.get((value or "").lower(), value or "không rõ")


def _build_active_booking_error_message(
    license_plate: str,
    existing_booking: Booking,
    parking_name: str | None,
) -> str:
    start_text = _format_vi_datetime(existing_booking.start_time)
    end_text = _format_vi_datetime(existing_booking.expire_time)
    parking_text = f" tại bãi {parking_name}" if parking_name else ""
    status_text = _booking_status_label(existing_booking.status)

    return (
        f"Xe biển số {license_plate} đang có booking #{existing_booking.id} "
        f"({status_text}) từ {start_text} đến {end_text}{parking_text}. "
        "Mỗi tài khoản/biển số chỉ được có 1 booking chưa checkout. "
        "Vui lòng hủy booking hiện tại hoặc checkout xong rồi đặt bãi khác."
    )


def _build_overlap_error_message(
    license_plate: str,
    existing_booking: Booking,
    parking_name: str | None,
) -> str:
    start_text = _format_vi_datetime(existing_booking.start_time)
    end_text = _format_vi_datetime(existing_booking.expire_time)
    parking_text = f" tại bãi {parking_name}" if parking_name else ""

    return (
        "Bạn đã booking trùng. "
        f"Xe biển số {license_plate} đã có booking từ {start_text} đến {end_text}{parking_text}. "
        "Bạn không thể tạo booking mới trong khoảng thời gian bị trùng. "
        "Vui lòng chọn 1 trong 3 cách: giữ booking cũ, chỉnh sửa booking cũ, hoặc hủy booking cũ rồi đặt lại."
    )


def _serialize_conflicting_booking(booking: Booking, db: Session) -> dict:
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first()
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first()
    user = db.query(User).filter(User.id == booking.user_id).first()

    return {
        "booking_id": booking.id,
        "parking_id": booking.parking_id,
        "parking_name": parking_lot.name if parking_lot else None,
        "slot_id": booking.slot_id,
        "slot_code": slot.code if slot else None,
        "license_plate": user.vehicle_plate if user else None,
        "checkin_time": booking.start_time.isoformat() if booking.start_time else None,
        "checkout_time": booking.expire_time.isoformat() if booking.expire_time else None,
        "status": booking.status,
    }


def _build_overlap_error_detail(
    license_plate: str,
    existing_booking: Booking,
    parking_name: str | None,
    db: Session,
    payload: BookingCreateRequest,
    normalized_checkin_time: datetime,
    normalized_checkout_time: datetime,
    billing: dict,
    reason: str = "overlap_booking",
    message: str | None = None,
) -> dict:
    return {
        "message": message or _build_overlap_error_message(license_plate, existing_booking, parking_name),
        "reason": reason,
        "conflicting_booking": _serialize_conflicting_booking(existing_booking, db),
        "requested_booking": {
            "parking_id": payload.parking_id,
            "slot_id": payload.slot_id,
            "license_plate": license_plate,
            "checkin_time": normalized_checkin_time.isoformat(),
            "checkout_time": normalized_checkout_time.isoformat(),
            "booking_mode": billing["resolved_mode"],
            "estimated_total_amount": billing["total_amount"],
        },
        "suggested_actions": [
            "keep_old_booking",
            "edit_old_booking",
            "cancel_old_and_rebook",
        ],
    }


def _serialize_booking_response(
    booking: Booking,
    slot: ParkingSlot,
    parking_lot: ParkingLot,
    vehicle: dict,
    billing: dict,
    booking_mode: str,
    month_count: int | None,
    existing_pending_booking: bool = False,
) -> dict:
    return {
        "message": "Booking created successfully" if not existing_pending_booking else "Đã có booking pending, chuyển sang thanh toán",
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
            "code": slot.slot_number or slot.code,
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
    }


def _to_vn_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    normalized = ensure_vn_local_naive(dt)
    return normalized.replace(tzinfo=VN_TZ)


def calculate_checkout_fee(booking: Booking, checkout_time: datetime, price_per_hour: float) -> dict:
    actual_checkin = _to_vn_aware(booking.actual_checkin)
    expected_checkout = _to_vn_aware(booking.expire_time)
    checkout_at = _to_vn_aware(checkout_time)
    if actual_checkin is None or expected_checkout is None or checkout_at is None:
        raise HTTPException(status_code=400, detail="Thiếu dữ liệu check-in hoặc checkout dự kiến để tính phí")

    actual_minutes = max((checkout_at - actual_checkin).total_seconds() / 60, 0)
    expected_minutes = max((expected_checkout - actual_checkin).total_seconds() / 60, 0)
    overstay_minutes = max(0, actual_minutes - expected_minutes)
    overstay_hours_billed = math.ceil(overstay_minutes / 60) if overstay_minutes > 0 else 0

    original_fee = float(booking.total_amount or 0)
    hourly_price = float(price_per_hour or 0)
    overstay_fee = round(overstay_hours_billed * hourly_price, 2)
    total_actual_fee = round(original_fee + overstay_fee, 2)
    is_early = checkout_at < expected_checkout

    return {
        "actual_duration_minutes": int(round(actual_minutes)),
        "expected_duration_minutes": int(round(expected_minutes)),
        "overstay_minutes": int(round(overstay_minutes)),
        "overstay_hours_billed": overstay_hours_billed,
        "original_fee": round(original_fee, 2),
        "price_per_hour": round(hourly_price, 2),
        "overstay_fee": overstay_fee,
        "total_actual_fee": total_actual_fee,
        "is_overstay": overstay_minutes > 0,
        "is_early": is_early,
        "refund_amount": 0,
    }


def _build_checkout_breakdown(fee: dict) -> list[dict]:
    rows = [{"label": "Phí đặt chỗ gốc", "amount": fee["original_fee"]}]
    if fee["overstay_fee"] > 0:
        rows.append(
            {
                "label": f"Phí quá giờ ({fee['overstay_hours_billed']} giờ x {int(fee['price_per_hour']):,}đ)",
                "amount": fee["overstay_fee"],
            }
        )
        rows.append({"label": "TỔNG CỘNG", "amount": fee["total_actual_fee"]})
    return rows


def _assert_checkout_allowed(booking: Booking) -> None:
    if booking.status == "checked_in":
        return
    if booking.status in {"pending", "booked"}:
        raise HTTPException(status_code=400, detail="Xe chưa check-in")
    if booking.status in {"checked_out", "completed"}:
        raise HTTPException(status_code=400, detail="Xe đã checkout rồi")
    raise HTTPException(status_code=400, detail=f"Booking ở trạng thái {booking.status}, không thể checkout")


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

    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first()
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first()
    vehicle_profile = db.query(UserVehicle).filter(UserVehicle.user_id == current_user.id).first()

    payment_required = booking.status == "pending"
    from app.services.owner_booking_config import deposit_ratio, get_parking_booking_config

    total_amount = round(float(booking.total_amount or 0), 2)
    config = get_parking_booking_config(db, booking.parking_id)
    ratio = deposit_ratio(config, booking.booking_mode)
    upfront_amount = round(total_amount * ratio, 2)
    remaining_amount = round(max(0.0, total_amount - upfront_amount), 2)

    return {
        "booking_id": booking.id,
        "booking_status": booking.status,
        "checkin_status": "checked_out" if booking.status in {"completed", "checked_out"} else booking.status,
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
        "actual_checkin": booking.actual_checkin,
        "actual_checkout": booking.actual_checkout,
        "booking_mode": booking.booking_mode,
        "billed_units": booking.billed_units,
        "total_amount": total_amount,
        "upfront_amount": upfront_amount,
        "remaining_amount": remaining_amount,
        "overstay_minutes": int(booking.overstay_minutes or 0),
        "overstay_fee": float(booking.overstay_fee or 0),
        "total_actual_fee": float(booking.total_actual_fee or booking.total_amount or 0),
        "is_reviewed": bool(booking.is_reviewed),
        "qr_code": booking.qr_code,
        "payment_required": payment_required,
        "parking": {
            "id": parking_lot.id if parking_lot else None,
            "name": parking_lot.name if parking_lot else None,
            "address": parking_lot.address if parking_lot else None,
        },
        "slot": {
            "id": slot.id if slot else None,
            "code": (slot.slot_number or slot.code) if slot else None,
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


@router.get("/booking/gate/{booking_id}")
def get_gate_booking_detail(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if current_user.role not in {"owner", "admin"} and booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem thông tin tại cổng")

    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first()
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first()
    user = db.query(User).filter(User.id == booking.user_id).first()
    payment = db.query(Payment).filter(Payment.booking_id == booking.id).first()

    return {
        "booking_id": booking.id,
        "booking_status": booking.status,
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
        "actual_checkin": booking.actual_checkin,
        "actual_checkout": booking.actual_checkout,
        "parking": {
            "id": parking_lot.id if parking_lot else None,
            "name": parking_lot.name if parking_lot else None,
            "address": parking_lot.address if parking_lot else None,
        },
        "slot": {
            "id": slot.id if slot else None,
            "code": (slot.slot_number or slot.code) if slot else None,
        },
        "vehicle": {
            "owner_name": user.name if user else None,
            "license_plate": user.vehicle_plate if user else None,
        },
        "payment": {
            "amount": payment.amount if payment else None,
            "overtime_fee": payment.overtime_fee if payment else 0,
            "payment_status": payment.payment_status if payment else None,
        },
    }


@router.get("/booking/my")
def get_my_bookings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bookings = (
        db.query(Booking)
        .filter(Booking.user_id == current_user.id)
        .order_by(Booking.created_at.desc(), Booking.id.desc())
        .all()
    )

    result = []
    for booking in bookings:
        parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first()
        slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first()

        result.append(
            {
                "booking_id": booking.id,
                "status": booking.status,
                "checkin_status": "checked_out" if booking.status in {"completed", "checked_out"} else booking.status,
                "booking_mode": booking.booking_mode,
                "checkin_time": booking.start_time,
                "checkout_time": booking.expire_time,
                "actual_checkin": booking.actual_checkin,
                "actual_checkout": booking.actual_checkout,
                "total_amount": booking.total_amount,
                "overstay_minutes": int(booking.overstay_minutes or 0),
                "overstay_fee": float(booking.overstay_fee or 0),
                "total_actual_fee": float(booking.total_actual_fee or booking.total_amount or 0),
                "is_reviewed": bool(booking.is_reviewed),
                "has_review": bool(booking.is_reviewed),
                "created_at": booking.created_at,
                "parking": {
                    "id": parking_lot.id if parking_lot else None,
                    "name": parking_lot.name if parking_lot else None,
                    "address": parking_lot.address if parking_lot else None,
                },
                "slot": {
                    "id": slot.id if slot else None,
                    "code": (slot.slot_number or slot.code) if slot else None,
                },
                "vehicle": {
                    "license_plate": current_user.vehicle_plate,
                },
            }
        )

    return result


@router.patch("/booking/my/{booking_id}")
def update_my_booking(
    booking_id: int,
    payload: BookingUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.user_id == current_user.id)
        .with_for_update()
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if booking.status not in ["pending", "booked"]:
        raise HTTPException(status_code=400, detail="Chỉ được chỉnh sửa booking đang pending hoặc booked")

    try:
        booking_mode = _normalize_booking_mode(payload.booking_mode or booking.booking_mode)
        normalized_checkin_time = _to_utc_naive(payload.checkin_time)

        fake_create_payload = BookingCreateRequest(
            parking_id=booking.parking_id,
            slot_id=payload.slot_id or booking.slot_id,
            license_plate=current_user.vehicle_plate or "UNKNOWN",
            owner_name=current_user.name or "User",
            vehicle_type=None,
            brand=None,
            vehicle_model=None,
            seat_count=None,
            vehicle_color=current_user.vehicle_color,
            booking_mode=booking_mode,
            month_count=payload.month_count,
            checkin_time=normalized_checkin_time,
            checkout_time=payload.checkout_time,
        )

        normalized_checkout_time = _to_utc_naive(_resolve_checkout_time(fake_create_payload, booking_mode))
        _validate_booking_window(normalized_checkin_time, normalized_checkout_time)

        parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first()
        if not parking_price:
            raise HTTPException(status_code=400, detail="Bãi xe chưa được cấu hình bảng giá")

        billing = _calculate_booking_amount(
            booking_mode=booking_mode,
            checkin_time=normalized_checkin_time,
            checkout_time=normalized_checkout_time,
            parking_price=parking_price,
            month_count=payload.month_count,
        )

        target_slot_id = payload.slot_id or booking.slot_id
        target_slot = (
            db.query(ParkingSlot)
            .filter(ParkingSlot.id == target_slot_id, ParkingSlot.parking_id == booking.parking_id)
            .with_for_update()
            .first()
        )
        if not target_slot:
            raise HTTPException(status_code=404, detail="Slot không tồn tại")

        if target_slot.id != booking.slot_id and target_slot.status != "available":
            raise HTTPException(status_code=400, detail="Slot đã được đặt hoặc không còn trống")

        active_self_conflict = (
            db.query(Booking)
            .filter(
                Booking.id != booking.id,
                Booking.user_id == current_user.id,
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            )
            .order_by(Booking.created_at.desc(), Booking.id.desc())
            .first()
        )
        if active_self_conflict:
            conflict_parking = db.query(ParkingLot).filter(ParkingLot.id == active_self_conflict.parking_id).first()
            raise HTTPException(
                status_code=400,
                detail=_build_active_booking_error_message(
                    current_user.vehicle_plate or "UNKNOWN",
                    active_self_conflict,
                    conflict_parking.name if conflict_parking else None,
                ),
            )

        overlapping_slot_booking = (
            db.query(Booking)
            .filter(
                Booking.id != booking.id,
                Booking.slot_id == target_slot.id,
                Booking.status.in_(["pending", "booked", "checked_in"]),
                Booking.start_time < normalized_checkout_time,
                Booking.expire_time > normalized_checkin_time,
            )
            .first()
        )
        if overlapping_slot_booking:
            raise HTTPException(status_code=400, detail="Slot đã được đặt trong khung giờ này")

        old_slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).with_for_update().first()
        if old_slot and old_slot.id != target_slot.id and old_slot.status == "reserved":
            old_slot.status = "available"

        booking.slot_id = target_slot.id
        booking.start_time = normalized_checkin_time
        booking.expire_time = normalized_checkout_time
        booking.booking_mode = billing["resolved_mode"]
        booking.billed_units = billing["billed_units"]
        booking.total_amount = billing["total_amount"]

        target_slot.status = "reserved"

        db.commit()
        db.refresh(booking)

        return {
            "message": "Cập nhật booking thành công",
            "booking_id": booking.id,
            "status": booking.status,
            "slot_id": booking.slot_id,
            "checkin_time": booking.start_time,
            "checkout_time": booking.expire_time,
            "total_amount": booking.total_amount,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.post("/booking/my/{booking_id}/cancel")
def cancel_my_booking(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.user_id == current_user.id)
        .with_for_update()
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if booking.status in ["cancelled", "completed"]:
        raise HTTPException(status_code=400, detail="Booking đã kết thúc hoặc đã hủy")

    if booking.status == "checked_in":
        raise HTTPException(status_code=400, detail="Không thể hủy booking đang check-in")

    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).with_for_update().first()

    booking.status = "cancelled"
    if slot and slot.status == "reserved":
        slot.status = "available"

    db.commit()

    return {
        "message": "Đã hủy booking thành công",
        "booking_id": booking.id,
        "status": booking.status,
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
            db.query(Booking)
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
            conflicting_parking = (
                db.query(ParkingLot)
                .filter(ParkingLot.id == active_vehicle_booking.parking_id)
                .first()
            )
            raise HTTPException(
                status_code=400,
                detail=_build_overlap_error_detail(
                    license_plate=normalized_license_plate,
                    existing_booking=active_vehicle_booking,
                    parking_name=conflicting_parking.name if conflicting_parking else None,
                    db=db,
                    payload=payload,
                    normalized_checkin_time=normalized_checkin_time,
                    normalized_checkout_time=normalized_checkout_time,
                    billing=billing,
                    reason="active_booking_exists",
                    message=_build_active_booking_error_message(
                        normalized_license_plate,
                        active_vehicle_booking,
                        conflicting_parking.name if conflicting_parking else None,
                    ),
                ),
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
            active_parking = db.query(ParkingLot).filter(ParkingLot.id == active_booking.parking_id).first()
            raise HTTPException(
                status_code=400,
                detail=_build_overlap_error_detail(
                    license_plate=normalized_license_plate,
                    existing_booking=active_booking,
                    parking_name=active_parking.name if active_parking else None,
                    db=db,
                    payload=payload,
                    normalized_checkin_time=normalized_checkin_time,
                    normalized_checkout_time=normalized_checkout_time,
                    billing=billing,
                    reason="active_booking_exists",
                    message=_build_active_booking_error_message(
                        normalized_license_plate,
                        active_booking,
                        active_parking.name if active_parking else None,
                    ),
                ),
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
        )
    except HTTPException:
        db.rollback()
        raise
    except OSError as e:
        db.rollback()
        logger.error(f"File system error during booking creation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Không thể tạo mã QR. Vui lòng thử lại sau."
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error during booking creation: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi tạo booking: {str(e)}. Vui lòng liên hệ hỗ trợ."
        )


@router.post("/check-in")
def check_in(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking không tồn tại")

    if current_user.role not in {"owner", "admin"} and booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thao tác tại cổng")

    if booking.status == "pending":
        raise HTTPException(status_code=400, detail="Booking chưa được thanh toán")

    if booking.status != "booked":
        raise HTTPException(status_code=400, detail="Booking không hợp lệ")

    booking.status = "checked_in"
    # Keep scheduled booking window intact; store real gate time separately (VN local time).
    booking.actual_checkin = vn_now()
    booking.last_gate_action = "check_in"
    booking.last_gate_action_at = booking.actual_checkin
    if booking.slot:
        booking.slot.status = "occupied"

    db.commit()

    return {
        "message": "Check-in thành công",
        "booking_id": booking.id,
        "booking_status": booking.status,
        "actual_checkin": booking.actual_checkin,
    }


@router.post("/check-out")
def check_out(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()

    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if current_user.role not in {"owner", "admin"} and booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thao tác tại cổng")

    _assert_checkout_allowed(booking)
    actual_checkout = vn_now()
    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first()
    fee = calculate_checkout_fee(booking, actual_checkout, float(parking_price.price_per_hour if parking_price else 0))
    payment = db.query(Payment).filter(Payment.booking_id == booking.id).first()
    if payment:
        payment.overtime_fee = fee["overstay_fee"]

    booking.actual_checkout = actual_checkout
    booking.overstay_minutes = fee["overstay_minutes"]
    booking.overstay_fee = fee["overstay_fee"]
    booking.total_actual_fee = fee["total_actual_fee"]
    booking.status = "completed"
    booking.last_gate_action = "check_out"
    booking.last_gate_action_at = actual_checkout
    if booking.slot:
        booking.slot.status = "available"

    invalidate_booking_qr_code(booking, db)
    db.commit()

    return {
        "success": True,
        "message": "Checkout thành công. Xe đã ra khỏi bãi.",
        "booking_id": booking.id,
        "booking_status": "checked_out",
        "checkin_status": "checked_out",
        "actual_checkout": booking.actual_checkout,
        "overstay_minutes": fee["overstay_minutes"],
        "overstay_fee": fee["overstay_fee"],
        "original_fee": fee["original_fee"],
        "total_actual_fee": fee["total_actual_fee"],
        "qr_url": None,
    }


@router.get("/bookings/{booking_id}/checkout-preview")
def checkout_preview(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if current_user.role not in {"owner", "admin"} and booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thao tác tại cổng")

    _assert_checkout_allowed(booking)
    now = vn_now()
    parking = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first()
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first()
    user = db.query(User).filter(User.id == booking.user_id).first()
    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first()
    fee = calculate_checkout_fee(booking, now, float(parking_price.price_per_hour if parking_price else 0))

    response = {
        "booking_id": booking.id,
        "license_plate": user.vehicle_plate if user else None,
        "parking_name": parking.name if parking else None,
        "slot_info": {
            "slot_number": (slot.slot_number or slot.code) if slot else None,
            "floor": slot.level if slot else None,
        },
        "actual_checkin": _to_vn_aware(booking.actual_checkin).isoformat() if booking.actual_checkin else None,
        "expected_checkout": _to_vn_aware(booking.expire_time).isoformat() if booking.expire_time else None,
        "current_time": _to_vn_aware(now).isoformat(),
        **fee,
        "fee_breakdown": _build_checkout_breakdown(fee),
    }
    if fee["is_early"]:
        response["note"] = "Checkout sớm không được hoàn tiền"
    return response


@router.post("/bookings/{booking_id}/checkout")
def checkout_booking(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")

    if current_user.role not in {"owner", "admin"} and booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thao tác tại cổng")

    _assert_checkout_allowed(booking)
    now = vn_now()
    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first()
    fee = calculate_checkout_fee(booking, now, float(parking_price.price_per_hour if parking_price else 0))
    payment = db.query(Payment).filter(Payment.booking_id == booking.id).with_for_update().first()
    if payment:
        payment.overtime_fee = fee["overstay_fee"]

    wallet_summary = None
    if payment and payment.payment_method == "wallet" and payment.payment_status == "paid":
        reserve_amount = round(float(payment.deposit_amount or 0), 2)
        capture_amount = round(float(payment.remaining_amount or 0), 2)
        try:
            settle_booking_payment(
                db=db,
                user_id=booking.user_id,
                reserved_amount=reserve_amount,
                capture_amount=capture_amount,
                reference_type="booking_payment",
                reference_id=booking.id,
                note=f"Thanh toán phần còn lại cho booking #{booking.id} khi checkout",
            )
            payment.remaining_amount = 0
            wallet_summary = get_wallet_summary(db, booking.user_id)
        except InsufficientWalletBalance as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=f"Số dư ví không đủ để checkout: {str(exc)}") from exc
        except WalletError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    booking.actual_checkout = now
    booking.status = "completed"
    booking.overstay_minutes = fee["overstay_minutes"]
    booking.overstay_fee = fee["overstay_fee"]
    booking.total_actual_fee = fee["total_actual_fee"]
    booking.last_gate_action = "check_out"
    booking.last_gate_action_at = now
    if booking.slot:
        booking.slot.status = "available"
    invalidate_booking_qr_code(booking, db)
    db.commit()
    response = {
        "success": True,
        "booking_id": booking.id,
        "actual_checkout": now,
        "checkin_status": "checked_out",
        "overstay_minutes": fee["overstay_minutes"],
        "overstay_fee": fee["overstay_fee"],
        "original_fee": fee["original_fee"],
        "total_actual_fee": fee["total_actual_fee"],
        "message": "Checkout thành công. Xe đã ra khỏi bãi.",
        "qr_url": None,
    }
    if wallet_summary is not None:
        response["wallet"] = wallet_summary


@router.get("/bookings/{booking_id}/status")
def booking_status(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")
    if current_user.role not in {"owner", "admin"} and booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem booking này")

    parking = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first() if booking.parking_id else None
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first() if booking.slot_id else None
    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first() if booking.parking_id else None
    return {
        "booking_id": booking.id,
        "checkin_status": "checked_out" if booking.status in {"completed", "checked_out"} else booking.status,
        "booking_status": booking.status,
        "actual_checkin": booking.actual_checkin,
        "actual_checkout": booking.actual_checkout,
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
        "total_amount": float(booking.total_amount or 0),
        "overstay_minutes": int(booking.overstay_minutes or 0),
        "overstay_fee": float(booking.overstay_fee or 0),
        "total_actual_fee": float(booking.total_actual_fee or booking.total_amount or 0),
        "is_reviewed": bool(booking.is_reviewed),
        "price_per_hour": float(parking_price.price_per_hour or 0) if parking_price else 0,
        "parking": {"id": parking.id, "name": parking.name} if parking else None,
        "slot": {"id": slot.id, "code": (slot.slot_number or slot.code) if slot else None} if slot else None,
    }


@router.get("/bookings/{booking_id}/qr")
def get_booking_qr(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get QR code for a booking.
    Only the booking owner or admin can access this.
    
    Returns:
    {
        "booking_id": 10,
        "qr_url": "/qrcodes/booking_10.png",
        "booking_status": "pending",
        "checkin_time": "2026-04-21T10:36:00",
        "checkout_time": "2026-04-21T11:36:00"
    }
    """
    try:
        booking = db.query(Booking).filter(Booking.id == booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking không tồn tại")
        
        # Check access: only owner or admin
        if booking.user_id != current_user.id and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Bạn không có quyền xem QR của booking này")
        
        # Use booking.qr_code as the primary field (set during booking creation)
        qr_path = booking.qr_code
        
        # If QR hasn't been generated yet, generate it now
        if not qr_path:
            from app.services.qr_service import generate_booking_qr_code
            qr_result = generate_booking_qr_code(booking_id, db)
            if not qr_result.get("success"):
                raise HTTPException(
                    status_code=500,
                    detail=f"Không thể tạo mã QR: {qr_result.get('error', 'Unknown error')}"
                )
            # Refresh to get the newly generated QR path
            db.refresh(booking)
            qr_path = booking.qr_code
        
        # Extract filename from path (e.g., "qrcodes/booking_10.png" → "booking_10.png")
        qr_filename = qr_path.split('/')[-1] if qr_path else f"booking_{booking_id}.png"
        
        return {
            "booking_id": booking.id,
            "qr_url": f"/qrcodes/{qr_filename}",
            "booking_status": booking.status,
            "checkin_time": booking.start_time,
            "checkout_time": booking.expire_time,
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting QR for booking {booking_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Không thể lấy mã QR. Vui lòng thử lại sau."
        )
