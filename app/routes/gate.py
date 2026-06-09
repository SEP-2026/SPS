import json
import math
import os
import re
from datetime import datetime, timedelta
from urllib.parse import quote_plus
from zoneinfo import ZoneInfo

import qrcode
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Booking, OwnerParking, ParkingLot, ParkingPrice, ParkingSlot, Payment, Transaction, User, UserVehicle
from app.routes.auth import get_current_user
from app.services.owner_booking_config import (
    deposit_amount_for_booking,
    deposit_ratio,
    get_parking_booking_config,
    no_show_deadline as config_no_show_deadline,
)
from app.services.qr_service import invalidate_booking_qr_code

router = APIRouter(prefix="/gate", tags=["gate"])

SCAN_COOLDOWN_MINUTES = int(os.getenv("GATE_SCAN_COOLDOWN_MINUTES", "5"))
NO_SHOW_CANCEL_RATIO = float(os.getenv("GATE_NO_SHOW_CANCEL_RATIO", "0.3"))
EARLY_CHECKIN_POLICY = os.getenv("GATE_EARLY_CHECKIN_POLICY", "ALLOW_WITH_EXTRA_FEE").strip().upper()
EARLY_GRACE_MINUTES = int(os.getenv("GATE_EARLY_GRACE_MINUTES", "15"))
APP_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


class GateResolveRequest(BaseModel):
    raw_scan_text: str = Field(min_length=1, max_length=4000)
    source_type: str = Field(pattern="^(manual_id|qr_scan)$")
    gate_id: str = Field(min_length=1, max_length=100)


class GateCheckInRequest(BaseModel):
    booking_id: int = Field(gt=0)
    gate_id: str = Field(min_length=1, max_length=100)
    source_type: str = Field(pattern="^(manual_id|qr_scan)$")


class GateCheckOutRequest(BaseModel):
    booking_id: int = Field(gt=0)
    gate_id: str = Field(min_length=1, max_length=100)
    source_type: str = Field(pattern="^(manual_id|qr_scan)$")
    payment_method: str = Field(pattern="^(cash|bank_transfer|qr|vnpay)$")


def _local_now() -> datetime:
    # Booking times in the current project are effectively being treated as Vietnam local time.
    # Store gate action timestamps with the same naive-local convention to avoid a 7-hour shift.
    return datetime.now(APP_TIMEZONE).replace(tzinfo=None)


def _normalized_role(current_user: User) -> str:
    return (getattr(current_user, "role", "") or "").strip().lower()


