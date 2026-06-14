from collections import defaultdict
from datetime import datetime
from math import ceil
import re
import unicodedata
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from werkzeug.security import generate_password_hash

from app.database import get_db
from app.models.models import Booking, District, EmployeeActivity, OwnerParking, ParkingLot, ParkingPrice, ParkingSlot, Payment, Review, User, UserVehicle
from app.routes.auth import get_current_user
from app.security.password_policy import ensure_strong_password
from app.services.qr_service import generate_booking_qr_code, invalidate_booking_qr_code
from app.services.employee_service import create_employee_for_owner
from app.services.geocoding import GeocodingError, geocode_address
from app.services.owner_activity_service import build_owner_management_activity_rows, log_owner_activity
from app.services.owner_booking_config import (
    deposit_amount_for_booking,
    get_owner_booking_config,
    get_parking_booking_config,
    save_owner_booking_config,
)
from app.services.revenue_settings import get_commission_rate_percent, split_revenue
from app.utils import isoformat_vn, vn_now

router = APIRouter(prefix="/owner", tags=["owner"])
APP_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")
ACTIVE_BOOKING_STATUSES = ("pending", "booked", "checked_in")
OWNER_COORDINATE_HINTS = (
    (("tran hung dao", "quan 5"), (10.75385, 106.66822)),
    (("tran hung dao", "cho quan"), (10.75385, 106.66822)),
    (("nguyen bieu", "quan 5"), (10.75570, 106.68120)),
    (("tran binh trong", "quan 5"), (10.75680, 106.67500)),
    (("dai the gioi", "quan 5"), (10.75420, 106.66480)),
    (("tan ky tan quy",), (10.7932, 106.6250)),
    (("luy ban bich",), (10.7818, 106.6364)),
    (("au co",), (10.7864, 106.6402)),
    (("truong chinh",), (10.8031, 106.6287)),
)
OWNER_DISTRICT_COORDINATES = {
    "quan 1": [(10.7734, 106.6917), (10.7785, 106.7027), (10.7871, 106.7044)],
    "quan 3": [(10.7815, 106.6880), (10.7827, 106.6840), (10.7870, 106.6900)],
    "quan 4": [(10.7607, 106.7041), (10.7566, 106.7092), (10.7642, 106.7073)],
    "quan 5": [(10.7548, 106.6662), (10.7590, 106.6689), (10.7505, 106.6599)],
    "quan 6": [(10.7465, 106.6356), (10.7488, 106.6418), (10.7412, 106.6294)],
    "quan 7": [(10.7292, 106.7217), (10.7428, 106.7015), (10.7367, 106.7139)],
    "quan 8": [(10.7358, 106.6784), (10.7295, 106.6679), (10.7227, 106.6553)],
    "quan 10": [(10.7730, 106.6673), (10.7715, 106.6609), (10.7792, 106.6677)],
    "quan 11": [(10.7628, 106.6501), (10.7562, 106.6535), (10.7654, 106.6462)],
    "quan 12": [(10.8249, 106.6188), (10.8310, 106.6250), (10.8180, 106.6120)],
    "tan phu": [(10.7915, 106.6261), (10.7932, 106.6250), (10.7818, 106.6364)],
    "binh tan": [(10.7420, 106.6123), (10.7215, 106.5950), (10.7470, 106.6267)],
    "thu duc": [(10.8493, 106.7746), (10.8460, 106.7908), (10.8585, 106.7601)],
}


def _normalize_unique_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").replace("Đ", "D").replace("đ", "d"))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_text).strip().casefold()


def _normalize_owner_map_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").replace("Đ", "D").replace("đ", "d"))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").casefold()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


def _owner_coordinate_key(text_value: str) -> str | None:
    for key in (
        "quan 12",
        "quan 11",
        "quan 10",
        "quan 8",
        "quan 7",
        "quan 6",
        "quan 5",
        "quan 4",
        "quan 3",
        "quan 1",
        "tan phu",
        "binh tan",
        "thu duc",
    ):
        if key in text_value:
            return key
    return None


def _build_owner_geocode_query(address: str, district_name: str) -> str:
    normalized_address = (address or "").strip()
    normalized_district = (district_name or "").strip()
    parts = [normalized_address]
    if normalized_district:
        district_key = _normalize_owner_map_text(normalized_district)
        address_key = _normalize_owner_map_text(normalized_address)
        if district_key and district_key not in address_key:
            parts.append(normalized_district)
    parts.extend(["Thành phố Hồ Chí Minh", "Việt Nam"])
    return ", ".join(part for part in parts if part)


def _resolve_owner_parking_coordinates(
    name: str,
    address: str,
    district_name: str,
    district_id: int | None,
    db: Session,
) -> tuple[float, float]:
    geocode_query = _build_owner_geocode_query(address, district_name)
    try:
        return geocode_address(geocode_query)
    except GeocodingError:
        pass

    text_value = _normalize_owner_map_text(f"{name} {address} {district_name}")
    for keywords, point in OWNER_COORDINATE_HINTS:
        if all(keyword in text_value for keyword in keywords):
            return point

    key = _owner_coordinate_key(text_value)
    candidates = OWNER_DISTRICT_COORDINATES.get(key or "")
    if candidates:
        existing_count = 0
        if district_id:
            existing_count = db.query(func.count(ParkingLot.id)).filter(ParkingLot.district_id == district_id).scalar() or 0
        lat, lng = candidates[int(existing_count) % len(candidates)]
        return lat, lng

    return 10.7769, 106.7009


class OwnerSlotCreateRequest(BaseModel):
    parkingId: int
    code: str = Field(min_length=1, max_length=50)
    zone: str = Field(min_length=1, max_length=50)
    level: str = Field(min_length=1, max_length=50)
    status: str = Field(pattern="^(available|reserved|in_use|maintenance)$")


class OwnerSlotUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    zone: str | None = Field(default=None, min_length=1, max_length=50)
    level: str | None = Field(default=None, min_length=1, max_length=50)
    status: str | None = Field(default=None, pattern="^(available|reserved|in_use|maintenance)$")


class OwnerBookingStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(confirmed|cancelled|completed|in_progress|pending)$")


class OwnerBookingCreateRequest(BaseModel):
    user_id: int = Field(gt=0)
    slot_id: int = Field(gt=0)
    start_time: datetime
    expire_time: datetime
    booking_mode: str = Field(default="hourly", pattern="^(hourly|daily|monthly)$")


class OwnerAccountUpdateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str | None = Field(default=None, max_length=255)
    confirmPassword: str | None = Field(default=None, max_length=255)


class OwnerParkingSettingsUpdateRequest(BaseModel):
    contactPhone: str | None = Field(default=None, max_length=30)
    contactEmail: str | None = Field(default=None, max_length=255)


class OwnerManagedParkingSettingsUpdateRequest(BaseModel):
    parkingName: str | None = Field(default=None, max_length=255)
    pricePerHour: str | None = None
    pricePerDay: str | None = None
    pricePerMonth: str | None = None


class OwnerParkingSlotGroupRequest(BaseModel):
    zone: str = Field(min_length=1, max_length=50)
    level: str = Field(min_length=1, max_length=50)
    slotCount: int = Field(default=0, ge=0, le=500)


class OwnerParkingLotCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    district: str | None = Field(default=None, max_length=100)
    slotCount: int = Field(default=0, ge=0, le=500)
    defaultZone: str | None = Field(default=None, max_length=50)
    defaultLevel: str | None = Field(default=None, max_length=50)
    slotGroups: list[OwnerParkingSlotGroupRequest] = Field(default_factory=list)


class OwnerReviewReplyRequest(BaseModel):
    reply: str = Field(min_length=1, max_length=300)


class OwnerCustomerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    vehicle_plate: str | None = Field(default=None, max_length=30)
    status: str = Field(default="active", pattern="^(active|suspended|blocked|inactive)$")


class OwnerCustomerUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    vehicle_plate: str | None = Field(default=None, max_length=30)
    status: str | None = Field(default=None, pattern="^(active|suspended|blocked|inactive)$")


