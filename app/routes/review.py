from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Booking, OwnerParking, ParkingLot, Review, User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewCreateRequest(BaseModel):
    booking_id: int = Field(gt=0)
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)


class OwnerReplyRequest(BaseModel):
    reply: str = Field(min_length=1, max_length=300)


def update_parking_avg_rating(db: Session, parking_id: int) -> None:
    result = (
        db.query(func.avg(Review.rating), func.count(Review.id))
        .filter(Review.parking_id == parking_id)
        .first()
    )
    avg = round(float(result[0]), 1) if result and result[0] is not None else 0.0
    count = int(result[1]) if result and result[1] is not None else 0

    parking = db.query(ParkingLot).filter(ParkingLot.id == parking_id).first()
    if parking:
        parking.avg_rating = avg
        parking.review_count = count


@router.post("", status_code=status.HTTP_201_CREATED)
def create_review(
    payload: ReviewCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == payload.booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")
    if booking.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền đánh giá booking này")

    booking_status = (booking.status or "").lower()
    if booking_status not in {"checked_out", "completed"}:
        raise HTTPException(status_code=400, detail="Chỉ đánh giá được sau khi hoàn tất giao dịch")
    if int(booking.is_reviewed or 0) == 1:
        raise HTTPException(status_code=400, detail="Booking này đã được đánh giá rồi")

    existing_review = db.query(Review).filter(Review.booking_id == booking.id).first()
    if existing_review:
        booking.is_reviewed = 1
        db.commit()
        raise HTTPException(status_code=400, detail="Booking này đã được đánh giá rồi")

    review = Review(
        booking_id=booking.id,
        user_id=current_user.id,
        parking_id=booking.parking_id,
        rating=payload.rating,
        comment=(payload.comment or "").strip() or None,
    )
    db.add(review)
    booking.is_reviewed = 1
    try:
        db.flush()
        update_parking_avg_rating(db, booking.parking_id)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        message = str(getattr(exc, "orig", exc))
        if "unique_user_parking_review" in message:
            raise HTTPException(
                status_code=409,
                detail="Database vẫn còn ràng buộc cũ chỉ cho đánh giá một lần mỗi bãi. Vui lòng khởi động lại backend để chạy migration mới.",
            ) from exc
        raise
    db.refresh(review)

    return {
        "success": True,
        "review_id": review.id,
        "booking_id": review.booking_id,
        "parking_id": review.parking_id,
        "rating": review.rating,
        "comment": review.comment,
        "created_at": review.created_at.isoformat() if review.created_at else None,
    }


@router.get("/booking/{booking_id}")
def get_review_by_booking(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm thấy booking")
    if booking.user_id != current_user.id and current_user.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem đánh giá này")

    review = db.query(Review).filter(Review.booking_id == booking_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Booking chưa có đánh giá")
    return {
        "review_id": review.id,
        "booking_id": review.booking_id,
        "rating": review.rating,
        "comment": review.comment,
        "owner_reply": review.owner_reply,
        "owner_replied_at": review.owner_replied_at.isoformat() if review.owner_replied_at else None,
        "created_at": review.created_at.isoformat() if review.created_at else None,
    }


@router.get("/parking/{parking_id}")
def get_reviews_by_parking(
    parking_id: int,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
    sort: str = Query(default="newest"),
    db: Session = Depends(get_db),
):
    parking = db.query(ParkingLot).filter(ParkingLot.id == parking_id).first()
    if not parking:
        raise HTTPException(status_code=404, detail="Không tìm thấy bãi đỗ")

    base_query = db.query(Review, User).join(User, User.id == Review.user_id).filter(Review.parking_id == parking_id)

    if sort == "highest":
        ordered_query = base_query.order_by(Review.rating.desc(), Review.created_at.desc())
    elif sort == "lowest":
        ordered_query = base_query.order_by(Review.rating.asc(), Review.created_at.desc())
    else:
        ordered_query = base_query.order_by(Review.created_at.desc())

    total_reviews = db.query(func.count(Review.id)).filter(Review.parking_id == parking_id).scalar() or 0
    total_pages = max(1, (total_reviews + limit - 1) // limit) if total_reviews else 1
    rows = ordered_query.offset((page - 1) * limit).limit(limit).all()

    distribution_rows = (
        db.query(Review.rating, func.count(Review.id))
        .filter(Review.parking_id == parking_id)
        .group_by(Review.rating)
        .all()
    )
    distribution = {str(i): 0 for i in range(1, 6)}
    for rating, count in distribution_rows:
        distribution[str(int(rating))] = int(count)

    return {
        "parking_id": parking.id,
        "parking_name": parking.name,
        "avg_rating": float(parking.avg_rating or 0),
        "total_reviews": int(total_reviews),
        "rating_distribution": distribution,
        "reviews": [
            {
                "review_id": review.id,
                "booking_id": review.booking_id,
                "user_name": user.name,
                "rating": review.rating,
                "comment": review.comment,
                "owner_reply": review.owner_reply,
                "owner_replied_at": review.owner_replied_at.isoformat() if review.owner_replied_at else None,
                "created_at": review.created_at.isoformat() if review.created_at else None,
            }
            for review, user in rows
        ],
        "page": page,
        "total_pages": total_pages,
    }


@router.post("/{review_id}/reply")
def reply_review(
    review_id: int,
    payload: OwnerReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Không tìm thấy đánh giá")

    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Chỉ owner mới được phản hồi đánh giá")

    assignment = (
        db.query(OwnerParking)
        .filter(OwnerParking.owner_id == current_user.id, OwnerParking.parking_id == review.parking_id)
        .first()
    )
    if assignment is None:
        raise HTTPException(status_code=403, detail="Bạn không có quyền phản hồi đánh giá của bãi này")

    if review.owner_reply:
        raise HTTPException(status_code=400, detail="Đã phản hồi đánh giá này rồi")

    review.owner_reply = payload.reply.strip()
    review.owner_replied_at = datetime.utcnow()
    db.commit()
    db.refresh(review)

    return {
        "success": True,
        "review_id": review.id,
        "owner_reply": review.owner_reply,
        "owner_replied_at": review.owner_replied_at.isoformat() if review.owner_replied_at else None,
    }