def _ensure_gate_operator(current_user: User) -> None:
    role = _normalized_role(current_user)
    if role not in {"owner", "admin", "employee"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chá»‰ owner, admin hoáº·c employee má»›i Ä‘Æ°á»£c thao tÃ¡c táº¡i cá»•ng")


def _extract_json_candidate(raw_value: str) -> dict | None:
    text = raw_value.strip()
    if not text:
        return None
    candidates = [text]
    matches = re.findall(r"\{.*\}", text, flags=re.DOTALL)
    if matches:
        candidates.extend(reversed(matches))
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            continue
    return None


def _parse_scan_payload(raw_value: str, source_type: str) -> dict:
    text = raw_value.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Ná»™i dung quÃ©t khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng")

    if source_type == "manual_id":
        if not text.isdigit():
            raise HTTPException(status_code=400, detail="Booking ID thá»§ cÃ´ng pháº£i lÃ  sá»‘ nguyÃªn dÆ°Æ¡ng")
        return {
            "booking_id": int(text),
            "input_type": "manual_id",
            "input_label": "Booking ID thá»§ cÃ´ng",
            "payload": None,
        }

    payload = _extract_json_candidate(text)
    if payload:
        booking_id = payload.get("booking_id") or payload.get("b") or payload.get("id")
        try:
            booking_id = int(booking_id)
        except (TypeError, ValueError):
            booking_id = None
        if not booking_id or booking_id <= 0:
            raise HTTPException(status_code=400, detail="QR há»£p lá»‡ nhÆ°ng khÃ´ng cÃ³ booking_id kháº£ dá»¥ng")
        return {
            "booking_id": booking_id,
            "input_type": "qr_json" if "booking_id" in payload else "qr_booking",
            "input_label": "QR JSON" if "booking_id" in payload else "QR booking",
            "payload": payload,
        }

    if text.isdigit():
        return {
            "booking_id": int(text),
            "input_type": "qr_booking",
            "input_label": "QR booking",
            "payload": {"booking_id": int(text)},
        }

    raise HTTPException(status_code=400, detail="QR khÃ´ng há»£p lá»‡ hoáº·c khÃ´ng parse Ä‘Æ°á»£c ná»™i dung booking")


def _round_up_hours(hours: float) -> int:
    return max(1, int(math.ceil(max(hours, 0))))


def _round_up_days(hours: float) -> int:
    return max(1, int(math.ceil(max(hours, 0) / 24)))


def _assert_gate_permission(current_user: User, booking: Booking, db: Session) -> None:
    _ensure_gate_operator(current_user)
    role = _normalized_role(current_user)
    if role == "admin":
        return
    if role == "employee":
        if int(current_user.parking_id) != int(booking.parking_id or 0):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employee khÃƒÂ´ng cÃƒÂ³ quyÃ¡Â»Ân thao tÃƒÂ¡c tÃ¡ÂºÂ¡i bÃƒÂ£i nÃƒÂ y")
        return
    assignment = (
        db.query(OwnerParking)
        .filter(
            OwnerParking.owner_id == current_user.id,
            OwnerParking.parking_id == booking.parking_id,
        )
        .first()
    )
    if assignment:
        return

    # Fallback for deployments still mapping owner by managed district.
    owner_managed_district_id = getattr(current_user, "managed_district_id", None)
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first() if booking.parking_id else None
    if owner_managed_district_id and parking_lot and parking_lot.district_id == owner_managed_district_id:
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Báº¡n khÃ´ng cÃ³ quyá»n thao tÃ¡c táº¡i cá»•ng cá»§a bÃ£i nÃ y")


def _display_slot(slot: ParkingSlot | None) -> str | None:
    if not slot:
        return None
    return (slot.slot_number or slot.code or f"Slot-{slot.id}").strip()


def _resolve_license_plate(booking: Booking, user: User | None, vehicle_profile: UserVehicle | None) -> str | None:
    if vehicle_profile and vehicle_profile.license_plate:
        return vehicle_profile.license_plate
    if user and user.vehicle_plate:
        return user.vehicle_plate
    return None


def _get_payment(booking_id: int, db: Session, lock: bool = False) -> Payment | None:
    query = db.query(Payment).filter(Payment.booking_id == booking_id)
    if lock:
        query = query.with_for_update()
    return query.first()


def _get_price(booking: Booking, db: Session) -> ParkingPrice | None:
    if booking.parking_id is None:
        return None
    return db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first()


def _booking_window_hours(booking: Booking) -> float:
    if not booking.start_time or not booking.expire_time:
        return 0
    return max((booking.expire_time - booking.start_time).total_seconds() / 3600, 0)


def _no_show_deadline(booking: Booking, db: Session) -> datetime | None:
    config = get_parking_booking_config(db, booking.parking_id)
    deadline = config_no_show_deadline(booking, config)
    if deadline is not None:
        return deadline
    if booking.booking_mode != "hourly" or not booking.start_time or not booking.expire_time:
        return None
    duration_seconds = max((booking.expire_time - booking.start_time).total_seconds(), 0)
    return booking.start_time + timedelta(seconds=duration_seconds * NO_SHOW_CANCEL_RATIO)


def _invalidate_qr(booking: Booking, when: datetime) -> None:
    booking.qr_token_expires_at = when


def _create_gate_log(
    *,
    booking: Booking,
    user: User | None,
    gate_id: str,
    source_type: str,
    action_type: str,
    result: str,
    note: str | None,
    db: Session,
) -> None:
    license_plate = _resolve_license_plate(
        booking,
        user,
        db.query(UserVehicle).filter(UserVehicle.user_id == booking.user_id).first() if booking.user_id else None,
    )
    db.add(
        Transaction(
            booking_id=booking.id,
            amount=0,
            payment_status=result,
            user_id=booking.user_id,
            parking_id=booking.parking_id,
            vehicle_id=booking.vehicle_id,
            gate_id=gate_id,
            action_type=action_type,
            source_type=source_type,
            result=result,
            note=note,
            license_plate=license_plate,
        )
    )


def _status_label(status_value: str | None) -> str:
    mapping = {
        "pending": "Chá» xÃ¡c nháº­n",
        "booked": "ÄÃ£ Ä‘áº·t chá»—",
        "checked_in": "Äang trong bÃ£i",
        "checked_out": "ÄÃ£ ra bÃ£i",
        "completed": "HoÃ n táº¥t",
        "cancelled": "ÄÃ£ há»§y",
    }
    return mapping.get((status_value or "").lower(), status_value or "--")


def _normalize_payment_method(value: str) -> str:
    return "qr" if value in {"bank_transfer", "qr"} else value


def _generate_payment_artifact(booking_id: int, amount: float, payment_method: str) -> tuple[str | None, str | None]:
    if amount <= 0:
        return None, None
    os.makedirs("qrcodes", exist_ok=True)
    if payment_method == "vnpay":
        vnpay_url = (
            "https://sandbox.vnpayment.vn/payment"
            f"?booking_id={booking_id}&amount={quote_plus(str(int(round(amount))))}"
        )
        qr_path = f"qrcodes/gate_payment_{booking_id}.png"
        image = qrcode.make(vnpay_url)
        image.save(qr_path)
        return qr_path, vnpay_url
    if payment_method == "qr":
        qr_payload = json.dumps(
            {
                "type": "gate_checkout_payment",
                "booking_id": booking_id,
                "amount": round(amount, 2),
            },
            separators=(",", ":"),
        )
        qr_path = f"qrcodes/gate_payment_{booking_id}.png"
        image = qrcode.make(qr_payload)
        image.save(qr_path)
        return qr_path, None
    return None, None


def _resolve_prepaid_amount(payment: Payment | None) -> float:
    if not payment or payment.payment_status != "paid":
        return 0
    return float(payment.amount or 0)


def _expire_no_show_booking_if_needed(booking: Booking, payment: Payment | None, now: datetime, db: Session) -> bool:
    config = get_parking_booking_config(db, booking.parking_id)
    deadline = _no_show_deadline(booking, db)
    if booking.actual_checkin or deadline is None:
        return False
    if booking.status not in {"pending", "booked"}:
        return False
    if now <= deadline:
        return False

    booking.status = "cancelled"
    booking.cancel_reason = "QuÃ¡ thá»i háº¡n check-in cho phÃ©p"
    booking.last_gate_action = "expired"
    booking.last_gate_action_at = now
    _invalidate_qr(booking, now)
    if booking.slot:
        booking.slot.status = "available"
    if payment and float(payment.deposit_amount or 0) <= 0 and float(payment.amount or 0) > 0:
        forfeited = deposit_amount_for_booking(booking, config)
        payment.deposit_amount = round(min(forfeited, float(payment.amount or 0)), 2)
    return True


def _compute_pricing_preview(
    booking: Booking,
    payment: Payment | None,
    price: ParkingPrice | None,
    now: datetime,
    db: Session,
) -> dict:
    config = get_parking_booking_config(db, booking.parking_id)
    try:
        early_grace_minutes = int(config.get("earlyCheckinFreeMinutes", EARLY_GRACE_MINUTES))
    except (TypeError, ValueError):
        early_grace_minutes = EARLY_GRACE_MINUTES
    base_booking_cost = round(float(booking.total_amount or 0), 2)
    ratio = deposit_ratio(config, booking.booking_mode)
    deposit_due = round(base_booking_cost * ratio, 2) if ratio > 0 else 0
    deposit_paid = round(float(payment.deposit_amount or 0), 2) if payment else 0
    prepaid_amount = round(_resolve_prepaid_amount(payment), 2)
    payment_status = payment.payment_status if payment else None

    scheduled_start = booking.start_time
    scheduled_end = booking.expire_time
    actual_checkin = booking.actual_checkin
    actual_checkout = booking.actual_checkout

    early_extra_fee = 0.0
    overtime_fee = round(float(payment.overtime_fee or 0), 2) if payment else 0.0
    usage_hours = 0.0
    resolved_mode = booking.booking_mode
    unit_price = 0.0

    if booking.booking_mode == "hourly" and price and actual_checkin:
        effective_checkout = actual_checkout or now
        billable_start = actual_checkin
        if scheduled_start:
            grace_threshold = scheduled_start - timedelta(minutes=early_grace_minutes)
            if actual_checkin >= grace_threshold:
                billable_start = min(scheduled_start, actual_checkin)
        usage_hours = max((effective_checkout - billable_start).total_seconds() / 3600, 0)
        if usage_hours > 12:
            resolved_mode = "daily"
            billed_units = _round_up_days(usage_hours)
            unit_price = float(price.price_per_day or 0)
            actual_usage_cost = round(billed_units * unit_price, 2)
        else:
            resolved_mode = "hourly"
            billed_units = _round_up_hours(usage_hours)
            unit_price = float(price.price_per_hour or 0)
            actual_usage_cost = round(billed_units * unit_price, 2)
        total_charge = max(base_booking_cost, actual_usage_cost)
    elif booking.booking_mode == "daily" and price:
        usage_hours = max(
            ((actual_checkout or now) - (actual_checkin or scheduled_start or now)).total_seconds() / 3600,
            0,
        )
        unit_price = float(price.price_per_day or 0)
        total_charge = base_booking_cost or unit_price
    elif booking.booking_mode == "monthly" and price:
        usage_hours = max(
            ((actual_checkout or now) - (actual_checkin or scheduled_start or now)).total_seconds() / 3600,
            0,
        )
        unit_price = float(price.price_per_month or 0)
        total_charge = base_booking_cost or unit_price
    else:
        total_charge = base_booking_cost

    if booking.booking_mode == "hourly" and scheduled_start and actual_checkin:
        early_grace_limit = scheduled_start - timedelta(minutes=early_grace_minutes)
        if actual_checkin < early_grace_limit and price:
            extra_hours = (early_grace_limit - actual_checkin).total_seconds() / 3600
            early_extra_fee = round(_round_up_hours(extra_hours) * float(price.price_per_hour or 0), 2)
            if EARLY_CHECKIN_POLICY == "ALLOW_WITH_EXTRA_FEE":
                total_charge = max(total_charge, base_booking_cost + early_extra_fee)

    extra_fee = max(round(total_charge - base_booking_cost, 2), 0)
    if overtime_fee > extra_fee:
        extra_fee = overtime_fee

    remaining_due = max(round(total_charge - prepaid_amount, 2), 0)
    qr_expired = booking.qr_token_expires_at is not None and booking.qr_token_expires_at <= now
    expired = bool(scheduled_end and now > scheduled_end and booking.status in {"pending", "booked", "checked_out"})

    return {
        "pricing_mode": booking.booking_mode,
        "resolved_mode": resolved_mode,
        "scheduled_hours": round(_booking_window_hours(booking), 2),
        "actual_hours": round(usage_hours, 2),
        "unit_price": round(unit_price, 2),
        "base_booking_cost": base_booking_cost,
        "deposit_due": deposit_due,
        "deposit_paid": deposit_paid,
        "prepaid_amount": prepaid_amount,
        "extra_fee": extra_fee,
        "total_charge": round(total_charge, 2),
        "remaining_due": remaining_due,
        "payment_status": payment_status,
        "is_no_show_deadline_passed": bool(_no_show_deadline(booking, db) and now > _no_show_deadline(booking, db)),
        "expired": expired,
        "qr_expired": qr_expired,
    }


def _allowed_actions(booking: Booking, payment: Payment | None, now: datetime) -> list[str]:
    if booking.status in {"cancelled", "completed"}:
        return []
    if booking.qr_token_expires_at and booking.qr_token_expires_at <= now:
        return []
    payment_ok = not payment or payment.payment_status == "paid" or float(payment.amount or 0) <= 0
    if booking.status in {"pending", "booked"}:
        return ["check_in"] if payment_ok else []
    if booking.status == "checked_in":
        return ["check_out"]
    if booking.status == "checked_out" and booking.booking_mode in {"daily", "monthly"} and booking.expire_time and now <= booking.expire_time:
        return ["check_in"]
    return []


def _cooldown_info(booking: Booking, now: datetime) -> dict:
    if not booking.last_gate_action_at or not booking.last_gate_action:
        return {"active": False, "minutes": SCAN_COOLDOWN_MINUTES, "remaining_seconds": 0, "message": None}
    deadline = booking.last_gate_action_at + timedelta(minutes=SCAN_COOLDOWN_MINUTES)
    remaining_seconds = max(int((deadline - now).total_seconds()), 0)
    active = remaining_seconds > 0 and booking.last_gate_action == "check_in"
    message = None
    if active:
        message = (
            f"QR Ä‘Ã£ Ä‘Æ°á»£c check-in lÃºc {booking.last_gate_action_at.strftime('%H:%M')}, "
            f"vui lÃ²ng chá» tá»‘i thiá»ƒu {SCAN_COOLDOWN_MINUTES} phÃºt trÆ°á»›c khi quÃ©t ra"
        )
    return {
        "active": active,
        "minutes": SCAN_COOLDOWN_MINUTES,
        "remaining_seconds": remaining_seconds,
        "message": message,
        "last_action": booking.last_gate_action,
        "last_action_at": booking.last_gate_action_at.isoformat() if booking.last_gate_action_at else None,
    }


def _serialize_history(booking_id: int, db: Session) -> list[dict]:
    rows = (
        db.query(Transaction)
        .filter(Transaction.booking_id == booking_id, Transaction.action_type.in_(["resolve", "check_in", "check_out"]))
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "booking_id": row.booking_id,
            "vehicle_id": row.vehicle_id,
            "license_plate": row.license_plate,
            "user_id": row.user_id,
            "gate_id": row.gate_id,
            "action_type": row.action_type,
            "source_type": row.source_type,
            "timestamp": row.created_at,
            "image_url": row.image_url,
            "result": row.result,
            "note": row.note,
        }
        for row in rows
    ]