def require_owner(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ owner mới được truy cập")
    return current_user


def _get_primary_owner_parking(owner_id: int, db: Session) -> ParkingLot | None:
    assignment = (
        db.query(OwnerParking)
        .filter(OwnerParking.owner_id == owner_id)
        .order_by(OwnerParking.id.asc())
        .first()
    )
    if not assignment:
        return None
    return db.query(ParkingLot).filter(ParkingLot.id == assignment.parking_id).first()


def _get_owner_parking_lots(owner_id: int, db: Session, include_locked: bool = False) -> list[ParkingLot]:
    assignments = (
        db.query(OwnerParking)
        .filter(OwnerParking.owner_id == owner_id)
        .order_by(OwnerParking.id.asc())
        .all()
    )
    parking_ids = [assignment.parking_id for assignment in assignments]
    if not parking_ids:
        return []
    query = db.query(ParkingLot).filter(ParkingLot.id.in_(parking_ids))
    if not include_locked:
        query = query.filter(ParkingLot.is_active == 1)
    return query.order_by(ParkingLot.id.asc()).all()


def _get_owner_parking_ids(owner_id: int, db: Session, include_locked: bool = False) -> list[int]:
    return [int(lot.id) for lot in _get_owner_parking_lots(owner_id, db, include_locked=include_locked)]


def _get_owner_parking_assignment(owner_id: int, parking_id: int | None, db: Session) -> OwnerParking | None:
    if parking_id is None:
        return None
    return (
        db.query(OwnerParking)
        .filter(
            OwnerParking.owner_id == owner_id,
            OwnerParking.parking_id == parking_id,
        )
        .first()
    )


def _customer_status(user: User) -> str:
    if int(user.is_active or 0) != 1:
        return "inactive"
    return (user.status or "active").lower()


def _customer_group(booking_count: int, paid_amount: float) -> str:
    if booking_count >= 20 or paid_amount >= 2_000_000:
        return "loyal"
    if booking_count >= 5 or paid_amount >= 500_000:
        return "regular"
    return "new"


def _owner_can_manage_customer(owner_id: int, customer_id: int, db: Session) -> bool:
    owned_customer = (
        db.query(User.id)
        .filter(User.id == customer_id, User.role == "user", User.owner_id == owner_id)
        .first()
    )
    if owned_customer:
        return True

    parking_ids = _get_owner_parking_ids(owner_id, db, include_locked=True)
    if not parking_ids:
        return False
    booking = (
        db.query(Booking.id)
        .filter(Booking.user_id == customer_id, Booking.parking_id.in_(parking_ids))
        .first()
    )
    return booking is not None


def _sync_customer_vehicle(user: User, vehicle_plate: str | None, db: Session) -> None:
    normalized_plate = (vehicle_plate or "").strip().upper()
    user.vehicle_plate = normalized_plate or None
    profile = db.query(UserVehicle).filter(UserVehicle.user_id == user.id).first()
    if normalized_plate:
        if profile:
            profile.license_plate = normalized_plate
        else:
            db.add(UserVehicle(user_id=user.id, license_plate=normalized_plate))
    elif profile:
        profile.license_plate = None


def _normalize_slot_status(value: str | None) -> str:
    mapping = {
        "available": "available",
        "reserved": "occupied",
        "in_use": "occupied",
        "maintenance": "maintenance",
        "occupied": "occupied",
    }
    return mapping.get((value or "").lower(), "available")


def _owner_slot_status(raw_status: str | None, booking_statuses: set[str]) -> str:
    normalized = (raw_status or "").lower()
    if normalized == "maintenance":
        return "maintenance"
    if "checked_in" in booking_statuses:
        return "in_use"
    if booking_statuses.intersection({"pending", "booked"}):
        return "reserved"
    return "available"


def _overview_slot_status(raw_status: str | None, booking_statuses: set[str]) -> str:
    normalized = (raw_status or "").lower()
    if normalized == "maintenance":
        return "maintenance"
    if booking_statuses.intersection({"pending", "booked", "checked_in"}):
        return "occupied"
    if normalized in {"reserved", "occupied", "in_use"}:
        return "occupied"
    return "available"


def _owner_booking_status(value: str | None) -> str:
    mapping = {
        "pending": "pending",
        "booked": "confirmed",
        "checked_in": "in_progress",
        "completed": "completed",
        "cancelled": "cancelled",
    }
    return mapping.get((value or "").lower(), "pending")


def _db_booking_status(value: str) -> str:
    mapping = {
        "pending": "pending",
        "confirmed": "booked",
        "in_progress": "checked_in",
        "completed": "completed",
        "cancelled": "cancelled",
    }
    return mapping[value]


def _slot_layout_meta(slot: ParkingSlot) -> dict:
    return {
        "zone": slot.zone or "Chưa phân khu",
        "level": slot.level or "Chưa gán tầng",
        "type": slot.slot_type or None,
        "updatedAt": isoformat_vn(slot.updated_at or slot.created_at, fallback_now=True),
    }


def _display_slot_code(slot: ParkingSlot) -> str:
    slot_number = (slot.slot_number or "").strip()
    code = (slot.code or "").strip()
    if slot_number and code == f"{slot.parking_id}-{slot_number}":
        return slot_number
    if code:
        return code
    if slot_number:
        return slot_number
    return f"Slot-{slot.id}"


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _calculate_booking_amount(parking_price: ParkingPrice, start_time: datetime, expire_time: datetime, booking_mode: str) -> tuple[str, int, float]:
    duration_hours = max((expire_time - start_time).total_seconds() / 3600, 0)
    resolved_mode = booking_mode
    if booking_mode == "monthly":
        billed_units = max(ceil(duration_hours / (24 * 30)), 1)
        total_amount = float(parking_price.price_per_month or 0) * billed_units
    elif booking_mode == "daily":
        billed_units = max(ceil(duration_hours / 24), 1)
        total_amount = float(parking_price.price_per_day or 0) * billed_units
    else:
        if duration_hours > 12:
            resolved_mode = "daily"
            billed_units = 1
            total_amount = float(parking_price.price_per_day or 0) * billed_units
        else:
            billed_units = max(ceil(duration_hours), 1)
            total_amount = float(parking_price.price_per_hour or 0) * billed_units
    return resolved_mode, billed_units, round(total_amount, 2)


def _serialize_slots_overview(parking_lots: list[ParkingLot], db: Session) -> list[dict]:
    parking_ids = [lot.id for lot in parking_lots]
    if not parking_ids:
      return []

    slot_rows = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.parking_id.in_(parking_ids))
        .order_by(ParkingSlot.parking_id.asc(), ParkingSlot.slot_number.asc(), ParkingSlot.code.asc())
        .all()
    )

    slots_by_parking: dict[int, list[ParkingSlot]] = defaultdict(list)
    for slot in slot_rows:
        if slot.parking_id is None:
            continue
        slots_by_parking[int(slot.parking_id)].append(slot)

    active_bookings = (
        db.query(Booking)
        .filter(
            Booking.parking_id.in_(parking_ids),
            Booking.status.in_(["pending", "booked", "checked_in"]),
        )
        .all()
    )
    booking_statuses_by_slot: dict[int, set[str]] = defaultdict(set)
    for booking in active_bookings:
        if booking.slot_id:
            booking_statuses_by_slot[int(booking.slot_id)].add((booking.status or "").lower())

    result = []
    for lot in parking_lots:
        lot_slots = slots_by_parking.get(int(lot.id), [])
        effective_slots = [
            {
                "id": slot.id,
                "code": _display_slot_code(slot),
                "status": _overview_slot_status(slot.status, booking_statuses_by_slot.get(int(slot.id), set())),
            }
            for slot in lot_slots
        ]
        available_count = sum(1 for slot in effective_slots if slot["status"] == "available")
        occupied_count = len(lot_slots) - available_count
        result.append({
            "parking_id": lot.id,
            "parking_name": lot.name,
            "parking_address": lot.address,
            "avg_rating": float(lot.avg_rating or 0),
            "review_count": int(lot.review_count or 0),
            "district": lot.district.name if lot.district else None,
            "latitude": float(lot.latitude) if lot.latitude is not None else None,
            "longitude": float(lot.longitude) if lot.longitude is not None else None,
            "available_slots": available_count,
            "occupied_or_reserved_slots": occupied_count,
            "total_slots": len(lot_slots),
            "slots": effective_slots,
        })

    return result


