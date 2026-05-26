from datetime import datetime
from urllib.parse import quote_plus

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Booking, Payment, User
from app.routes.auth import get_current_user
from app.services.wallet_service import WalletError, get_wallet_summary, reserve_wallet_amount
from app.services.qr_service import generate_booking_qr_code
from app.utils.timezone import vn_now

router = APIRouter(prefix="/payment", tags=["payment"])


class PaymentCreateRequest(BaseModel):
    booking_id: int = Field(gt=0)


class PaymentMockSuccessRequest(BaseModel):
    booking_id: int = Field(gt=0)


def _calculate_no_show_deposit(booking: Booking, db: Session) -> float:
    if booking.status == "cancelled" and (booking.cancel_reason or "") == "no_show":
        from app.services.owner_booking_config import deposit_amount_for_booking, get_parking_booking_config

        config = get_parking_booking_config(db, booking.parking_id)
        return deposit_amount_for_booking(booking, config)
    return 0.0


def _get_effective_paid_amount(booking: Booking, payment: Payment | None, db: Session) -> float:
    if booking.status == "cancelled" and (booking.cancel_reason or "") == "no_show":
        deposit_amount = float((payment.deposit_amount if payment else 0) or 0)
        if deposit_amount > 0:
            return round(deposit_amount, 2)
        return _calculate_no_show_deposit(booking, db)

    if not payment:
        return 0.0

    return round(float(payment.amount or 0) + float(payment.overtime_fee or 0), 2)


def _ensure_qr_directory() -> None:
    import os

    os.makedirs("qrcodes", exist_ok=True)


def _save_payment_qr(content: str, file_path: str) -> None:
    _ensure_qr_directory()
    image = qrcode.make(content)
    image.save(file_path)


def _generate_vnpay_url(booking_id: int, amount: float) -> str:
    return (
        "https://sandbox.vnpayment.vn/payment"
        f"?booking_id={booking_id}&amount={quote_plus(str(int(round(amount))))}"
    )