def _serialize_booking_detail(booking: Booking, payment: Payment | None, db: Session, now: datetime, parsed: dict | None = None) -> dict:
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first() if booking.parking_id else None
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == booking.slot_id).first() if booking.slot_id else None
    user = db.query(User).filter(User.id == booking.user_id).first() if booking.user_id else None
    vehicle_profile = db.query(UserVehicle).filter(UserVehicle.user_id == booking.user_id).first() if booking.user_id else None
    price = _get_price(booking, db)
    pricing_preview = _compute_pricing_preview(booking, payment, price, now, db)

    return {
        "server_now": now,
        "booking_id": booking.id,
        "input_type": parsed["input_type"] if parsed else None,
        "input_label": parsed["input_label"] if parsed else None,
        "booking_status": booking.status,
        "booking_status_label": _status_label(booking.status),
        "booking_mode": booking.booking_mode,
        "booking_mode_label": {
            "hourly": "Theo giá»",
            "daily": "Theo ngÃ y",
            "monthly": "Theo thÃ¡ng",
        }.get((booking.booking_mode or "").lower(), booking.booking_mode),
        "checkin_time": booking.start_time,
        "checkout_time": booking.expire_time,
        "actual_checkin": booking.actual_checkin,
        "actual_checkout": booking.actual_checkout,
        "cancel_reason": booking.cancel_reason,
        "parking": {
            "id": parking_lot.id if parking_lot else None,
            "name": parking_lot.name if parking_lot else None,
            "address": parking_lot.address if parking_lot else None,
        },
        "slot": {
            "id": slot.id if slot else None,
            "code": _display_slot(slot),
            "slot_type": slot.slot_type if slot else None,
            "status": slot.status if slot else None,
        },
        "vehicle": {
            "owner_name": user.name if user else None,
            "license_plate": _resolve_license_plate(booking, user, vehicle_profile),
            "phone": user.phone if user else None,
            "brand": vehicle_profile.brand if vehicle_profile else None,
            "vehicle_model": vehicle_profile.vehicle_model if vehicle_profile else None,
        },
        "payment": {
            "amount": float(payment.amount or 0) if payment else 0,
            "deposit_amount": float(payment.deposit_amount or 0) if payment else 0,
            "overtime_fee": float(payment.overtime_fee or 0) if payment else 0,
            "remaining_amount": float(payment.remaining_amount or 0) if payment else 0,
            "payment_method": payment.payment_method if payment else None,
            "payment_status": payment.payment_status if payment else None,
            "paid_at": payment.paid_at if payment else None,
            "vnpay_url": payment.vnpay_url if payment else None,
            "qr_code": payment.qr_code if payment else None,
        },
        "allowed_actions": _allowed_actions(booking, payment, now),
        "cooldown": _cooldown_info(booking, now),
        "pricing_preview": pricing_preview,
        "history": _serialize_history(booking.id, db),
        "parsed_payload": parsed["payload"] if parsed else None,
        "qr_state": {
            "expires_at": booking.qr_token_expires_at,
            "is_expired": pricing_preview["qr_expired"],
        },
    }