def _serialize_owner_bootstrap(current_user: User, parking_lots: list[ParkingLot], db: Session) -> dict:
    locked_parking_lots = [lot for lot in parking_lots if int(lot.is_active or 0) != 1]
    is_locked = len(locked_parking_lots) > 0
    lock_message = "Bãi xe của bạn đã bị khóa, vui lòng liên hệ admin." if is_locked else None

    if not parking_lots:
        return {
            "parkingLot": None,
            "parkingLots": [],
            "slots": [],
            "bookings": [],
            "transactions": [],
            "activities": [],
            "settings": None,
            "reviews": [],
            "isLocked": False,
            "lockMessage": None,
        }

    primary_parking_lot = parking_lots[0]
    parking_ids = [lot.id for lot in parking_lots]
    parking_by_id = {int(lot.id): lot for lot in parking_lots}

    slots = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.parking_id.in_(parking_ids))
        .order_by(ParkingSlot.parking_id.asc(), ParkingSlot.id.asc())
        .all()
    )
    bookings = (
        db.query(Booking)
        .filter(Booking.parking_id.in_(parking_ids))
        .order_by(Booking.id.desc())
        .all()
    )
    payments = (
        db.query(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .filter(Booking.parking_id.in_(parking_ids))
        .all()
    )
    prices = db.query(ParkingPrice).filter(ParkingPrice.parking_id.in_(parking_ids)).all()
    reviews = (
        db.query(Review)
        .filter(Review.parking_id.in_(parking_ids))
        .order_by(Review.created_at.desc())
        .all()
    )
    prices_by_parking_id = {int(price.parking_id): price for price in prices}
    slot_count_by_parking_id: dict[int, int] = defaultdict(int)
    for slot in slots:
        if slot.parking_id:
            slot_count_by_parking_id[int(slot.parking_id)] += 1

    booking_statuses_by_slot: dict[int, set[str]] = defaultdict(set)
    for booking in bookings:
        if booking.slot_id:
            booking_statuses_by_slot[int(booking.slot_id)].add((booking.status or "").lower())

    slot_rows = []
    for slot in slots:
        layout_meta = _slot_layout_meta(slot)
        slot_rows.append({
            "id": slot.id,
            "code": _display_slot_code(slot),
            "parkingLotId": slot.parking_id,
            "parkingLotName": parking_by_id.get(int(slot.parking_id)).name if slot.parking_id and parking_by_id.get(int(slot.parking_id)) else "Chưa có bãi",
            "zone": layout_meta["zone"],
            "level": layout_meta["level"],
            "status": _owner_slot_status(slot.status, booking_statuses_by_slot.get(int(slot.id), set())),
            "type": layout_meta["type"],
            "updatedAt": layout_meta["updatedAt"],
        })

    booking_rows = []
    for booking in bookings:
        user = booking.user
        slot = booking.slot
        zone = "Chưa phân khu"
        if slot:
            matching_slot = next((item for item in slot_rows if int(item["id"]) == int(slot.id)), None)
            if matching_slot:
                zone = matching_slot["zone"]
        booking_rows.append({
            "id": booking.id,
            "code": f"BK-{booking.id}",
            "parkingLotName": parking_by_id.get(int(booking.parking_id)).name if booking.parking_id and parking_by_id.get(int(booking.parking_id)) else "Chưa có bãi",
            "userId": user.id if user else None,
            "customerId": user.id if user else None,
            "user": user.name if user else "Unknown user",
            "plate": user.vehicle_plate if user and user.vehicle_plate else "Chưa có biển số",
            "slotCode": _display_slot_code(slot) if slot else "Chưa có",
            "zone": zone,
            "startTime": isoformat_vn(booking.actual_checkin),
            "endTime": isoformat_vn(booking.actual_checkout),
            "bookingStartTime": isoformat_vn(booking.start_time or booking.created_at, fallback_now=True),
            "bookingEndTime": isoformat_vn(booking.expire_time or booking.created_at, fallback_now=True),
            "price": float(booking.total_amount or 0),
            "status": _owner_booking_status(booking.status),
            "phone": user.phone if user and user.phone else "Chưa có",
        })

    payments_by_booking_id = {int(payment.booking_id): payment for payment in payments}
    transaction_rows = []
    for booking in bookings:
        payment = payments_by_booking_id.get(int(booking.id))
        overtime_fee = float(payment.overtime_fee or 0) if payment else 0
        revenue = split_revenue(float((payment.amount if payment else booking.total_amount) or 0) + overtime_fee)
        transaction_rows.append({
            "id": f"TX-{payment.id}" if payment else f"TX-BK-{booking.id}",
            "bookingCode": f"BK-{booking.id}",
            "parkingLotName": parking_by_id.get(int(booking.parking_id)).name if booking.parking_id and parking_by_id.get(int(booking.parking_id)) else "Chưa có bãi",
            "method": (payment.payment_method or "N/A").upper() if payment else "N/A",
            "payer": booking.user.name if booking.user else "Unknown user",
            "time": (payment.paid_at or payment.created_at or booking.created_at or datetime.utcnow()).isoformat() if payment else (booking.created_at or datetime.utcnow()).isoformat(),
            "gross": revenue["gross"],
            "commission": revenue["commission"],
            "ownerPayout": revenue["ownerPayout"],
            "amount": revenue["ownerPayout"],
            "status": payment.payment_status if payment else "pending",
        })

    review_rows = [
        {
            "id": review.id,
            "bookingId": review.booking_id,
            "parkingLotName": parking_by_id.get(int(review.parking_id)).name if review.parking_id and parking_by_id.get(int(review.parking_id)) else "Chưa có bãi",
            "user": review.user.name if review.user else f"User #{review.user_id}",
            "rating": review.rating,
            "createdAt": (review.created_at or datetime.utcnow()).isoformat(),
            "content": review.comment or "",
            "ownerReply": review.owner_reply or "",
            "replyUpdatedAt": review.owner_replied_at.isoformat() if review.owner_replied_at else None,
        }
        for review in reviews
    ]

    activity_rows = []
    for booking in bookings:
        activity_rows.append(
            {
                "id": f"booking-{booking.id}",
                "title": f"Booking BK-{booking.id} tại {parking_by_id.get(int(booking.parking_id)).name if booking.parking_id and parking_by_id.get(int(booking.parking_id)) else 'bãi đỗ'}",
                "time": (booking.created_at or datetime.utcnow()).isoformat(),
                "type": "booking",
            }
        )
    for payment in payments:
        booking = next((item for item in bookings if int(item.id) == int(payment.booking_id)), None)
        activity_rows.append(
            {
                "id": f"payment-{payment.id}",
                "title": f"Thanh toán {int(float((payment.amount or 0) + (payment.overtime_fee or 0)))} VND cho BK-{payment.booking_id}",
                "time": (payment.paid_at or payment.created_at or datetime.utcnow()).isoformat(),
                "type": "success" if payment.payment_status == "paid" else "warning",
            }
        )
    for review in reviews:
        activity_rows.append(
            {
                "id": f"review-{review.id}",
                "title": f"Đánh giá {review.rating}/5 cho {parking_by_id.get(int(review.parking_id)).name if review.parking_id and parking_by_id.get(int(review.parking_id)) else 'bãi đỗ'}",
                "time": (review.created_at or datetime.utcnow()).isoformat(),
                "type": "warning",
            }
        )
    
    # Add cancelled booking notifications as warnings
    cancelled_bookings = [b for b in bookings if b.status == "cancelled"]
    # Query payments for cancelled bookings separately to ensure we have the latest data
    cancelled_booking_ids = [b.id for b in cancelled_bookings]
    cancelled_payments = {}
    if cancelled_booking_ids:
        for payment in db.query(Payment).filter(Payment.booking_id.in_(cancelled_booking_ids)).all():
            cancelled_payments[int(payment.booking_id)] = payment
    
    for booking in cancelled_bookings:
        # Try payments from the main dict first, then from the dedicated cancelled query
        payment = payments_by_booking_id.get(int(booking.id)) or cancelled_payments.get(int(booking.id))
        
        # Get the deposit amount (what user loses when no-show)
        deposit_amount = 0
        if payment and float(payment.deposit_amount or 0) > 0:
            deposit_amount = float(payment.deposit_amount)
        else:
            # Fallback: calculate 30% of total booking amount as deposit
            lot_config = get_parking_booking_config(db, booking.parking_id)
            deposit_amount = deposit_amount_for_booking(booking, lot_config)
        
        cancel_time = booking.actual_checkout or booking.created_at or datetime.utcnow()
        activity_rows.append(
            {
                "id": f"cancellation-{booking.id}",
                "title": f"Booking BK-{booking.id} bị hủy - Mất cọc {int(deposit_amount)} VND",
                "message": f"Đặt chỗ tại {parking_by_id.get(int(booking.parking_id)).name if booking.parking_id and parking_by_id.get(int(booking.parking_id)) else 'bãi đỗ'} đã bị hủy do quá thời gian check-in. Khách mất cọc {int(deposit_amount)} VND.",
                "time": cancel_time.isoformat(),
                "type": "warning",
            }
        )
    
    activities = sorted(activity_rows, key=lambda item: item["time"], reverse=True)[:8]

    return {
        "parkingLot": {
            "id": primary_parking_lot.id,
            "name": primary_parking_lot.name,
            "address": primary_parking_lot.address,
            "district": primary_parking_lot.district.name if primary_parking_lot.district else None,
            "latitude": float(primary_parking_lot.latitude) if primary_parking_lot.latitude is not None else None,
            "longitude": float(primary_parking_lot.longitude) if primary_parking_lot.longitude is not None else None,
        },
        "parkingLots": [
            {
                "id": lot.id,
                "name": lot.name,
                "address": lot.address,
                "district": lot.district.name if lot.district else None,
                "latitude": float(lot.latitude) if lot.latitude is not None else None,
                "longitude": float(lot.longitude) if lot.longitude is not None else None,
                "status": "active" if int(lot.is_active or 0) == 1 else "locked",
            }
            for lot in parking_lots
        ],
        "slots": slot_rows,
        "bookings": booking_rows,
        "transactions": transaction_rows,
        "activities": activities,
        "settings": {
            "parkingName": primary_parking_lot.name,
            "managedParkingCount": str(len(parking_lots)),
            "slotCapacity": str(len(slot_rows)),
            "totalSlotCapacity": str(len(slot_rows)),
            "districtName": current_user.managed_district.name if current_user.managed_district else "",
            "pricePerHour": str(int(float(prices_by_parking_id.get(int(primary_parking_lot.id)).price_per_hour))) if prices_by_parking_id.get(int(primary_parking_lot.id)) and prices_by_parking_id.get(int(primary_parking_lot.id)).price_per_hour is not None else "0",
            "pricePerDay": str(int(float(prices_by_parking_id.get(int(primary_parking_lot.id)).price_per_day))) if prices_by_parking_id.get(int(primary_parking_lot.id)) and prices_by_parking_id.get(int(primary_parking_lot.id)).price_per_day is not None else "0",
            "pricePerMonth": str(int(float(prices_by_parking_id.get(int(primary_parking_lot.id)).price_per_month))) if prices_by_parking_id.get(int(primary_parking_lot.id)) and prices_by_parking_id.get(int(primary_parking_lot.id)).price_per_month is not None else "0",
            "contactName": current_user.name,
            "contactPhone": current_user.phone or "",
            "contactEmail": current_user.email,
            "parkingLots": [
                {
                    "id": lot.id,
                    "name": lot.name,
                    "address": lot.address,
                    "district": lot.district.name if lot.district else None,
                    "latitude": float(lot.latitude) if lot.latitude is not None else None,
                    "longitude": float(lot.longitude) if lot.longitude is not None else None,
                    "slotCapacity": slot_count_by_parking_id.get(int(lot.id), 0),
                    "pricePerHour": str(int(float(prices_by_parking_id.get(int(lot.id)).price_per_hour))) if prices_by_parking_id.get(int(lot.id)) and prices_by_parking_id.get(int(lot.id)).price_per_hour is not None else "0",
                    "pricePerDay": str(int(float(prices_by_parking_id.get(int(lot.id)).price_per_day))) if prices_by_parking_id.get(int(lot.id)) and prices_by_parking_id.get(int(lot.id)).price_per_day is not None else "0",
                    "pricePerMonth": str(int(float(prices_by_parking_id.get(int(lot.id)).price_per_month))) if prices_by_parking_id.get(int(lot.id)) and prices_by_parking_id.get(int(lot.id)).price_per_month is not None else "0",
                    "status": "active" if int(lot.is_active or 0) == 1 else "locked",
                }
                for lot in parking_lots
            ],
        },
        "reviews": review_rows,
        "isLocked": is_locked,
        "lockMessage": lock_message,
    }


def _serialize_owner_overview(current_user: User, parking_lots: list[ParkingLot], db: Session) -> dict:
    bootstrap = _serialize_owner_bootstrap(current_user, parking_lots, db)
    bookings = bootstrap["bookings"]
    transactions = bootstrap["transactions"]
    today = datetime.now(APP_TIMEZONE).date()

    def _same_day(value: str | None) -> bool:
        parsed = _parse_iso_datetime(value)
        if parsed is None:
            return False
        return parsed.date() == today

    return {
        "stats": {
            "totalSlots": len(bootstrap["slots"]),
            "availableSlots": sum(1 for slot in bootstrap["slots"] if slot["status"] == "available"),
            "usedSlots": sum(1 for slot in bootstrap["slots"] if slot["status"] in {"reserved", "in_use"}),
            "todayRevenue": sum(item["amount"] for item in transactions if item["status"] == "paid" and _same_day(item["time"])),
            "todayBookings": sum(1 for item in bookings if _same_day(item["startTime"])),
            "managedParkingCount": len(bootstrap["parkingLots"]),
        },
        "vehiclesInLot": [item for item in bookings if item["status"] in {"confirmed", "in_progress"}],
        "todayBookings": [item for item in bookings if _same_day(item["startTime"])],
        "transactions": transactions,
        "activities": bootstrap["activities"],
    }


@router.get("/customers")
def get_owner_customers(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db, include_locked=True)
    parking_ids = [lot.id for lot in parking_lots]

    bookings = []
    if parking_ids:
        bookings = (
            db.query(Booking)
            .filter(Booking.parking_id.in_(parking_ids))
            .order_by(Booking.id.desc())
            .all()
        )
    booking_ids = [booking.id for booking in bookings]
    payments_by_booking_id = {}
    if booking_ids:
        payments = db.query(Payment).filter(Payment.booking_id.in_(booking_ids)).all()
        payments_by_booking_id = {int(payment.booking_id): payment for payment in payments}

    owner_created_users = (
        db.query(User)
        .filter(User.role == "user", User.owner_id == current_user.id)
        .order_by(User.created_at.desc(), User.id.desc())
        .all()
    )
    customer_map: dict[int, dict] = {}
    for user in owner_created_users:
        vehicle_profile = user.vehicle_profile
        vehicle_plate = user.vehicle_plate or (vehicle_profile.license_plate if vehicle_profile else "")
        customer_map[int(user.id)] = {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone or "",
            "status": _customer_status(user),
            "group": "new",
            "vehicles": [
                {
                    "plate": vehicle_plate,
                    "type": vehicle_profile.brand or vehicle_profile.vehicle_model or "Chưa cập nhật" if vehicle_profile else "Chưa cập nhật",
                    "firstUsed": user.created_at.isoformat() if user.created_at else None,
                }
            ] if vehicle_plate else [],
            "bookings": [],
            "transactions": [],
            "total_spent": 0,
            "paid_amount": 0,
            "pending_amount": 0,
            "last_visit": None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "avg_visits_per_month": 0,
        }

    for booking in bookings:
        if booking.user is None:
            continue
        user_id = int(booking.user.id)
        vehicle_profile = booking.user.vehicle_profile
        customer = customer_map.setdefault(
            user_id,
            {
                "id": booking.user.id,
                "name": booking.user.name,
                "email": booking.user.email,
                "phone": booking.user.phone or "",
                "status": _customer_status(booking.user),
                "group": "new",
                "vehicles": [],
                "bookings": [],
                "transactions": [],
                "total_spent": 0,
                "paid_amount": 0,
                "pending_amount": 0,
                "last_visit": None,
                "created_at": booking.user.created_at.isoformat() if booking.user.created_at else None,
                "avg_visits_per_month": 0,
            },
        )

        booking_amount = float(booking.total_amount or 0)
        customer["total_spent"] += booking_amount
        booking_start = booking.start_time or booking.created_at or datetime.utcnow()
        booking_end = booking.actual_checkout or booking.expire_time or booking_start
        if customer["last_visit"] is None or booking_end > datetime.fromisoformat(customer["last_visit"]):
            customer["last_visit"] = booking_end.isoformat()
        customer["bookings"].append(
            {
                "id": booking.id,
                "code": f"BK-{booking.id}",
                "plate": booking.user.vehicle_plate or (vehicle_profile.license_plate if vehicle_profile and vehicle_profile.license_plate else "Chưa có biển số"),
                "start_time": booking_start.isoformat(),
                "end_time": (booking.expire_time or booking.created_at or datetime.utcnow()).isoformat(),
                "price": booking_amount,
                "status": _owner_booking_status(booking.status),
                "parking_lot_name": booking.parking_lot.name if booking.parking_lot else "Chưa có bãi",
            }
        )

        payment = payments_by_booking_id.get(int(booking.id))
        if payment:
            amount = float(payment.amount or 0) + float(payment.overtime_fee or 0)
            customer["transactions"].append(
                {
                    "id": f"TX-{payment.id}",
                    "booking_code": f"BK-{booking.id}",
                    "method": (payment.payment_method or "N/A").upper(),
                    "amount": amount,
                    "time": (payment.paid_at or payment.created_at or datetime.utcnow()).isoformat(),
                    "status": payment.payment_status,
                }
            )
            if payment.payment_status == "paid":
                customer["paid_amount"] += amount
            else:
                customer["pending_amount"] += amount
        elif booking_amount > 0 and (booking.status or "").lower() not in {"cancelled"}:
            customer["pending_amount"] += booking_amount

    for customer in customer_map.values():
        vehicles = []
        user = db.query(User).filter(User.id == customer["id"]).first()
        if user:
            profile = user.vehicle_profile
            if profile and profile.license_plate:
                vehicles.append(
                    {
                        "plate": profile.license_plate,
                        "type": profile.brand or profile.vehicle_model or "Chưa cập nhật",
                        "firstUsed": customer["bookings"][-1]["start_time"] if customer["bookings"] else None,
                    }
                )
            elif user.vehicle_plate:
                vehicles.append(
                    {
                        "plate": user.vehicle_plate,
                        "type": "Chưa cập nhật",
                        "firstUsed": customer["bookings"][-1]["start_time"] if customer["bookings"] else None,
                    }
                )
        customer["vehicles"] = vehicles
        booking_count = len(customer["bookings"])
        paid_amount = float(customer["paid_amount"] or 0)
        customer["group"] = _customer_group(booking_count, paid_amount)
        if booking_count > 0:
            first_booking_dates = [
                datetime.fromisoformat(item["start_time"])
                for item in customer["bookings"]
                if item.get("start_time")
            ]
            first_seen = min(first_booking_dates) if first_booking_dates else datetime.utcnow()
            month_span = max(1, (datetime.utcnow().year - first_seen.year) * 12 + datetime.utcnow().month - first_seen.month + 1)
            customer["avg_visits_per_month"] = round(booking_count / month_span, 1)
        customer["totalSpent"] = customer["total_spent"]
        customer["paidAmount"] = customer["paid_amount"]
        customer["pendingAmount"] = customer["pending_amount"]

    customers = sorted(customer_map.values(), key=lambda item: (item["total_spent"], len(item["bookings"]), item["id"]), reverse=True)
    return {"customers": customers}


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def create_owner_customer(
    payload: OwnerCustomerCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    if not _get_owner_parking_lots(current_user.id, db, include_locked=True):
        raise HTTPException(status_code=400, detail="Owner chưa được gán bãi")

    normalized_email = payload.email.lower().strip()
    duplicate = db.query(User).filter(User.email == normalized_email).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Email khách hàng đã tồn tại")

    customer = User(
        name=payload.name.strip(),
        email=normalized_email,
        password="__owner_created__",
        password_hash=generate_password_hash("Customer@1234"),
        phone=(payload.phone or "").strip() or None,
        owner_id=current_user.id,
        role="user",
        status=payload.status,
        is_active=0 if payload.status == "inactive" else 1,
    )
    db.add(customer)
    db.flush()
    _sync_customer_vehicle(customer, payload.vehicle_plate, db)
    log_owner_activity(
        current_user.id,
        "customer_created",
        f"Tạo khách {customer.name} ({customer.email})",
        db,
    )
    db.commit()
    db.refresh(customer)
    return {
        "message": "Đã tạo khách hàng",
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "email": customer.email,
            "phone": customer.phone,
            "vehicle_plate": customer.vehicle_plate,
            "status": _customer_status(customer),
        },
    }


@router.patch("/customers/{customer_id}")
def update_owner_customer(
    customer_id: int,
    payload: OwnerCustomerUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    customer = db.query(User).filter(User.id == customer_id, User.role == "user").first()
    if not customer:
        raise HTTPException(status_code=404, detail="Không tìm thấy khách hàng")
    if not _owner_can_manage_customer(current_user.id, customer.id, db):
        raise HTTPException(status_code=403, detail="Bạn không có quyền cập nhật khách hàng này")

    if payload.name is not None:
        customer.name = payload.name.strip()
    if payload.email is not None:
        normalized_email = payload.email.lower().strip()
        duplicate = db.query(User).filter(User.email == normalized_email, User.id != customer.id).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Email khách hàng đã tồn tại")
        customer.email = normalized_email
    if payload.phone is not None:
        customer.phone = payload.phone.strip() or None
    if payload.vehicle_plate is not None:
        _sync_customer_vehicle(customer, payload.vehicle_plate, db)
    if payload.status is not None:
        customer.status = payload.status
        customer.is_active = 0 if payload.status == "inactive" else 1

    log_owner_activity(
        current_user.id,
        "customer_updated",
        f"Cập nhật khách {customer.name} ({customer.email})",
        db,
    )
    db.commit()
    db.refresh(customer)
    return {
        "message": "Đã cập nhật khách hàng",
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "email": customer.email,
            "phone": customer.phone,
            "vehicle_plate": customer.vehicle_plate,
            "status": _customer_status(customer),
        },
    }


@router.get("/customers-list")
def owner_customers_list(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    if not _get_owner_parking_lots(current_user.id, db):
        raise HTTPException(status_code=400, detail="Owner chưa được gán bãi")

    rows = (
        db.query(User)
        .filter(User.role == "user", User.is_active == 1)
        .order_by(User.name.asc())
        .limit(500)
        .all()
    )
    return [
        {
            "id": int(user.id),
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "vehicle_plate": user.vehicle_plate or (user.vehicle_profile.license_plate if user.vehicle_profile else None),
        }
        for user in rows
    ]


def _extract_activity_detail_field(detail: str | None, field_name: str) -> str:
    match = re.search(rf"{re.escape(field_name)}:\s*([^|]+)", detail or "", re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _booking_vehicle_payload(booking: Booking | None) -> dict | None:
    if not booking or not booking.user:
        return None
    profile = booking.user.vehicle_profile
    vehicle_type = "Xe ô tô"
    if profile:
        vehicle_type = profile.brand or profile.vehicle_model or vehicle_type
    return {
        "license_plate": booking.user.vehicle_plate or (profile.license_plate if profile else "") or "Chưa có biển số",
        "vehicle_type": vehicle_type,
        "booking_mode": booking.booking_mode or "hourly",
        "slot_code": (booking.slot.slot_number or booking.slot.code) if booking.slot else "",
        "customer_name": booking.user.name,
        "customer_phone": booking.user.phone,
    }


@router.get("/activity")
def owner_activity_history(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db, include_locked=True)
    parking_ids = [int(lot.id) for lot in parking_lots]
    parking_names = {int(lot.id): lot.name for lot in parking_lots}
    owner_name = current_user.name or "Owner"
    if not parking_ids:
        rows = build_owner_management_activity_rows(
            current_user.id,
            owner_name,
            [],
            parking_names,
            db,
        )
        rows.sort(key=lambda item: item["time"], reverse=True)
        return {
            "activities": rows[:1000],
            "summary": {
                "total": len(rows),
                "booking": 0,
                "payment": 0,
                "review": 0,
                "employee": 0,
                "owner": sum(1 for item in rows if item["type"] == "owner"),
                "warning": sum(1 for item in rows if item["result"] == "warning"),
            },
        }

    bookings = (
        db.query(Booking)
        .filter(Booking.parking_id.in_(parking_ids))
        .order_by(Booking.created_at.desc(), Booking.id.desc())
        .limit(500)
        .all()
    )
    booking_ids = [int(item.id) for item in bookings]
    payments = db.query(Payment).filter(Payment.booking_id.in_(booking_ids)).all() if booking_ids else []
    reviews = (
        db.query(Review)
        .filter(Review.parking_id.in_(parking_ids))
        .order_by(Review.created_at.desc(), Review.id.desc())
        .limit(300)
        .all()
    )
    employee_logs = (
        db.query(EmployeeActivity)
        .filter(EmployeeActivity.parking_id.in_(parking_ids))
        .order_by(EmployeeActivity.created_at.desc(), EmployeeActivity.id.desc())
        .limit(500)
        .all()
    )

    booking_by_id = {int(item.id): item for item in bookings}
    rows: list[dict] = []

    for booking in bookings:
        user = booking.user
        rows.append({
            "id": f"booking-{booking.id}",
            "time": (booking.created_at or datetime.utcnow()).isoformat(),
            "type": "booking",
            "action": "Tạo đặt chỗ",
            "object": f"BK-{booking.id} · {user.vehicle_plate if user and user.vehicle_plate else 'Chưa có biển số'}",
            "parkingLotName": parking_names.get(int(booking.parking_id or 0), "Chưa có bãi"),
            "actor": user.name if user else "Khách hàng",
            "device": "Web / Mobile",
            "ip": "",
            "detail": f"Khách hàng: {user.name if user else 'Không xác định'}",
            "status": _owner_booking_status(booking.status),
            "result": "success" if (booking.status or "").lower() not in {"cancelled"} else "warning",
        })

    for payment in payments:
        booking = booking_by_id.get(int(payment.booking_id))
        rows.append({
            "id": f"payment-{payment.id}",
            "time": (payment.paid_at or payment.created_at or datetime.utcnow()).isoformat(),
            "type": "payment",
            "action": "Thanh toán",
            "object": f"BK-{payment.booking_id}",
            "parkingLotName": parking_names.get(int(booking.parking_id or 0), "Chưa có bãi") if booking else "Chưa có bãi",
            "actor": booking.user.name if booking and booking.user else "Khách hàng",
            "device": (payment.payment_method or "N/A").upper(),
            "ip": "",
            "detail": f"Số tiền {int(float(payment.amount or 0) + float(payment.overtime_fee or 0))} VND",
            "status": payment.payment_status,
            "result": "success" if payment.payment_status == "paid" else "warning",
        })

    for review in reviews:
        rows.append({
            "id": f"review-{review.id}",
            "time": (review.created_at or datetime.utcnow()).isoformat(),
            "type": "review",
            "action": "Đánh giá khách hàng",
            "object": f"{review.rating}/5 sao",
            "parkingLotName": parking_names.get(int(review.parking_id), "Chưa có bãi"),
            "actor": review.user.name if review.user else "Khách hàng",
            "device": "Web / Mobile",
            "ip": "",
            "detail": review.comment or "Không có nội dung",
            "status": "success" if review.owner_reply else "pending",
            "result": "success" if review.owner_reply else "warning",
        })

    action_labels = {
        "employee_created": "Tạo tài khoản bãi",
        "employee_login": "Đăng nhập tài khoản bãi",
        "check_in": "Check-in xe",
        "check_out": "Check-out xe",
        "parking_status_updated": "Cập nhật trạng thái bãi",
        "resolve_booking": "Xem booking",
    }
    for log in employee_logs:
        booking = log.booking
        vehicle_payload = _booking_vehicle_payload(booking)
        login_ip = _extract_activity_detail_field(log.detail, "IP")
        login_device = _extract_activity_detail_field(log.detail, "Thiết bị")
        is_login = log.action == "employee_login"
        object_value = f"BK-{log.booking_id}" if log.booking_id else "Tài khoản bãi"
        if vehicle_payload:
            object_value = f"BK-{log.booking_id} · {vehicle_payload['license_plate']}"
        rows.append({
            "id": f"employee-{log.id}",
            "time": (log.created_at or datetime.utcnow()).isoformat(),
            "type": "employee",
            "action": action_labels.get(log.action, log.action),
            "object": log.employee.email if is_login and log.employee else object_value,
            "parkingLotName": parking_names.get(int(log.parking_id), "Chưa có bãi"),
            "actor": log.employee.name if log.employee else "Tài khoản bãi",
            "device": login_device or "Employee console",
            "ip": login_ip,
            "detail": log.detail or "",
            "amount": float(log.amount or 0),
            "vehicle": vehicle_payload,
            "status": "success",
            "result": "success",
        })

    rows.extend(
        build_owner_management_activity_rows(
            current_user.id,
            owner_name,
            parking_ids,
            parking_names,
            db,
        )
    )

    rows.sort(key=lambda item: item["time"], reverse=True)
    summary = {
        "total": len(rows),
        "booking": sum(1 for item in rows if item["type"] == "booking"),
        "payment": sum(1 for item in rows if item["type"] == "payment"),
        "review": sum(1 for item in rows if item["type"] == "review"),
        "employee": sum(1 for item in rows if item["type"] == "employee"),
        "owner": sum(1 for item in rows if item["type"] == "owner"),
        "warning": sum(1 for item in rows if item["result"] == "warning"),
    }
    return {"activities": rows[:1000], "summary": summary}


@router.get("/bootstrap")
def owner_bootstrap(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db, include_locked=True)
    return _serialize_owner_bootstrap(current_user, parking_lots, db)


@router.get("/overview")
def owner_overview(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db)
    return _serialize_owner_overview(current_user, parking_lots, db)


@router.get("/revenue")
def owner_revenue(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db)
    bootstrap = _serialize_owner_bootstrap(current_user, parking_lots, db)
    return {
        "transactions": bootstrap["transactions"],
        "parkingLots": bootstrap["parkingLots"],
        "commissionRate": get_commission_rate_percent(),
    }


@router.get("/reviews")
def owner_reviews(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db)
    bootstrap = _serialize_owner_bootstrap(current_user, parking_lots, db)
    parking_ids = [lot.id for lot in parking_lots]
    rating_distribution = {str(i): 0 for i in range(1, 6)}
    avg_rating = 0.0
    total_reviews = 0
    unresolved_count = 0
    if parking_ids:
        avg_count = (
            db.query(func.avg(Review.rating), func.count(Review.id))
            .filter(Review.parking_id.in_(parking_ids))
            .first()
        )
        avg_rating = round(float(avg_count[0]), 1) if avg_count and avg_count[0] is not None else 0.0
        total_reviews = int(avg_count[1]) if avg_count and avg_count[1] is not None else 0
        unresolved_count = (
            db.query(func.count(Review.id))
            .filter(Review.parking_id.in_(parking_ids), Review.owner_reply.is_(None))
            .scalar()
            or 0
        )
        distribution_rows = (
            db.query(Review.rating, func.count(Review.id))
            .filter(Review.parking_id.in_(parking_ids))
            .group_by(Review.rating)
            .all()
        )
        for rating, count in distribution_rows:
            rating_distribution[str(int(rating))] = int(count)

    return {
        "reviews": bootstrap["reviews"],
        "avg_rating": avg_rating,
        "total_reviews": total_reviews,
        "rating_distribution": rating_distribution,
        "unreplied_count": int(unresolved_count),
    }


@router.patch("/reviews/{review_id}/reply")
def owner_reply_review(
    review_id: int,
    payload: OwnerReviewReplyRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Không tìm thấy đánh giá")
    if _get_owner_parking_assignment(current_user.id, review.parking_id, db) is None:
        raise HTTPException(status_code=403, detail="Bạn không có quyền phản hồi đánh giá này")
    review.owner_reply = payload.reply.strip()
    review.owner_replied_at = datetime.utcnow()
    log_owner_activity(
        current_user.id,
        "review_replied",
        f"Phản hồi đánh giá #{review.id}",
        db,
        parking_id=int(review.parking_id),
    )
    db.commit()
    return {
        "success": True,
        "review_id": review.id,
        "owner_reply": review.owner_reply,
        "owner_replied_at": review.owner_replied_at.isoformat() if review.owner_replied_at else None,
    }


class OwnerBookingConfigUpdateRequest(BaseModel):
    config: dict[str, Any]


@router.get("/booking-config")
def owner_booking_config_get(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return {"config": get_owner_booking_config(db, current_user.id)}


@router.patch("/booking-config")
def owner_booking_config_update(
    payload: OwnerBookingConfigUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    saved = save_owner_booking_config(db, current_user.id, payload.config or {})
    log_owner_activity(
        current_user.id,
        "booking_config_updated",
        "Cập nhật cấu hình đặt chỗ & vòng đời booking",
        db,
    )
    db.commit()
    return {"message": "Đã lưu cấu hình đặt chỗ & ra/vào", "config": saved}


@router.get("/settings")
def owner_settings(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db)
    bootstrap = _serialize_owner_bootstrap(current_user, parking_lots, db)
    return {"settings": bootstrap["settings"]}


@router.get("/parking-lots/slots-overview")
def get_owner_parking_lots_slots_overview(
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db)
    return _serialize_slots_overview(parking_lots, db)


@router.post("/booking-owner")
def create_owner_booking(
    payload: OwnerBookingCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lots = _get_owner_parking_lots(current_user.id, db)
    parking_ids = [int(lot.id) for lot in parking_lots]
    if not parking_ids:
        raise HTTPException(status_code=400, detail="Owner chưa được gán bãi")

    start_time = payload.start_time
    expire_time = payload.expire_time
    if expire_time <= start_time:
        raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu")

    customer = (
        db.query(User)
        .filter(User.id == payload.user_id, User.role == "user", User.is_active == 1)
        .with_for_update()
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Không tìm thấy khách hàng")

    slot = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.id == payload.slot_id, ParkingSlot.parking_id.in_(parking_ids))
        .with_for_update()
        .first()
    )
    if not slot:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ thuộc bãi owner quản lý")
    if (slot.status or "available").lower() not in {"available"}:
        raise HTTPException(status_code=409, detail="Chỗ đỗ không còn trống")

    vehicle_profile = db.query(UserVehicle).filter(UserVehicle.user_id == customer.id).with_for_update().first()
    normalized_plate = ((customer.vehicle_plate or "") or (vehicle_profile.license_plate if vehicle_profile else "")).strip().upper()
    if not normalized_plate:
        raise HTTPException(status_code=400, detail="Khách hàng chưa có biển số xe")
    customer.vehicle_plate = normalized_plate
    if vehicle_profile:
        vehicle_profile.license_plate = normalized_plate
    else:
        db.add(UserVehicle(user_id=customer.id, license_plate=normalized_plate))

    overlapping_slot = (
        db.query(Booking.id)
        .filter(
            Booking.slot_id == slot.id,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            Booking.start_time < expire_time,
            Booking.expire_time > start_time,
        )
        .first()
    )
    if overlapping_slot:
        raise HTTPException(status_code=409, detail="Chỗ đỗ đã có booking trong khung giờ này")

    active_customer_booking = (
        db.query(Booking.id)
        .filter(
            Booking.user_id == customer.id,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
        )
        .order_by(Booking.created_at.desc(), Booking.id.desc())
        .first()
    )
    if active_customer_booking:
        raise HTTPException(
            status_code=409,
            detail="Khách hàng đã có booking chưa hoàn tất. Hãy hủy hoặc checkout booking hiện tại trước khi đặt bãi khác.",
        )

    active_vehicle_booking = (
        db.query(Booking.id)
        .join(User, User.id == Booking.user_id)
        .filter(
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            User.vehicle_plate.isnot(None),
            func.upper(func.trim(User.vehicle_plate)) == normalized_plate,
        )
        .order_by(Booking.created_at.desc(), Booking.id.desc())
        .first()
    )
    if active_vehicle_booking:
        raise HTTPException(
            status_code=409,
            detail="Biển số xe này đang có booking chưa hoàn tất. Không thể đặt thêm bãi khác.",
        )

    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == slot.parking_id).first()
    if not parking_price:
        raise HTTPException(status_code=400, detail="Bãi chưa cấu hình bảng giá")

    resolved_mode, billed_units, total_amount = _calculate_booking_amount(
        parking_price,
        start_time,
        expire_time,
        payload.booking_mode,
    )
    booking = Booking(
        user_id=customer.id,
        slot_id=slot.id,
        parking_id=slot.parking_id,
        start_time=start_time,
        expire_time=expire_time,
        booking_mode=resolved_mode,
        billed_units=billed_units,
        total_amount=total_amount,
        status="pending",
        qr_code="",
    )
    db.add(booking)
    slot.status = "reserved"
    db.commit()
    db.refresh(booking)

    qr_result = generate_booking_qr_code(int(booking.id), db)
    if not qr_result.get("success"):
        raise HTTPException(status_code=500, detail=f"Đã tạo booking nhưng không tạo được QR: {qr_result.get('error', 'Unknown error')}")

    return {
        "message": "Đã tạo đặt chỗ",
        "booking_id": int(booking.id),
        "total_amount": float(booking.total_amount or 0),
        "qr_url": qr_result.get("qr_url"),
    }


@router.get("/bookings/{booking_id}/qr")
def get_owner_booking_qr(
    booking_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")
    if _get_owner_parking_assignment(current_user.id, booking.parking_id, db) is None:
        raise HTTPException(status_code=403, detail="Owner không có quyền xem QR booking này")

    qr_path = booking.qr_code or booking.qr_code_path
    if not qr_path:
        qr_result = generate_booking_qr_code(booking_id, db)
        if not qr_result.get("success"):
            raise HTTPException(status_code=500, detail=f"Không thể tạo mã QR: {qr_result.get('error', 'Unknown error')}")
        db.refresh(booking)
        qr_path = booking.qr_code or booking.qr_code_path

    qr_filename = qr_path.split("/")[-1] if qr_path else f"booking_{booking_id}.png"
    return {
        "booking_id": booking.id,
        "qr_url": f"/qrcodes/{qr_filename}",
        "booking_status": booking.status,
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
    }


@router.post("/parking-lots")
def create_owner_parking_lot(
    payload: OwnerParkingLotCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    address = payload.address.strip()
    if not name or not address:
        raise HTTPException(status_code=400, detail="Vui lòng nhập tên bãi và địa chỉ")

    requested_name_key = _normalize_unique_text(name)
    duplicate_name = any(
        _normalize_unique_text(existing_name) == requested_name_key
        for (existing_name,) in db.query(ParkingLot.name).all()
    )
    if duplicate_name:
        raise HTTPException(status_code=409, detail="Tên bãi đỗ đã tồn tại")

    district_id = current_user.managed_district_id
    district_name = (payload.district or "").strip()
    if district_name:
        district = db.query(District).filter(func.lower(District.name) == district_name.lower()).first()
        if not district:
            district = District(name=district_name)
            db.add(district)
            db.flush()
        district_id = district.id
    elif district_id:
        district = db.query(District).filter(District.id == district_id).first()
        district_name = district.name if district else ""

    latitude, longitude = _resolve_owner_parking_coordinates(name, address, district_name, district_id, db)

    lot = ParkingLot(
        name=name,
        address=address,
        phone=payload.phone.strip() if payload.phone and payload.phone.strip() else current_user.phone,
        district_id=district_id,
        latitude=latitude,
        longitude=longitude,
        has_roof=0,
        is_active=1,
    )
    db.add(lot)
    db.flush()

    db.add(ParkingPrice(
        parking_id=lot.id,
        price_per_hour=10000,
        price_per_day=70000,
        price_per_month=1500000,
    ))

    slot_groups = [
        {
            "zone": group.zone.strip(),
            "level": group.level.strip(),
            "slot_count": int(group.slotCount or 0),
        }
        for group in payload.slotGroups
        if int(group.slotCount or 0) > 0
    ]
    if not slot_groups and payload.slotCount > 0:
        slot_groups = [{
            "zone": (payload.defaultZone or "").strip() or "Khu A",
            "level": (payload.defaultLevel or "").strip() or "Tầng 1",
            "slot_count": int(payload.slotCount or 0),
        }]

    total_slot_count = sum(group["slot_count"] for group in slot_groups)
    if total_slot_count > 500:
        raise HTTPException(status_code=422, detail="Tổng số chỗ ban đầu không được vượt quá 500")

    now = vn_now()
    slot_index = 1
    for group in slot_groups:
        for _ in range(group["slot_count"]):
            code = f"P{lot.id}-{slot_index}"
            db.add(ParkingSlot(
                parking_id=lot.id,
                slot_number=str(slot_index),
                slot_type="normal",
                zone=group["zone"],
                level=group["level"],
                code=code,
                status="available",
                created_at=now,
                updated_at=now,
            ))
            slot_index += 1

    db.add(OwnerParking(owner_id=current_user.id, parking_id=lot.id))
    db.flush()
    employee = create_employee_for_owner(
        owner=current_user,
        full_name=f"Nhân viên {lot.name}",
        email="",
        phone=lot.phone or current_user.phone or "0000000000",
        password="",
        parking_id=lot.id,
        db=db,
        commit=False,
    )
    log_owner_activity(
        current_user.id,
        "parking_created",
        f"Tạo bãi «{lot.name}» · {total_slot_count} chỗ đỗ",
        db,
        parking_id=int(lot.id),
    )
    db.commit()
    db.refresh(lot)
    return {
        "message": "Đã tạo bãi đỗ",
        "parkingLot": {
            "id": lot.id,
            "name": lot.name,
            "address": lot.address,
            "district": lot.district.name if lot.district else None,
            "latitude": float(lot.latitude) if lot.latitude is not None else None,
            "longitude": float(lot.longitude) if lot.longitude is not None else None,
        },
        "employee": employee,
    }


@router.get("/slots/{slot_id}/detail")
def get_owner_slot_detail(
    slot_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ")

    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == slot.parking_id).first()
    if not parking_lot:
        raise HTTPException(status_code=404, detail="Không tìm thấy bãi đỗ")

    owner_assignment = _get_owner_parking_assignment(current_user.id, parking_lot.id, db)
    has_owner_detail = owner_assignment is not None

    active_bookings = (
        db.query(Booking)
        .filter(
            Booking.slot_id == slot.id,
            Booking.status.in_(["pending", "booked", "checked_in"]),
        )
        .order_by(Booking.id.desc())
        .all()
    )
    booking_statuses = {(item.status or "").lower() for item in active_bookings}
    active_booking = active_bookings[0] if active_bookings else None
    user = active_booking.user if active_booking else None
    payment = db.query(Payment).filter(Payment.booking_id == active_booking.id).first() if active_booking else None
    layout_meta = _slot_layout_meta(slot)
    effective_status = _owner_slot_status(slot.status, booking_statuses)

    return {
        "parking": {
            "id": parking_lot.id,
            "name": parking_lot.name,
            "address": parking_lot.address,
            "district": parking_lot.district.name if parking_lot.district else None,
        },
        "slot": {
            "id": slot.id,
            "code": _display_slot_code(slot),
            "status": effective_status,
            "rawStatus": slot.status,
            **layout_meta,
        },
        "access": {
            "has_owner_detail": has_owner_detail,
            "owner_parking_id": owner_assignment.parking_id if owner_assignment else None,
        },
        "booking": (
            {
                "id": active_booking.id,
                "code": f"BK-{active_booking.id}",
                "status": _owner_booking_status(active_booking.status),
                "startTime": (active_booking.start_time or active_booking.created_at or datetime.utcnow()).isoformat(),
                "endTime": (active_booking.expire_time or active_booking.created_at or datetime.utcnow()).isoformat(),
                "price": float(active_booking.total_amount or 0),
                "user": user.name if user else "Unknown user",
                "plate": user.vehicle_plate if user and user.vehicle_plate else "Chưa có biển số",
                "phone": user.phone if user and user.phone else "Chưa có",
                "paymentStatus": payment.payment_status if payment else None,
            }
            if has_owner_detail and active_booking
            else None
        ),
    }


@router.post("/slots")
def create_owner_slot(
    payload: OwnerSlotCreateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == payload.parkingId, ParkingLot.is_active == 1).first()
    if not parking_lot or _get_owner_parking_assignment(current_user.id, parking_lot.id, db) is None:
        raise HTTPException(status_code=404, detail="Owner không có quyền thêm chỗ đỗ tại bãi này")

    code = payload.code.strip()
    existing = db.query(ParkingSlot).filter(ParkingSlot.code == code).first()
    if existing:
        raise HTTPException(status_code=409, detail="Mã chỗ đỗ đã tồn tại")
    duplicate_slot_number = (
        db.query(ParkingSlot)
        .filter(
            ParkingSlot.parking_id == parking_lot.id,
            ParkingSlot.slot_number == code,
        )
        .first()
    )
    if duplicate_slot_number:
        raise HTTPException(status_code=409, detail="Mã chỗ đỗ đã tồn tại trong bãi")

    now = vn_now()
    slot = ParkingSlot(
        parking_id=parking_lot.id,
        slot_number=code,
        slot_type="normal",
        zone=payload.zone.strip(),
        level=payload.level.strip(),
        code=code,
        status=_normalize_slot_status(payload.status),
        created_at=now,
        updated_at=now,
    )
    db.add(slot)
    log_owner_activity(
        current_user.id,
        "slot_created",
        f"Thêm chỗ {code} · {payload.zone.strip()} / {payload.level.strip()}",
        db,
        parking_id=int(parking_lot.id),
    )
    db.commit()
    return {"message": "Đã thêm chỗ đỗ"}


@router.patch("/slots/{slot_id}")
def update_owner_slot(
    slot_id: int,
    payload: OwnerSlotUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first()
    if not slot or slot.parking_id is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ")
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == slot.parking_id, ParkingLot.is_active == 1).first()
    if not parking_lot or _get_owner_parking_assignment(current_user.id, parking_lot.id, db) is None:
        raise HTTPException(status_code=404, detail="Owner không có quyền cập nhật chỗ đỗ tại bãi này")

    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id, ParkingSlot.parking_id == parking_lot.id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ")

    if payload.code is not None:
        normalized_code = payload.code.strip()
        duplicate = db.query(ParkingSlot).filter(ParkingSlot.code == normalized_code, ParkingSlot.id != slot.id).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Mã chỗ đỗ đã tồn tại")
        duplicate_slot_number = (
            db.query(ParkingSlot)
            .filter(
                ParkingSlot.parking_id == parking_lot.id,
                ParkingSlot.slot_number == normalized_code,
                ParkingSlot.id != slot.id,
            )
            .first()
        )
        if duplicate_slot_number:
            raise HTTPException(status_code=409, detail="Mã chỗ đỗ đã tồn tại trong bãi")
        slot.code = normalized_code
        slot.slot_number = normalized_code
    if payload.zone is not None:
        slot.zone = payload.zone.strip()
    if payload.level is not None:
        slot.level = payload.level.strip()
    if payload.status is not None:
        slot.status = _normalize_slot_status(payload.status)
    slot.updated_at = vn_now()

    log_owner_activity(
        current_user.id,
        "slot_updated",
        f"Cập nhật chỗ {_display_slot_code(slot)}",
        db,
        parking_id=int(parking_lot.id),
    )
    db.commit()
    return {"message": "Đã cập nhật chỗ đỗ"}


@router.delete("/slots/{slot_id}")
def delete_owner_slot(
    slot_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first()
    if not slot or slot.parking_id is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ")
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == slot.parking_id, ParkingLot.is_active == 1).first()
    if not parking_lot or _get_owner_parking_assignment(current_user.id, parking_lot.id, db) is None:
        raise HTTPException(status_code=404, detail="Owner không có quyền xóa chỗ đỗ tại bãi này")

    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id, ParkingSlot.parking_id == parking_lot.id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ")

    active_booking = (
        db.query(Booking)
        .filter(Booking.slot_id == slot.id, Booking.status.in_(["pending", "booked", "checked_in"]))
        .first()
    )
    if active_booking:
        raise HTTPException(status_code=409, detail="Chỗ đỗ đang có booking hoạt động, không thể xóa")

    slot_code = _display_slot_code(slot)
    parking_id = int(parking_lot.id)
    db.delete(slot)
    log_owner_activity(
        current_user.id,
        "slot_deleted",
        f"Xóa chỗ {slot_code}",
        db,
        parking_id=parking_id,
    )
    db.commit()
    return {"message": "Đã xóa chỗ đỗ"}


@router.patch("/bookings/{booking_id}/status")
def update_owner_booking_status(
    booking_id: int,
    payload: OwnerBookingStatusUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")
    if _get_owner_parking_assignment(current_user.id, booking.parking_id, db) is None:
        raise HTTPException(status_code=404, detail="Owner không có quyền cập nhật booking này")

    target_status = payload.status
    now = vn_now()
    booking.status = _db_booking_status(target_status)
    if target_status == "cancelled":
        booking.cancel_reason = booking.cancel_reason or "Owner hủy booking"
        invalidate_booking_qr_code(booking, db)
    elif target_status == "in_progress" and booking.actual_checkin is None:
        booking.actual_checkin = now
    elif target_status == "completed":
        if booking.actual_checkin is None:
            booking.actual_checkin = booking.start_time or now
        booking.actual_checkout = booking.actual_checkout or now
        invalidate_booking_qr_code(booking, db)

    if target_status == "cancelled" and booking.slot:
        booking.slot.status = "available"
    elif target_status == "confirmed" and booking.slot:
        booking.slot.status = "reserved"
    elif target_status == "in_progress" and booking.slot:
        booking.slot.status = "occupied"
    elif target_status == "completed" and booking.slot:
        booking.slot.status = "available"
    log_owner_activity(
        current_user.id,
        "booking_status_updated",
        f"BK-{booking.id} → {_owner_booking_status(target_status)}",
        db,
        parking_id=int(booking.parking_id) if booking.parking_id else None,
    )
    db.commit()

    if target_status == "confirmed" and not (booking.qr_code or booking.qr_code_path):
        qr_result = generate_booking_qr_code(int(booking.id), db)
        if not qr_result.get("success"):
            raise HTTPException(status_code=500, detail=f"Đã xác nhận booking nhưng không tạo được QR: {qr_result.get('error', 'Unknown error')}")

    return {"message": "Đã cập nhật booking"}


@router.patch("/account")
def update_owner_account(
    payload: OwnerAccountUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    normalized_email = payload.email.lower().strip()
    duplicate = db.query(User).filter(User.email == normalized_email, User.id != current_user.id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Email đã được sử dụng")

    if payload.password or payload.confirmPassword:
        if not payload.password or payload.password != payload.confirmPassword:
            raise HTTPException(status_code=400, detail="Mật khẩu xác nhận không khớp")
        ensure_strong_password(payload.password)
        current_user.password = "__legacy_disabled__"
        current_user.password_hash = generate_password_hash(payload.password)

    current_user.email = normalized_email
    log_owner_activity(current_user.id, "account_updated", "Cập nhật tài khoản đăng nhập owner", db)
    db.commit()
    return {
        "message": "Đã cập nhật tài khoản owner",
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role,
            "name": current_user.name,
        },
    }


@router.patch("/settings")
def update_owner_settings(
    payload: OwnerParkingSettingsUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    if payload.contactPhone is not None:
        current_user.phone = payload.contactPhone.strip()
    if payload.contactEmail is not None and payload.contactEmail.strip():
        duplicate = db.query(User).filter(User.email == payload.contactEmail.lower().strip(), User.id != current_user.id).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Email liên hệ đã được sử dụng")
        current_user.email = payload.contactEmail.lower().strip()

    log_owner_activity(current_user.id, "settings_updated", "Cập nhật thông tin liên hệ owner", db)
    db.commit()
    return {"message": "Đã cập nhật thông tin owner"}


@router.post("/parking-lots/{parking_id}/geocode")
def refresh_owner_parking_coordinates(
    parking_id: int,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == parking_id, ParkingLot.is_active == 1).first()
    if not parking_lot or _get_owner_parking_assignment(current_user.id, parking_lot.id, db) is None:
        raise HTTPException(status_code=404, detail="Owner không có quyền cập nhật bãi này")

    district_name = parking_lot.district.name if parking_lot.district else ""
    latitude, longitude = _resolve_owner_parking_coordinates(
        parking_lot.name,
        parking_lot.address,
        district_name,
        parking_lot.district_id,
        db,
    )
    parking_lot.latitude = latitude
    parking_lot.longitude = longitude
    log_owner_activity(
        current_user.id,
        "parking_updated",
        f"Cập nhật vị trí bản đồ cho «{parking_lot.name}»",
        db,
        parking_id=int(parking_lot.id),
    )
    db.commit()
    return {
        "message": "Đã cập nhật vị trí bản đồ",
        "parkingLot": {
            "id": parking_lot.id,
            "latitude": float(parking_lot.latitude),
            "longitude": float(parking_lot.longitude),
        },
    }


@router.patch("/parking-lots/{parking_id}/settings")
def update_owner_managed_parking_settings(
    parking_id: int,
    payload: OwnerManagedParkingSettingsUpdateRequest,
    current_user: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == parking_id, ParkingLot.is_active == 1).first()
    if not parking_lot or _get_owner_parking_assignment(current_user.id, parking_lot.id, db) is None:
        raise HTTPException(status_code=404, detail="Owner không có quyền cập nhật bãi này")

    if payload.parkingName is not None and payload.parkingName.strip():
        parking_lot.name = payload.parkingName.strip()

    price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == parking_lot.id).first()
    if not price:
        price = ParkingPrice(parking_id=parking_lot.id, price_per_hour=0, price_per_day=0, price_per_month=0)
        db.add(price)

    if payload.pricePerHour is not None:
        price.price_per_hour = float(payload.pricePerHour or 0)
    if payload.pricePerDay is not None:
        price.price_per_day = float(payload.pricePerDay or 0)
    if payload.pricePerMonth is not None:
        price.price_per_month = float(payload.pricePerMonth or 0)

    log_owner_activity(
        current_user.id,
        "parking_updated",
        f"Cập nhật cấu hình bãi «{parking_lot.name}»",
        db,
        parking_id=int(parking_lot.id),
    )
    db.commit()
    return {"message": "Đã cập nhật cấu hình bãi"}


@router.post("/seed-test-data-public")
def seed_test_data_public(db: Session = Depends(get_db)):
    """Tạo dữ liệu test (public endpoint - không cần xác thực)"""
    from datetime import timedelta
    
    try:
        # 1. Lấy owner first (hoặc tạo nếu chưa có)
        owner = db.query(User).filter(User.email == "owner1@gmail.com").first()
        if not owner:
            owner = User(
                name="Owner One",
                email="owner1@gmail.com",
                phone="0901111111",
                role="owner",
                status="active",
                is_active=1,
                password_hash=""
            )
            db.add(owner)
            db.commit()
        
        # 2. Tạo parking lot nếu chưa tồn tại
        parking_lot = db.query(ParkingLot).filter(
            ParkingLot.name == "Smart Parking - Tân Phú"
        ).first()
        
        if not parking_lot:
            parking_lot = ParkingLot(
                name="Smart Parking - Tân Phú",
                address="123 Đường Tân Phú, Quận 5, TP.HCM",
                latitude=10.7910,
                longitude=106.6255,
                has_roof=1,
                is_active=1
            )
            db.add(parking_lot)
            db.commit()
        
        # 3. Gán bãi cho owner nếu chưa tồn tại
        owner_parking = db.query(OwnerParking).filter(
            OwnerParking.owner_id == owner.id,
            OwnerParking.parking_id == parking_lot.id
        ).first()
        
        if not owner_parking:
            owner_parking = OwnerParking(
                owner_id=owner.id,
                parking_id=parking_lot.id
            )
            db.add(owner_parking)
            db.commit()
        
        # 4. Tạo parking slots
        slot_codes = ["A-01", "A-02", "B-01", "B-02", "C-01"]
        for code in slot_codes:
            existing = db.query(ParkingSlot).filter(
                ParkingSlot.code == code
            ).first()
            if not existing:
                slot = ParkingSlot(
                    parking_id=parking_lot.id,
                    code=code,
                    status="available"
                )
                db.add(slot)
        db.commit()
        
        # 5. Tạo test users (khách hàng) nếu chưa tồn tại
        test_customers = [
            {"name": "Nguyễn Văn A", "email": "customer1@gmail.com", "phone": "0901234567"},
            {"name": "Trần Thị B", "email": "customer2@gmail.com", "phone": "0909876543"},
            {"name": "Phạm Văn C", "email": "customer3@gmail.com", "phone": "0912345678"},
        ]
        
        customer_users = []
        for cust in test_customers:
            existing = db.query(User).filter(User.email == cust["email"]).first()
            if not existing:
                user = User(
                    name=cust["name"],
                    email=cust["email"],
                    phone=cust["phone"],
                    role="user",
                    status="active",
                    is_active=1,
                    password_hash=""
                )
                db.add(user)
                db.commit()
                customer_users.append(user)
            else:
                customer_users.append(existing)
        
        # 6. Tạo bookings
        now = datetime.utcnow()
        for i, user in enumerate(customer_users):
            # Kiểm tra xem user này đã có booking chưa
            existing_booking = db.query(Booking).filter(
                Booking.user_id == user.id,
                Booking.parking_id == parking_lot.id
            ).first()
            
            if not existing_booking:
                slot = db.query(ParkingSlot).filter(
                    ParkingSlot.code == slot_codes[i % len(slot_codes)]
                ).first()
                
                booking = Booking(
                    user_id=user.id,
                    parking_id=parking_lot.id,
                    slot_id=slot.id if slot else None,
                    start_time=now - timedelta(hours=2),
                    end_time=now + timedelta(hours=1),
                    total_amount=50000 * (i + 1),
                    status="completed" if i % 2 == 0 else "checked_in",
                    booking_mode="hourly",
                    created_at=now
                )
                db.add(booking)
                db.commit()
                
                # 7. Tạo payment
                payment = Payment(
                    booking_id=booking.id,
                    amount=50000 * (i + 1),
                    status="paid" if i % 2 == 0 else "pending",
                    created_at=now - timedelta(hours=1)
                )
                db.add(payment)
                db.commit()
        
        return {
            "status": "success",
            "message": "Dữ liệu test đã được tạo",
            "parking_lot": {
                "id": parking_lot.id,
                "name": parking_lot.name
            },
            "owner": {
                "id": owner.id,
                "email": owner.email
            },
            "customers_created": len(customer_users)
        }
    
    except Exception as e:
        db.rollback()
        return {
            "status": "error",
            "message": f"Lỗi khi tạo dữ liệu test: {str(e)}"
        }
