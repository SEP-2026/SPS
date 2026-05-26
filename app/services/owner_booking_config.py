from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.models import Booking, OwnerBookingConfig, OwnerParking

DEFAULT_OWNER_BOOKING_CONFIG: dict = {
    "allowPrebook": True,
    "maxPrebookDays": 7,
    "holdMinutes": 15,
    "maxSlotsPerBooking": 1,
    "requireDeposit": True,
    "depositPercent": 30,
    "allowCancel": True,
    "freeCancelValue": 60,
    "freeCancelUnit": "minutes",
    "refundOnTimePercent": 100,
    "forfeitDepositLate": True,
    "allowCancelOverlap": False,
    "overlapOnlyBeforeCheckin": True,
    "overlapRefundPercent": 100,
    "refundToWalletHours": 24,
    "allowReschedule": True,
    "maxRescheduleTimes": 1,
    "rescheduleBeforeValue": 120,
    "rescheduleBeforeUnit": "minutes",
    "earlyCheckinFreeMinutes": 30,
    "earlyCheckinChargeHours": 1,
    "maxLateCheckinMinutes": 15,
    "lateCheckinAction": "auto_cancel",
    "remindBeforeCheckinMinutes": 15,
    "allowLateCheckout": True,
    "lateCheckoutFreeMinutes": 15,
    "lateCheckoutChargePerHours": 1,
    "lateCheckoutDayThresholdHours": 4,
    "qrShared": True,
    "qrValidInBookingWindow": True,
    "qrNoReuse": True,
    "qrEncryptedPerBooking": True,
    "hourlySingleEntry": True,
    "dailyMaxEntries": 5,
    "monthlyUnlimited": True,
    "notifyBookingSuccess": True,
    "notifyDepositSuccess": True,
    "notifyCheckinReminder": True,
    "notifyHoldExpiring": True,
    "notifyBookingCancelled": True,
    "notifyRefundWallet": True,
    "templates": {
        "bookingConfirm": "Xin chào {ten_khach}, đặt chỗ {ma_dat_cho} tại {ten_bai_xe} đã được ghi nhận. Giờ vào: {gio_vao}.",
        "depositSuccess": "Thanh toán cọc {so_tien} cho booking {ma_dat_cho} thành công.",
        "checkinReminder": "Nhắc bạn check-in booking {ma_dat_cho} sau {phut} phút nữa tại {ten_bai_xe}.",
        "cancelled": "Booking {ma_dat_cho} đã bị huỷ. {hoan_tien}",
        "refund": "Đã hoàn {so_tien} về ví cho booking {ma_dat_cho}.",
        "checkoutSuccess": "Check-out thành công booking {ma_dat_cho}. Cảm ơn bạn đã sử dụng dịch vụ.",
        "lateFee": "Booking {ma_dat_cho} phát sinh phí trễ {so_tien}. Vui lòng thanh toán trên ứng dụng.",
    },
}


def _deep_merge(base: dict, patch: dict) -> dict:
    result = deepcopy(base)
    for key, value in patch.items():
        if key == "templates" and isinstance(value, dict):
            result["templates"] = {**result.get("templates", {}), **value}
        else:
            result[key] = value
    return result


def normalize_owner_booking_config(raw: dict | None) -> dict:
    if not isinstance(raw, dict):
        return deepcopy(DEFAULT_OWNER_BOOKING_CONFIG)
    return _deep_merge(DEFAULT_OWNER_BOOKING_CONFIG, raw)


def _owner_id_for_parking(db: Session, parking_id: int | None) -> int | None:
    if not parking_id:
        return None
    row = (
        db.query(OwnerParking.owner_id)
        .filter(OwnerParking.parking_id == int(parking_id))
        .order_by(OwnerParking.id.asc())
        .first()
    )
    return int(row[0]) if row else None


def get_owner_booking_config_row(db: Session, owner_id: int) -> OwnerBookingConfig | None:
    return db.query(OwnerBookingConfig).filter(OwnerBookingConfig.owner_id == int(owner_id)).first()


def get_owner_booking_config(db: Session, owner_id: int) -> dict:
    row = get_owner_booking_config_row(db, owner_id)
    if not row or not row.config_json:
        return deepcopy(DEFAULT_OWNER_BOOKING_CONFIG)
    try:
        parsed = json.loads(row.config_json)
    except (TypeError, json.JSONDecodeError):
        parsed = {}
    return normalize_owner_booking_config(parsed)


def get_parking_booking_config(db: Session, parking_id: int | None) -> dict:
    owner_id = _owner_id_for_parking(db, parking_id)
    if owner_id is None:
        return deepcopy(DEFAULT_OWNER_BOOKING_CONFIG)
    return get_owner_booking_config(db, owner_id)


def save_owner_booking_config(db: Session, owner_id: int, payload: dict) -> dict:
    normalized = normalize_owner_booking_config(payload)
    row = get_owner_booking_config_row(db, owner_id)
    if row is None:
        row = OwnerBookingConfig(owner_id=int(owner_id), config_json=json.dumps(normalized, ensure_ascii=False))
        db.add(row)
    else:
        row.config_json = json.dumps(normalized, ensure_ascii=False)
    db.commit()
    db.refresh(row)
    return normalized


def deposit_ratio(config: dict, booking_mode: str | None = None) -> float:
    if not config.get("requireDeposit", True):
        return 0.0
    if booking_mode and str(booking_mode).lower() != "hourly":
        return 0.0
    try:
        percent = float(config.get("depositPercent", 30))
    except (TypeError, ValueError):
        percent = 30.0
    return max(0.0, min(1.0, percent / 100.0))


def deposit_amount_for_booking(booking: Booking, config: dict | None = None) -> float:
    cfg = config or DEFAULT_OWNER_BOOKING_CONFIG
    ratio = deposit_ratio(cfg, booking.booking_mode)
    return round(float(booking.total_amount or 0) * ratio, 2)


def no_show_deadline(booking: Booking, config: dict | None = None) -> datetime | None:
    if not booking.start_time:
        return None
    if str(booking.booking_mode or "").lower() != "hourly":
        return None
    cfg = config or DEFAULT_OWNER_BOOKING_CONFIG
    try:
        minutes = int(cfg.get("maxLateCheckinMinutes", 15))
    except (TypeError, ValueError):
        minutes = 15
    if minutes <= 0:
        return None
    return booking.start_time + timedelta(minutes=minutes)


def is_no_show_past_deadline(booking: Booking, now: datetime, config: dict | None = None) -> bool:
    deadline = no_show_deadline(booking, config)
    if deadline is None or booking.actual_checkin is not None:
        return False
    return now > deadline