def _ensure_slot_available(booking: Booking, db: Session) -> None:
    if not booking.slot_id:
        return
    active_conflict = (
        db.query(Booking)
        .filter(
            Booking.slot_id == booking.slot_id,
            Booking.id != booking.id,
            Booking.status == "checked_in",
        )
        .first()
    )
    if active_conflict:
        raise HTTPException(status_code=409, detail="Slot hiá»‡n Ä‘ang cÃ³ xe khÃ¡c trong bÃ£i, khÃ´ng thá»ƒ xá»­ lÃ½ check-in sá»›m")


def _execute_check_in(booking: Booking, payment: Payment | None, gate_id: str, source_type: str, actor: User, db: Session) -> dict:
    now = _local_now()
    _assert_gate_permission(actor, booking, db)
    if _expire_no_show_booking_if_needed(booking, payment, now, db):
        raise HTTPException(status_code=400, detail="Booking Ä‘Ã£ háº¿t hiá»‡u lá»±c check-in vÃ  Ä‘Ã£ bá»‹ há»§y")
    if booking.status not in {"pending", "booked", "checked_out"}:
        raise HTTPException(status_code=400, detail=f"Booking Ä‘ang á»Ÿ tráº¡ng thÃ¡i { _status_label(booking.status) }, khÃ´ng thá»ƒ check-in")
    if booking.booking_mode == "hourly" and payment and payment.payment_status != "paid":
        raise HTTPException(status_code=400, detail="Booking theo giá» chÆ°a hoÃ n táº¥t thanh toÃ¡n/cá»c nÃªn khÃ´ng thá»ƒ check-in")
    if booking.qr_token_expires_at and booking.qr_token_expires_at <= now:
        raise HTTPException(status_code=400, detail="QR/token cá»§a booking Ä‘Ã£ háº¿t hiá»‡u lá»±c")
    if booking.expire_time and now > booking.expire_time:
        raise HTTPException(status_code=400, detail="Booking Ä‘Ã£ háº¿t thá»i gian hiá»‡u lá»±c")
    if booking.start_time:
        checkin_config = get_parking_booking_config(db, booking.parking_id)
        try:
            grace_minutes = int(checkin_config.get("earlyCheckinFreeMinutes", EARLY_GRACE_MINUTES))
        except (TypeError, ValueError):
            grace_minutes = EARLY_GRACE_MINUTES
        grace_limit = booking.start_time - timedelta(minutes=grace_minutes)
        if now < grace_limit and EARLY_CHECKIN_POLICY == "REJECT":
            raise HTTPException(status_code=400, detail="Xe Ä‘áº¿n quÃ¡ sá»›m so vá»›i giá» booking, vui lÃ²ng chá» Ä‘Ãºng giá»")
        _ensure_slot_available(booking, db)

    if booking.actual_checkin is None:
        booking.actual_checkin = now
    booking.status = "checked_in"
    booking.last_gate_action = "check_in"
    booking.last_gate_action_at = now
    if booking.slot:
        booking.slot.status = "occupied"
    _create_gate_log(
        booking=booking,
        user=db.query(User).filter(User.id == booking.user_id).first() if booking.user_id else None,
        gate_id=gate_id,
        source_type=source_type,
        action_type="check_in",
        result="success",
        note="Check-in thÃ nh cÃ´ng táº¡i cá»•ng",
        db=db,
    )
    db.flush()
    return _serialize_booking_detail(booking, payment, db, now)


