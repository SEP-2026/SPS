from datetime import datetime
from urllib.parse import quote_plus

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Booking, Payment, User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/payment", tags=["payment"])


class PaymentCreateRequest(BaseModel):
    booking_id: int = Field(gt=0)


class MockPaymentRequest(BaseModel):
    booking_id: int = Field(gt=0)
    status: str = Field(pattern="^(success|fail)$")


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
        payment.paid_at = datetime.utcnow()
        booking.status = "booked"
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


@router.post("/mock")
def mock_payment(payload: MockPaymentRequest, db: Session = Depends(get_db)):
    """Mock endpoint to simulate payment gateway callback (for testing).

    Accepts JSON { booking_id, status }
    """
    booking = db.query(Booking).filter(Booking.id == payload.booking_id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking không tồn tại")

    payment = db.query(Payment).filter(Payment.booking_id == payload.booking_id).with_for_update().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment không tồn tại")

    if payload.status == "success":
        payment.payment_status = "paid"
        payment.paid_at = datetime.utcnow()
        booking.status = "booked"
        message = "Thanh toán (mock) thành công"
    else:
        payment.payment_status = "failed"
        booking.status = "cancelled"
        if booking.slot:
            booking.slot.status = "available"
        message = "Thanh toán (mock) thất bại"

    db.commit()

    return {
        "message": message,
        "booking_id": booking.id,
        "booking_status": booking.status,
        "payment_status": payment.payment_status,
        "paid_at": payment.paid_at,
    }
