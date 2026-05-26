from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import Booking, ParkingPrice, Payment
from app.routes.booking import calculate_checkout_fee
from app.services.owner_booking_config import (
    deposit_amount_for_booking,
    get_parking_booking_config,
    is_no_show_past_deadline,
)
from app.services.qr_service import invalidate_booking_qr_code
from app.utils.timezone import vn_now
import asyncio
from app.realtime import realtime_hub


def auto_checkout_expired_bookings(db: Session, now: datetime | None = None) -> int:
    """Auto tasks for bookings:
    - auto-cancel no-show bookings past owner-configured check-in deadline
    - auto-checkout bookings that are `checked_in` and past `expire_time`
    Returns number of processed bookings (cancelled + checked-out).
    """
    checkout_at = now or vn_now()

    # 1) Auto-cancel "no-show" bookings (status == "booked" and not checked-in)
    no_show_candidates = (
        db.query(Booking)
        .filter(
            Booking.status == "booked",
            Booking.start_time.isnot(None),
            Booking.expire_time.isnot(None),
            Booking.start_time <= checkout_at,
        )
        .with_for_update()
        .all()
    )

    processed = 0
    try:
        for booking in no_show_candidates:
            # Skip if already has actual_checkin (safety)
            if booking.actual_checkin is not None:
                continue

            config = get_parking_booking_config(db, booking.parking_id)
            if not is_no_show_past_deadline(booking, checkout_at, config):
                continue

            deposit_amount = deposit_amount_for_booking(booking, config)
            payment = db.query(Payment).filter(Payment.booking_id == booking.id).with_for_update().first()
            if deposit_amount > 0:
                if not payment:
                    payment = Payment(
                        booking_id=booking.id,
                        amount=deposit_amount,
                        overtime_fee=0,
                        payment_method="system",
                        payment_status="paid",
                        paid_at=checkout_at,
                        deposit_amount=deposit_amount,
                        remaining_amount=0,
                    )
                    db.add(payment)
                else:
                    payment.deposit_amount = round(min(deposit_amount, float(payment.amount or 0)), 2)
                    if float(payment.amount or 0) > payment.deposit_amount:
                        payment.amount = payment.deposit_amount
                    payment.remaining_amount = round(float(payment.amount or 0) - float(payment.deposit_amount or 0), 2)
                    payment.payment_status = "paid"
                    payment.paid_at = checkout_at

            booking.status = "cancelled"
            booking.cancel_reason = "no_show"
            booking.last_gate_action = "auto_no_show"
            booking.last_gate_action_at = checkout_at

            if booking.slot:
                booking.slot.status = "available"

            invalidate_booking_qr_code(booking, db)

            try:
                message = (
                    f"Booking của bạn mất cọc {deposit_amount} do quá thời gian check-in."
                    if deposit_amount > 0
                    else "Booking của bạn đã bị huỷ do quá thời gian check-in."
                )
                payload = {
                    "type": "booking_no_show",
                    "user_id": booking.user_id,
                    "booking_id": booking.id,
                    "message": message,
                    "ts": checkout_at.isoformat(),
                }
                asyncio.get_event_loop().create_task(realtime_hub.broadcast(payload))
            except Exception:
                pass

            processed += 1

        # 2) Existing auto-checkout for expired checked-in bookings
        expired_bookings = (
            db.query(Booking)
            .filter(
                Booking.status == "checked_in",
                Booking.expire_time.isnot(None),
                Booking.expire_time <= checkout_at,
            )
            .with_for_update()
            .all()
        )
        if expired_bookings:
            for booking in expired_bookings:
                # Keep behavior consistent with existing manual checkout flow.
                if booking.actual_checkin is None:
                    booking.actual_checkin = booking.start_time or checkout_at

                parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == booking.parking_id).first()
                try:
                    fee = calculate_checkout_fee(
                        booking,
                        checkout_at,
                        float(parking_price.price_per_hour if parking_price else 0),
                    )
                except HTTPException:
                    # Fallback to base amount if booking data is incomplete.
                    original_fee = float(booking.total_amount or 0)
                    fee = {
                        "overstay_minutes": 0,
                        "overstay_fee": 0,
                        "total_actual_fee": original_fee,
                    }

                payment = db.query(Payment).filter(Payment.booking_id == booking.id).first()
                if payment:
                    payment.overtime_fee = float(fee["overstay_fee"] or 0)

                booking.actual_checkout = checkout_at
                booking.overstay_minutes = int(fee["overstay_minutes"] or 0)
                booking.overstay_fee = float(fee["overstay_fee"] or 0)
                booking.total_actual_fee = float(fee["total_actual_fee"] or booking.total_amount or 0)
                booking.status = "completed"
                booking.last_gate_action = "auto_check_out"
                booking.last_gate_action_at = checkout_at

                if booking.slot:
                    booking.slot.status = "available"

                invalidate_booking_qr_code(booking, db)
                processed += 1

        db.commit()
        return processed
    except Exception:
        db.rollback()
        raise