def _execute_check_out(
    booking: Booking,
    payment: Payment | None,
    gate_id: str,
    source_type: str,
    payment_method: str,
    actor: User,
    db: Session,
) -> dict:
    now = _local_now()
    _assert_gate_permission(actor, booking, db)
    if booking.status != "checked_in":
        raise HTTPException(status_code=400, detail="Booking chÆ°a á»Ÿ tráº¡ng thÃ¡i Ä‘ang trong bÃ£i")

    price = _get_price(booking, db)
    booking.actual_checkout = now
    preview = _compute_pricing_preview(booking, payment, price, now, db)
    normalized_payment_method = _normalize_payment_method(payment_method)

    if payment is None:
        payment = Payment(
            booking_id=booking.id,
            amount=0,
            overtime_fee=0,
            payment_method=normalized_payment_method,
            payment_status="pending",
            deposit_amount=0,
            remaining_amount=0,
        )
        db.add(payment)
        db.flush()

    payment.payment_method = normalized_payment_method
    payment.deposit_amount = round(float(payment.deposit_amount or 0), 2)
    if payment.payment_status == "paid":
        payment.amount = max(round(float(payment.amount or 0), 2), preview["base_booking_cost"])
    else:
        payment.amount = preview["base_booking_cost"]
    payment.overtime_fee = preview["extra_fee"]
    payment.remaining_amount = 0
    payment.payment_status = "paid"
    payment.paid_at = now
    qr_path, vnpay_url = _generate_payment_artifact(booking.id, preview["remaining_due"], normalized_payment_method)
    if qr_path:
        payment.qr_code = qr_path
    if vnpay_url:
        payment.vnpay_url = vnpay_url

    if booking.booking_mode in {"daily", "monthly"} and booking.expire_time and now < booking.expire_time:
        booking.status = "checked_out"
        booking.qr_token_expires_at = booking.expire_time
    else:
        booking.status = "completed"
        _invalidate_qr(booking, now)
    invalidate_booking_qr_code(booking, db)

    booking.last_gate_action = "check_out"
    booking.last_gate_action_at = now
    if booking.slot:
        booking.slot.status = "available"

    _create_gate_log(
        booking=booking,
        user=db.query(User).filter(User.id == booking.user_id).first() if booking.user_id else None,
        gate_id=gate_id,
        source_type=source_type,
        action_type="check_out",
        result="success",
        note=f"Check-out thÃ nh cÃ´ng, thanh toÃ¡n báº±ng {payment_method}",
        db=db,
    )
    db.flush()
    return _serialize_booking_detail(booking, payment, db, now)


