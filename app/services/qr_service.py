"""
QR Code generation service for parking bookings.
Generates readable QR payload with embedded JSON metadata.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import qrcode
from sqlalchemy.orm import Session

from app.models.models import Booking, ParkingLot, ParkingSlot, Payment, User
from app.utils.timezone import ensure_vn_local_naive, vn_now

logger = logging.getLogger(__name__)


STATUS_LABELS = {
    "pending": "Chờ thanh toán",
    "booked": "Chờ check-in",
    "checked_in": "Đang trong bãi",
    "checked_out": "Đã ra bãi",
    "completed": "Hoàn tất",
    "cancelled": "Đã hủy",
}


def _ensure_qr_directory() -> None:
    os.makedirs("qrcodes", exist_ok=True)


def _format_datetime_vi(dt: datetime | None) -> str:
    if dt is None:
        return "N/A"
    return ensure_vn_local_naive(dt).strftime("%H:%M - %d/%m/%Y")


def _format_datetime_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return ensure_vn_local_naive(dt).isoformat()


def _resolve_slot_display(slot: ParkingSlot | None) -> str:
    if slot is None:
        return "N/A"
    slot_code = slot.slot_number or slot.code or f"S{slot.id}"
    if slot.level:
        return f"O {slot_code} - {slot.level}"
    return f"O {slot_code}"


def invalidate_booking_qr_code(booking: Booking, db: Session) -> dict:
    """Delete QR image file and clear QR metadata for a booking."""
    if not booking:
        return {"success": False, "error": "Booking not found"}

    payment = db.query(Payment).filter(Payment.booking_id == booking.id).first()
    qr_paths = [booking.qr_code_path, booking.qr_code, payment.qr_code if payment else None]
    removed_files: list[str] = []

    for raw_path in qr_paths:
        if not raw_path:
            continue
        normalized = str(raw_path).strip()
        if not normalized:
            continue
        file_path = Path(normalized)
        if not file_path.is_absolute():
            file_path = Path.cwd() / file_path
        if file_path.exists() and file_path.is_file():
            try:
                file_path.unlink()
                removed_files.append(str(file_path))
            except OSError:
                logger.warning("Cannot remove QR file for booking_id=%s path=%s", booking.id, file_path)

    booking.qr_code_path = None
    booking.qr_code = None
    if payment:
        payment.qr_code = None
        payment.vnpay_url = None
    booking.qr_token_expires_at = vn_now()
    booking.qr_generated_at = vn_now()
    db.flush()

    return {
        "success": True,
        "booking_id": booking.id,
        "removed_files": removed_files,
    }


def generate_booking_qr_code(booking_id: int, db: Session) -> dict:
    """Generate booking QR and persist path to the booking row."""

    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        return {"success": False, "error": "Booking not found"}

    parking = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first() if booking.parking_id else None
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first() if booking.slot_id else None
    user = db.query(User).filter(User.id == booking.user_id).first() if booking.user_id else None

    parking_name = parking.name if parking else "Unknown parking"
    parking_phone = "N/A"
    license_plate = (user.vehicle_plate if user else None) or "N/A"
    slot_display = _resolve_slot_display(slot)
    status_text = STATUS_LABELS.get((booking.status or "").lower(), booking.status or "Unknown")
    if booking.actual_checkout and (booking.status or "").lower() in {"completed", "checked_out"}:
        status_text = f"Đã check-out lúc {_format_datetime_vi(booking.actual_checkout)}"

    human_readable_content = (
        "=== PHIEU GUI XE THONG MINH ===\n"
        f"Mã đặt chỗ  : #{booking.id}\n"
        f"Biển số xe  : {license_plate}\n"
        f"Bãi đỗ      : {parking_name}\n"
        f"Vị trí      : {slot_display}\n"
        f"Vào lúc     : {_format_datetime_vi(booking.start_time)}\n"
        f"Ra dự kiến  : {_format_datetime_vi(booking.expire_time)}\n"
        f"Trạng thái  : {status_text}\n"
        "================================\n"
        "Quét tại cổng để vào/ra bãi xe\n"
        f"Hotline: {parking_phone}"
    )

    metadata = {
        "b": booking.id,
        "u": booking.user_id,
        "p": booking.parking_id,
        "s": booking.slot_id,
        "v": license_plate,
        "ci": _format_datetime_iso(booking.start_time),
        "co": _format_datetime_iso(booking.expire_time),
    }
    metadata_str = json.dumps(metadata, separators=(",", ":"))
    qr_content = f"{human_readable_content}\n\n{metadata_str}"

    try:
        _ensure_qr_directory()
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=4,
        )
        qr.add_data(qr_content)
        qr.make(fit=True)
        image = qr.make_image(fill_color="black", back_color="white")

        qr_filename = f"booking_{booking_id}.png"
        qr_path = f"qrcodes/{qr_filename}"
        image.save(qr_path)

        booking.qr_code_path = qr_path
        booking.qr_generated_at = vn_now()
        booking.qr_code = qr_path

        db.commit()
        db.refresh(booking)

        return {
            "success": True,
            "booking_id": booking.id,
            "qr_code_path": qr_path,
            "qr_url": f"/qrcodes/{qr_filename}",
            "generated_at": booking.qr_generated_at,
        }
    except Exception as exc:
        db.rollback()
        logger.exception("Failed generating booking QR for booking_id=%s", booking_id)
        return {"success": False, "error": str(exc)}