@router.post("/create")
def create_payment(
    payload: PaymentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == payload.booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thanh toán booking này")

    if booking.status not in ["pending", "booked"]:
        raise HTTPException(status_code=400, detail="Booking không ở trạng thái chờ thanh toán")

    amount = float(booking.total_amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Không thể tạo payment cho booking chưa có giá")

    payment = db.query(Payment).filter(Payment.booking_id == booking.id).first()
    if not payment:
        payment = Payment(
            booking_id=booking.id,
            amount=amount,
            overtime_fee=0,
            payment_method="vnpay",
            payment_status="pending",
        )
        db.add(payment)
        db.flush()
    elif payment.payment_status == "paid":
        return {
            "message": "Payment already paid",
            "booking_id": booking.id,
            "payment_status": payment.payment_status,
            "amount": payment.amount,
            "overtime_fee": payment.overtime_fee,
            "paid_at": payment.paid_at,
            "qr_url": payment.vnpay_url,
            "qr_code": payment.qr_code,
        }

    payment.amount = amount
    payment.payment_status = "pending"

    vnpay_url = _generate_vnpay_url(booking.id, amount)
    qr_path = f"qrcodes/payment_{booking.id}.png"
    _save_payment_qr(vnpay_url, qr_path)

    payment.vnpay_url = vnpay_url
    payment.qr_code = qr_path

    db.commit()
    db.refresh(payment)

    return {
        "message": "Payment created",
        "booking_id": booking.id,
        "payment_status": payment.payment_status,
        "amount": payment.amount,
        "overtime_fee": payment.overtime_fee,
        "paid_at": payment.paid_at,
        "qr_url": payment.vnpay_url,
        "qr_code": payment.qr_code,
    }


@router.post("/callback")
def payment_callback(
    booking_id: int = Query(gt=0),
    status: str = Query(pattern="^(success|fail)$"),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking không tồn tại")

    payment = db.query(Payment).filter(Payment.booking_id == booking_id).with_for_update().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment không tồn tại")

    if status == "success":
        payment.payment_status = "paid"
        payment.paid_at = vn_now()
        booking.status = "booked"
        
        # Generate QR code when payment succeeds
        try:
            qr_result = generate_booking_qr_code(booking_id, db)
            if not qr_result.get("success"):
                # Log the error but don't fail the payment
                print(f"Warning: QR generation failed for booking {booking_id}: {qr_result.get('error')}")
        except Exception as e:
            # Log the error but don't fail the payment
            print(f"Warning: Exception during QR generation for booking {booking_id}: {str(e)}")
        
        message = "Thanh toán thành công"
    else:
        payment.payment_status = "failed"
        booking.status = "cancelled"
        if booking.slot:
            booking.slot.status = "available"
        message = "Thanh toán thất bại"

    db.commit()

    return {
        "message": message,
        "booking_id": booking.id,
        "booking_status": booking.status,
        "payment_status": payment.payment_status,
        "paid_at": payment.paid_at,
    }


@router.post("/mock-success")
def mock_payment_success(
    payload: PaymentMockSuccessRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        booking = db.query(Booking).filter(Booking.id == payload.booking_id).with_for_update().first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking không tồn tại")

        if booking.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Bạn không có quyền thanh toán booking này")

        if booking.status not in {"pending", "booked"}:
            raise HTTPException(status_code=400, detail="Booking không ở trạng thái có thể thanh toán")

        from app.services.owner_booking_config import deposit_ratio, get_parking_booking_config

        total_amount = round(float(booking.total_amount or 0), 2)
        config = get_parking_booking_config(db, booking.parking_id)
        ratio = deposit_ratio(config, booking.booking_mode)
        upfront_amount = round(total_amount * ratio, 2)
        remaining_amount = round(max(0.0, total_amount - upfront_amount), 2)

        payment = db.query(Payment).filter(Payment.booking_id == booking.id).with_for_update().first()
        if not payment:
            payment = Payment(
                booking_id=booking.id,
                amount=total_amount,
                overtime_fee=0,
                payment_method="wallet",
                payment_status="pending",
                deposit_amount=upfront_amount,
                remaining_amount=remaining_amount,
            )
            db.add(payment)
            db.flush()
        elif payment.payment_status == "paid":
            return {
                "message": "Booking đã được thanh toán trước đó",
                "booking_id": booking.id,
                "booking_status": booking.status,
                "payment_status": payment.payment_status,
                "paid_at": payment.paid_at,
                "wallet": get_wallet_summary(db, current_user.id),
            }

        reserve_wallet_amount(
            db,
            current_user.id,
            amount=upfront_amount,
            reference_type="booking_payment",
            reference_id=booking.id,
            note="Giữ tiền cọc khi mô phỏng thanh toán bằng ví nội bộ",
        )

        payment.amount = total_amount
        payment.deposit_amount = upfront_amount
        payment.remaining_amount = remaining_amount
        payment.payment_method = "wallet"
        payment.payment_status = "paid"
        payment.paid_at = vn_now()

        booking.status = "booked"

        db.commit()

        return {
            "message": "Đã mô phỏng thanh toán thành công",
            "booking_id": booking.id,
            "booking_status": booking.status,
            "payment_status": payment.payment_status,
            "paid_at": payment.paid_at,
            "wallet": get_wallet_summary(db, current_user.id),
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Mô phỏng thanh toán thất bại: {exc}") from exc


@router.get("/history")
def payment_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bookings = (
        db.query(Booking)
        .filter(Booking.user_id == current_user.id)
        .order_by(Booking.created_at.desc(), Booking.id.desc())
        .all()
    )

    payment_map = {}
    if bookings:
        booking_ids = [booking.id for booking in bookings]
        payments = db.query(Payment).filter(Payment.booking_id.in_(booking_ids)).all()
        payment_map = {payment.booking_id: payment for payment in payments}

    result = []
    for booking in bookings:
        payment = payment_map.get(booking.id)
        paid_amount = _get_effective_paid_amount(booking, payment, db)
        deposit_amount = _calculate_no_show_deposit(booking, db)
        result.append(
            {
                "booking_id": booking.id,
                "booking_status": booking.status,
                "cancel_reason": booking.cancel_reason,
                "booking_amount": float(booking.total_amount or 0),
                "paid_amount": round(paid_amount, 2),
                "deposit_amount": deposit_amount,
                "payment_status": payment.payment_status if payment else None,
                "paid_at": payment.paid_at if payment else None,
                "booking_created_at": booking.created_at,
                "checkin_time": booking.start_time,
                "checkout_time": booking.expire_time,
            }
        )

    return result