@router.post("/scan/resolve")
def resolve_gate_scan(
    payload: GateResolveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_gate_operator(current_user)
    parsed = _parse_scan_payload(payload.raw_scan_text, payload.source_type)
    now = _local_now()
    booking = (
        db.query(Booking)
        .filter(Booking.id == parsed["booking_id"])
        .with_for_update()
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y booking")

    _assert_gate_permission(current_user, booking, db)
    payment = _get_payment(booking.id, db, lock=True)
    expired = _expire_no_show_booking_if_needed(booking, payment, now, db)
    detail = _serialize_booking_detail(booking, payment, db, now, parsed)
    _create_gate_log(
        booking=booking,
        user=db.query(User).filter(User.id == booking.user_id).first() if booking.user_id else None,
        gate_id=payload.gate_id,
        source_type=payload.source_type,
        action_type="resolve",
        result="expired" if expired else "success",
        note="Resolve táº¡i cá»•ng",
        db=db,
    )

    db.commit()
    latest_booking = detail
    return {
        "message": "Resolve thÃ nh cÃ´ng",
        "booking": latest_booking,
        "parsed_payload": parsed["payload"],
        "allowed_actions": latest_booking["allowed_actions"],
        "cooldown": latest_booking["cooldown"],
        "payment_preview": latest_booking["pricing_preview"],
        "auto_action": None,
        "auto_action_result": None,
    }


@router.post("/check-in")
def gate_check_in(
    payload: GateCheckInRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == payload.booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y booking")
    payment = _get_payment(booking.id, db, lock=True)
    detail = _execute_check_in(booking, payment, payload.gate_id, payload.source_type, current_user, db)
    db.commit()
    return {
        "message": "Check-in thÃ nh cÃ´ng",
        "booking": detail,
        "payment_preview": detail["pricing_preview"],
    }


@router.post("/check-out")
def gate_check_out(
    payload: GateCheckOutRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == payload.booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y booking")
    payment = _get_payment(booking.id, db, lock=True)
    now = _local_now()
    if _cooldown_info(booking, now)["active"]:
        raise HTTPException(status_code=409, detail=_cooldown_info(booking, now)["message"])
    detail = _execute_check_out(booking, payment, payload.gate_id, payload.source_type, payload.payment_method, current_user, db)
    db.commit()
    return {
        "message": "Check-out thÃ nh cÃ´ng",
        "booking": detail,
        "payment_preview": detail["pricing_preview"],
    }


@router.get("/bookings/{booking_id}")
def get_gate_booking(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_gate_operator(current_user)
    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y booking")
    _assert_gate_permission(current_user, booking, db)
    payment = _get_payment(booking.id, db, lock=True)
    now = _local_now()
    detail = _serialize_booking_detail(booking, payment, db, now)
    db.rollback()
    return detail
