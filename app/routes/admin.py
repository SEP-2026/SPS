from collections import defaultdict
from datetime import datetime, timedelta
import secrets
import string
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from werkzeug.security import generate_password_hash

from app.database import get_db
from app.models.models import (
    AdminSecurityEvent,
    Booking,
    EmployeeActivity,
    OwnerParking,
    ParkingLot,
    ParkingPrice,
    ParkingSlot,
    Payment,
    RevokedToken,
    User,
)
from app.utils.timezone import isoformat_vn, vn_now
from app.routes.auth import get_current_user
from app.security.password_policy import ensure_strong_password
from app.services.revenue_settings import ADMIN_RUNTIME_SETTINGS, get_commission_rate_percent, split_revenue
import unicodedata

router = APIRouter(prefix="/admin", tags=["admin"])

PARKING_LOGIN_PREFIXES = (
    "smart parking",
    "bai dau xe",
    "bai giu xe",
    "bai do",
    "bai xe",
    "parking lot",
    "parking",
)


def _generate_strong_password(length: int = 12) -> str:
    if length < 8:
        length = 8

    lower = secrets.choice(string.ascii_lowercase)
    upper = secrets.choice(string.ascii_uppercase)
    digit = secrets.choice(string.digits)
    special = secrets.choice("@#$%!&*?-_")
    remaining_len = max(length - 4, 0)
    alphabet = string.ascii_letters + string.digits + "@#$%!&*?-_"
    remaining = "".join(secrets.choice(alphabet) for _ in range(remaining_len))

    chars = list(lower + upper + digit + special + remaining)
    secrets.SystemRandom().shuffle(chars)
    password = "".join(chars)
    ensure_strong_password(password)
    return password


class UserStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(active|banned)$")


class OwnerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    parking_lot: str | None = Field(default=None, max_length=255, alias="parkingLot")
    status: str = Field(default="active", pattern="^(active|suspended)$")
    temporary_password: str | None = Field(default=None, min_length=6, max_length=255)

    class Config:
        allow_population_by_field_name = True


class OwnerStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(active|suspended)$")


class OwnerUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    status: str | None = Field(default=None, pattern="^(active|suspended)$")
    parking_lot: str | None = Field(default=None, max_length=255, alias="parkingLot")

    class Config:
        allow_population_by_field_name = True


class ParkingLotCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    owner: str | None = Field(default=None, max_length=255)
    slot_count: int = Field(default=0, ge=0)
    status: str = Field(default="pending", pattern="^(pending|active|locked)$")


class ParkingLotUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    owner: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, pattern="^(pending|active|locked)$")


class BookingStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(cancelled|confirmed|completed|checked_in|in_progress|booked|pending)$")


class AdminSettingsUpdateRequest(BaseModel):
    commissionRate: str
    supportEmail: str
    maintenanceWindow: str
    alertThreshold: str


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chá»‰ admin má»›i Ä‘Æ°á»£c truy cáº­p")
    return current_user


def _to_status_label(user: User) -> str:
    if user.status and user.status.lower() == "banned":
        return "banned"
    return "active" if user.is_active == 1 else "banned"


def _lot_status(lot: ParkingLot) -> str:
    return "active" if lot.is_active == 1 else "locked"


def _owner_parking_maps(db: Session) -> tuple[dict[int, ParkingLot], dict[int, User]]:
    # Use a join query to reliably collect parking lot names per owner.
    rows = (
        db.query(OwnerParking.owner_id, ParkingLot.id.label("parking_id"), ParkingLot.name)
        .join(ParkingLot, ParkingLot.id == OwnerParking.parking_id)
        .order_by(OwnerParking.id.asc())
        .all()
    )

    # owner -> list of parking lot dicts {id, name}
    lot_by_owner: dict[int, list[dict]] = {}
    owner_by_lot: dict[int, User] = {}
    owner_ids = set()
    for row in rows:
        owner_id = int(row.owner_id)
        owner_ids.add(owner_id)
        items = lot_by_owner.get(owner_id)
        if items:
            items.append({"id": int(row.parking_id), "name": row.name})
        else:
            lot_by_owner[owner_id] = [{"id": int(row.parking_id), "name": row.name}]
        owner_by_lot[int(row.parking_id)] = None  # placeholder, will be filled below

    # populate owner_by_lot mapping with User objects for the first owner per lot
    if owner_ids:
        owners = {int(u.id): u for u in db.query(User).filter(User.id.in_(list(owner_ids))).all()}
        for row in rows:
            pid = int(row.parking_id)
            oid = int(row.owner_id)
            if pid not in owner_by_lot or owner_by_lot[pid] is None:
                owner_by_lot[pid] = owners.get(oid)

    return lot_by_owner, owner_by_lot


def _find_parking_lot_by_reference(db: Session, reference: str | None) -> ParkingLot | None:
    if not reference:
        return None
    normalized = reference.strip()
    if not normalized:
        return None
    if normalized.isdigit():
        lot = db.query(ParkingLot).filter(ParkingLot.id == int(normalized)).first()
        if lot:
            return lot
    # try exact name match first
    lot = db.query(ParkingLot).filter(ParkingLot.name == normalized).first()
    if lot:
        return lot

    # case-insensitive contains
    lot = db.query(ParkingLot).filter(ParkingLot.name.ilike(f"%{normalized}%")).first()
    if lot:
        return lot

    # normalize accents and try contains match
    def _normalize_text(s: str) -> str:
        return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").casefold()

    try:
        target = _normalize_text(normalized)
        for lot in db.query(ParkingLot).all():
            if lot.name and target in _normalize_text(lot.name):
                return lot
    except Exception:
        pass

    return None


def _find_owner_by_reference(db: Session, reference: str | None) -> User | None:
    if not reference:
        return None
    normalized = reference.strip()
    if not normalized:
        return None
    if normalized.isdigit():
        owner = db.query(User).filter(User.id == int(normalized), User.role == "owner").first()
        if owner:
            return owner
    owner = db.query(User).filter(User.email == normalized.lower(), User.role == "owner").first()
    if owner:
        return owner
    return db.query(User).filter(User.name == normalized, User.role == "owner").first()


def _parking_login_token(parking_name: str) -> str:
    normalized = unicodedata.normalize("NFKD", parking_name or "").encode("ascii", "ignore").decode("ascii").lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()

    for _ in range(4):
        next_value = normalized
        for prefix in PARKING_LOGIN_PREFIXES:
            if next_value == prefix:
                next_value = ""
                break
            if next_value.startswith(f"{prefix} "):
                next_value = next_value[len(prefix):].strip()
                break
        if next_value == normalized:
            break
        normalized = next_value

    token = re.sub(r"[^a-z0-9]+", "", normalized)
    return token or "parking"


def _assign_owner_parking(db: Session, owner_id: int, parking_id: int) -> None:
    existing_owner = db.query(OwnerParking).filter(OwnerParking.owner_id == owner_id).first()
    if existing_owner and int(existing_owner.parking_id) != int(parking_id):
        raise HTTPException(status_code=409, detail="Owner Ä‘Ã£ Ä‘Æ°á»£c gÃ¡n cho bÃ£i khÃ¡c")

    existing_lot = db.query(OwnerParking).filter(OwnerParking.parking_id == parking_id).first()
    if existing_lot and int(existing_lot.owner_id) != int(owner_id):
        raise HTTPException(status_code=409, detail="BÃ£i nÃ y Ä‘Ã£ cÃ³ owner khÃ¡c quáº£n lÃ½")

    if not existing_owner and not existing_lot:
        db.add(OwnerParking(owner_id=owner_id, parking_id=parking_id))


def _remove_owner_assignments(db: Session, owner_id: int) -> None:
    db.query(OwnerParking).filter(OwnerParking.owner_id == owner_id).delete()


def _format_day_label(value: datetime) -> str:
    return value.strftime("%d/%m")


def _format_month_label(value: datetime) -> str:
    return f"T{value.month}"


def _slot_counts_by_lot(slots: list[ParkingSlot]) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = defaultdict(lambda: {"total": 0, "occupied": 0})
    for slot in slots:
        lot_id = int(slot.parking_id or 0)
        counts[lot_id]["total"] += 1
        if slot.status in {"reserved", "occupied"}:
            counts[lot_id]["occupied"] += 1
    return counts


def _build_revenue_series(
    payments: list[Payment],
    bookings: list[Booking] | None = None,
    days: int = 7,
) -> tuple[list[dict], list[dict]]:
    today = datetime.utcnow().date()
    revenue = []
    commission = []
    commission_rate = float(ADMIN_RUNTIME_SETTINGS["commissionRate"]) / 100

    for offset in range(days - 1, -1, -1):
        current_day = today - timedelta(days=offset)
        day_payments = [
            payment for payment in payments
            if (payment.paid_at or payment.created_at) and (payment.paid_at or payment.created_at).date() == current_day
            and payment.payment_status == "paid"
        ]
        gross = round(sum(float(payment.amount or 0) + float(payment.overtime_fee or 0) for payment in day_payments), 2)
        if gross <= 0 and not payments and bookings:
            # Fallback for systems that do not persist records in `payments` yet.
            gross = round(
                sum(
                    float(booking.total_amount or 0)
                    for booking in bookings
                    if booking.created_at
                    and booking.created_at.date() == current_day
                    and booking.status in {"booked", "checked_in", "in_progress", "completed"}
                ),
                2,
            )
        revenue.append({"label": _format_day_label(datetime.combine(current_day, datetime.min.time())), "amount": gross})
        commission.append({"label": _format_day_label(datetime.combine(current_day, datetime.min.time())), "amount": round(gross * commission_rate, 2)})

    return revenue, commission


def _build_booking_series(bookings: list[Booking], days: int = 7) -> list[dict]:
    today = datetime.utcnow().date()
    result = []
    for offset in range(days - 1, -1, -1):
        current_day = today - timedelta(days=offset)
        count = sum(1 for booking in bookings if booking.created_at and booking.created_at.date() == current_day)
        result.append({"label": _format_day_label(datetime.combine(current_day, datetime.min.time())), "amount": count})
    return result


def _build_user_growth_series(bookings: list[Booking], months: int = 4) -> list[dict]:
    buckets: dict[tuple[int, int], set[int]] = defaultdict(set)
    for booking in bookings:
        if booking.created_at and booking.user_id:
            buckets[(booking.created_at.year, booking.created_at.month)].add(int(booking.user_id))

    series = []
    now = datetime.utcnow()
    target_months: list[tuple[int, int]] = []
    year = now.year
    month = now.month
    for _ in range(max(months, 1)):
        target_months.append((year, month))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    target_months.reverse()

    for year, month in target_months:
        series.append({
            "label": _format_month_label(datetime(year, month, 1)),
            "amount": len(buckets.get((year, month), set())),
        })
    return series


def _build_monthly_revenue_series(
    payments: list[Payment],
    bookings: list[Booking] | None = None,
    months: int = 6,
) -> tuple[list[dict], list[dict], list[dict]]:
    now = datetime.utcnow()
    commission_rate = float(ADMIN_RUNTIME_SETTINGS["commissionRate"]) / 100
    target_months: list[tuple[int, int]] = []
    year = now.year
    month = now.month
    for _ in range(max(months, 1)):
        target_months.append((year, month))
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    target_months.reverse()

    revenue: list[dict] = []
    commission: list[dict] = []
    bookings_series: list[dict] = []
    for year, month in target_months:
        label = f"{month:02d}/{str(year)[-2:]}"
        gross = 0.0
        booking_count = 0
        if payments:
            month_payments = [
                payment for payment in payments
                if (payment.paid_at or payment.created_at)
                and (payment.paid_at or payment.created_at).year == year
                and (payment.paid_at or payment.created_at).month == month
                and payment.payment_status == "paid"
            ]
            gross = round(sum(float(payment.amount or 0) + float(payment.overtime_fee or 0) for payment in month_payments), 2)

        if bookings:
            month_bookings = [
                booking for booking in bookings
                if booking.created_at and booking.created_at.year == year and booking.created_at.month == month
            ]
            booking_count = len(month_bookings)
            if gross <= 0 and not payments:
                gross = round(
                    sum(
                        float(booking.total_amount or 0)
                        for booking in month_bookings
                        if booking.status in {"booked", "checked_in", "in_progress", "completed"}
                    ),
                    2,
                )

        revenue.append({"label": label, "amount": gross})
        commission.append({"label": label, "amount": round(gross * commission_rate, 2)})
        bookings_series.append({"label": label, "amount": booking_count})

    return revenue, commission, bookings_series


def _evaluate_user_spam(db: Session, users: list[User], bookings: list[Booking]) -> tuple[dict[int, dict], list[dict]]:
    now = vn_now()
    user_meta: dict[int, dict] = {}
    auto_lock_events: list[dict] = []

    bookings_by_user: dict[int, list[Booking]] = defaultdict(list)
    for booking in bookings:
        if booking.user_id:
            bookings_by_user[int(booking.user_id)].append(booking)

    for user in users:
        if user.role != "user":
            continue
        user_bookings = bookings_by_user.get(int(user.id), [])
        recent_14d = [
            booking for booking in user_bookings
            if booking.created_at and booking.created_at >= now - timedelta(days=14)
        ]
        total_recent = len(recent_14d)
        cancelled_recent = sum(1 for booking in recent_14d if booking.status == "cancelled")
        invalid_recent = sum(
            1 for booking in recent_14d
            if booking.total_amount is None or float(booking.total_amount or 0) <= 0
        )
        cancel_ratio = (cancelled_recent / total_recent) if total_recent > 0 else 0.0
        score = int(round((cancel_ratio * 70) + min(invalid_recent * 10, 30)))
        is_spam = total_recent >= 4 and (cancel_ratio >= 0.65 or invalid_recent >= 3)

        user_meta[int(user.id)] = {
            "score": score,
            "status": "spam" if is_spam else ("risk" if score >= 45 else "normal"),
            "cancelRatio": round(cancel_ratio, 2),
            "cancelledRecent": cancelled_recent,
            "totalRecent": total_recent,
            "invalidRecent": invalid_recent,
        }

        if is_spam and user.is_active == 1 and (not user.status or user.status.lower() != "banned"):
            user.status = "banned"
            user.is_active = 0
            event_key = f"spam-lock-{user.id}-{int(now.timestamp())}"
            auto_lock_events.append(
                _record_security_event(
                    db,
                    event_key=event_key,
                    actor="Hệ thống",
                    action=f"Tài khoản {user.email} đang bị khóa (tự động do hành vi spam)",
                    target=user.email,
                    target_type="user",
                    level="security",
                    created_at=now,
                )
            )

    return user_meta, auto_lock_events


def _record_security_event(
    db: Session,
    *,
    event_key: str,
    action: str,
    target: str,
    target_type: str = "user",
    actor: str = "system",
    level: str = "security",
    created_at: datetime | None = None,
) -> dict:
    timestamp = created_at or vn_now()
    existing = db.query(AdminSecurityEvent).filter(AdminSecurityEvent.event_key == event_key).first()
    if existing:
        return {
            "id": f"security-{existing.id}",
            "actor": existing.actor,
            "action": existing.action,
            "target": existing.target,
            "targetType": existing.target_type,
            "time": isoformat_vn(existing.created_at, fallback_now=True),
            "type": existing.level,
        }

    row = AdminSecurityEvent(
        event_key=event_key,
        actor=actor,
        action=action,
        target=target,
        target_type=target_type,
        level=level,
        created_at=timestamp,
    )
    db.add(row)
    db.flush()
    return {
        "id": f"security-{row.id}",
        "actor": actor,
        "action": action,
        "target": target,
        "targetType": target_type,
        "time": isoformat_vn(timestamp, fallback_now=True),
        "type": level,
    }


def _fetch_security_events(db: Session, limit: int = 30) -> list[dict]:
    rows = (
        db.query(AdminSecurityEvent)
        .order_by(AdminSecurityEvent.created_at.desc(), AdminSecurityEvent.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": f"security-{row.id}",
            "actor": row.actor,
            "action": row.action,
            "target": row.target,
            "targetType": row.target_type,
            "time": isoformat_vn(row.created_at, fallback_now=True),
            "type": row.level,
        }
        for row in rows
    ]


def _build_activity_logs(
    db: Session,
    bookings: list[Booking],
    parking_lots: list[ParkingLot],
) -> list[dict]:
    logs = []
    for booking in sorted(bookings, key=lambda item: item.created_at or datetime.min, reverse=True)[:6]:
        actor = booking.user.name if booking.user else "Hệ thống"
        parking_name = booking.parking_lot.name if booking.parking_lot else "Không rõ bãi"
        booking_code = f"BK-{booking.id}"
        action_label = f"Tạo booking {booking_code} tại {parking_name}"
        logs.append({
            "id": f"booking-{booking.id}",
            "actor": actor,
            "action": action_label,
            "target": booking_code,
            "targetType": "booking",
            "time": isoformat_vn(booking.created_at, fallback_now=True),
            "type": "booking",
        })

    for lot in parking_lots:
        if _lot_status(lot) == "locked":
            logs.append({
                "id": f"lot-{lot.id}",
                "actor": "Hệ thống",
                "action": f"Bãi {lot.name} đang bị khóa vận hành",
                "target": lot.name,
                "targetType": "parking_lot",
                "time": isoformat_vn(fallback_now=True),
                "type": "warning",
            })

    logs.extend(_fetch_security_events(db))
    logs.sort(key=lambda item: item.get("time") or "", reverse=True)
    return logs[:20]


def _build_login_history(db: Session) -> list[dict]:
    revoked = db.query(RevokedToken).order_by(RevokedToken.expires_at.desc()).limit(5).all()
    return [
        {
            "id": f"token-{token.id}",
            "email": "admin-session",
            "ip": "Không lưu trong CSDL",
            "device": "Không lưu trong CSDL",
            "time": token.expires_at.isoformat(),
            "status": "blocked",
        }
        for token in revoked
    ]


def _build_daily_revenue_series(payments_list: list, start_date=None, end_date=None, days: int = 7) -> list:
    """Build daily revenue and commission series for a given date range."""
    from datetime import datetime as dt_parser
    
    now = datetime.utcnow()
    today = now.date()
    commission_rate = float(ADMIN_RUNTIME_SETTINGS["commissionRate"]) / 100
    
    # Determine date range
    if start_date and end_date:
        # If dates are strings, parse them
        if isinstance(start_date, str):
            start_date = dt_parser.strptime(start_date, "%Y-%m-%d").date()
        if isinstance(end_date, str):
            end_date = dt_parser.strptime(end_date, "%Y-%m-%d").date()
        range_start = start_date
        range_end = end_date
    else:
        # Use days parameter as fallback
        range_start = today - timedelta(days=days - 1)
        range_end = today
    
    # Initialize dictionary for each day in range
    daily_data = {}
    current_date = range_start
    while current_date <= range_end:
        daily_data[current_date] = {"revenue": 0.0, "commission": 0.0}
        current_date += timedelta(days=1)
    
    # Aggregate payments by date
    paid_payments = [p for p in payments_list if p.payment_status == "paid"] if payments_list else []
    
    for payment in paid_payments:
        payment_date = (payment.paid_at or payment.created_at)
        if payment_date:
            payment_date = payment_date.date()
            if payment_date in daily_data:
                amount = float(payment.amount or 0) + float(payment.overtime_fee or 0)
                daily_data[payment_date]["revenue"] += amount
                daily_data[payment_date]["commission"] += amount * commission_rate
    
    # Format as list with day labels
    result = []
    for date in sorted(daily_data.keys()):
        day_str = date.strftime("%d/%m")
        result.append({
            "date": day_str,
            "label": day_str,
            "revenue": round(daily_data[date]["revenue"], 2),
            "commission": round(daily_data[date]["commission"], 2),
        })
    
    return result


def _build_dashboard_stats(db: Session, date_range: str = "7days", date_from: str = None, date_to: str = None) -> dict:
    """Build dashboard statistics from real database data with date range support."""
    from datetime import datetime as dt_parser
    
    users = db.query(User).all()
    parking_lots = db.query(ParkingLot).all()
    bookings = db.query(Booking).all()
    slots = db.query(ParkingSlot).all()
    payments = db.query(Payment).all()
    
    now = datetime.utcnow()
    today = now.date()
    
    # Determine date range based on parameter
    if date_range == "custom" and date_from and date_to:
        try:
            range_start = dt_parser.strptime(date_from, "%Y-%m-%d").date()
            range_end = dt_parser.strptime(date_to, "%Y-%m-%d").date()
        except:
            range_start = today - timedelta(days=6)
            range_end = today
    elif date_range == "30days":
        range_start = today - timedelta(days=29)
        range_end = today
    elif date_range == "90days":
        range_start = today - timedelta(days=89)
        range_end = today
    else:  # Default to 7days
        range_start = today - timedelta(days=6)
        range_end = today
    
    # For comparison, use previous period of same length
    period_length = (range_end - range_start).days + 1
    previous_range_end = range_start - timedelta(days=1)
    previous_range_start = previous_range_end - timedelta(days=period_length - 1)
    
    def get_revenue_for_period(payments_list, start_date, end_date):
        """Calculate revenue for a given date range."""
        period_payments = [
            p for p in payments_list 
            if p.payment_status == "paid" 
            and (p.paid_at or p.created_at)
            and (p.paid_at or p.created_at).date() >= start_date
            and (p.paid_at or p.created_at).date() <= end_date
        ]
        return sum(float(p.amount or 0) + float(p.overtime_fee or 0) for p in period_payments)
    
    def get_commission_for_period(payments_list, start_date, end_date):
        """Calculate commission for a given date range."""
        commission_rate = float(ADMIN_RUNTIME_SETTINGS["commissionRate"]) / 100
        period_payments = [
            p for p in payments_list 
            if p.payment_status == "paid" 
            and (p.paid_at or p.created_at)
            and (p.paid_at or p.created_at).date() >= start_date
            and (p.paid_at or p.created_at).date() <= end_date
        ]
        gross = sum(float(p.amount or 0) + float(p.overtime_fee or 0) for p in period_payments)
        return gross * commission_rate
    
    def get_bookings_count_for_period(bookings_list, start_date, end_date):
        """Count bookings for a given date range."""
        return sum(
            1 for b in bookings_list 
            if b.created_at 
            and b.created_at.date() >= start_date 
            and b.created_at.date() <= end_date
        )
    
    # Calculate revenue and commission for current and previous periods
    paid_transactions = [p for p in payments if p.payment_status == "paid"] if payments else []
    
    if paid_transactions:
        current_period_gross = get_revenue_for_period(paid_transactions, range_start, range_end)
        previous_period_gross = get_revenue_for_period(paid_transactions, previous_range_start, previous_range_end)
        
        current_period_commission = get_commission_for_period(paid_transactions, range_start, range_end)
        previous_period_commission = get_commission_for_period(paid_transactions, previous_range_start, previous_range_end)
    else:
        # Fallback to bookings if no payments
        paid_bookings = [b for b in bookings if b.status in {"booked", "checked_in", "in_progress", "completed"}]
        
        current_period_bookings = [b for b in paid_bookings if b.created_at and b.created_at.date() >= range_start and b.created_at.date() <= range_end]
        previous_period_bookings = [b for b in paid_bookings if b.created_at and b.created_at.date() >= previous_range_start and b.created_at.date() <= previous_range_end]
        
        current_period_gross = sum(float(b.total_amount or 0) for b in current_period_bookings)
        previous_period_gross = sum(float(b.total_amount or 0) for b in previous_period_bookings)
        
        commission_rate = float(ADMIN_RUNTIME_SETTINGS["commissionRate"]) / 100
        current_period_commission = current_period_gross * commission_rate
        previous_period_commission = previous_period_gross * commission_rate
    
    # Calculate total (all time)
    total_gross = sum(float(p.amount or 0) + float(p.overtime_fee or 0) for p in paid_transactions) if paid_transactions else 0
    total_commission = total_gross * (float(ADMIN_RUNTIME_SETTINGS["commissionRate"]) / 100) if total_gross > 0 else 0
    
    # Calculate period-over-period change percentage
    def calculate_change_percent(current, previous):
        """Calculate percentage change from previous to current."""
        if previous <= 0:
            return 100 if current > 0 else 0
        return round(((current - previous) / previous) * 100, 1)
    
    revenue_change_percent = calculate_change_percent(current_period_gross, previous_period_gross)
    commission_change_percent = calculate_change_percent(current_period_commission, previous_period_commission)
    
    # Count active users
    active_users = sum(1 for u in users if u.role == "user" and (u.status or "").lower() != "banned" and u.is_active == 1)
    active_owners = sum(1 for u in users if u.role == "owner" and (u.status or "").lower() != "suspended")
    
    # Calculate occupancy
    slot_counts = _slot_counts_by_lot(slots)
    occupancy_values = [
        (slot_counts[lot_id]["occupied"] / slot_counts[lot_id]["total"] * 100) 
        if slot_counts[lot_id]["total"] > 0 else 0
        for lot_id in slot_counts
    ]
    avg_occupancy = int(round(sum(occupancy_values) / len(occupancy_values))) if occupancy_values else 0
    
    # Parking lot stats
    active_parking_lots = sum(1 for lot in parking_lots if lot.is_active == 1)
    total_parking_lots = len(parking_lots)
    
    # Bookings stats with period comparison
    current_period_bookings_count = get_bookings_count_for_period(bookings, range_start, range_end)
    previous_period_bookings_count = get_bookings_count_for_period(bookings, previous_range_start, previous_range_end)
    bookings_change_percent = calculate_change_percent(current_period_bookings_count, previous_period_bookings_count)
    
    # System status (mock data - in real scenario, collect from monitoring)
    system_status = {
        "uptime": "99.98%",
        "cpu": "23%",
        "ram": "56%",
        "database": "98%",
        "apiResponse": "120ms",
        "backupTime": now.strftime("%d/%m/%Y %H:%M"),
    }
    
    # Format trend strings
    def format_trend(percent):
        """Format trend percentage with sign."""
        if percent > 0:
            return f"+{percent}%"
        elif percent < 0:
            return f"{percent}%"
        else:
            return "0%"
    
    # Determine days to display in daily revenue series
    if date_range == "90days":
        days_to_show = 90
    elif date_range == "30days":
        days_to_show = 30
    else:
        days_to_show = 7
    
    return {
        "revenue": {
            "totalRevenue": round(current_period_gross, 2),
            "thisWeekRevenue": round(current_period_gross, 2),  # Current period
            "lastWeekRevenue": round(previous_period_gross, 2),  # Previous period
            "totalCommission": round(total_commission, 2),
            "thisWeekCommission": round(current_period_commission, 2),
            "lastWeekCommission": round(previous_period_commission, 2),
            "totalOwnerPayout": round(current_period_gross - current_period_commission, 2),
        },
        "users": {
            "totalUsers": sum(1 for u in users if u.role == "user"),
            "activeUsers": active_users,
            "totalOwners": sum(1 for u in users if u.role == "owner"),
            "activeOwners": active_owners,
            "totalEmployees": sum(1 for u in users if u.role == "employee"),
        },
        "parking": {
            "totalParkingLots": total_parking_lots,
            "activeParkingLots": active_parking_lots,
            "averageOccupancy": avg_occupancy,
            "totalSlots": sum(c["total"] for c in slot_counts.values()),
            "occupiedSlots": sum(c["occupied"] for c in slot_counts.values()),
        },
        "bookings": {
            "totalBookings": len(bookings),
            "thisWeekBookings": current_period_bookings_count,
            "lastWeekBookings": previous_period_bookings_count,
            "completedBookings": sum(1 for b in bookings if b.status in {"completed", "checked_in"}),
            "pendingBookings": sum(1 for b in bookings if b.status in {"booked", "in_progress"}),
            "cancelledBookings": sum(1 for b in bookings if b.status == "cancelled"),
        },
        "systemStatus": system_status,
        "trends": {
            "revenueChange": format_trend(revenue_change_percent),
            "revenueChangePercent": revenue_change_percent,
            "commissionChange": format_trend(commission_change_percent),
            "commissionChangePercent": commission_change_percent,
            "bookingChange": format_trend(bookings_change_percent),
            "bookingChangePercent": bookings_change_percent,
        },
        "dailyRevenueSeries": _build_daily_revenue_series(payments, start_date=range_start, end_date=range_end),
    }



def _serialize_bootstrap(db: Session) -> dict:
    users = db.query(User).all()
    parking_lots = db.query(ParkingLot).all()
    bookings = db.query(Booking).all()
    slots = db.query(ParkingSlot).all()
    payments = db.query(Payment).all()
    spam_meta, spam_events = _evaluate_user_spam(db, users, bookings)
    if spam_events:
        db.commit()
        users = db.query(User).all()

    booking_counts_by_user: dict[int, int] = defaultdict(int)
    booking_counts_by_lot: dict[int, int] = defaultdict(int)
    last_booking_by_user: dict[int, datetime] = {}
    for booking in bookings:
        if booking.user_id:
            booking_counts_by_user[int(booking.user_id)] += 1
            last_time = booking.created_at or booking.start_time
            if last_time and (
                int(booking.user_id) not in last_booking_by_user
                or last_time > last_booking_by_user[int(booking.user_id)]
            ):
                last_booking_by_user[int(booking.user_id)] = last_time
        if booking.parking_id:
            booking_counts_by_lot[int(booking.parking_id)] += 1

    slot_counts = _slot_counts_by_lot(slots)
    owners = [user for user in users if user.role == "owner"]
    employees = [user for user in users if user.role == "employee"]
    lot_by_owner, owner_by_lot = _owner_parking_maps(db)

    user_rows = [
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "status": _to_status_label(user),
            "bookingCount": booking_counts_by_user.get(int(user.id), 0),
            "lastActive": last_booking_by_user.get(int(user.id)).isoformat() if last_booking_by_user.get(int(user.id)) else None,
            "phone": user.phone,
            "spamScore": spam_meta.get(int(user.id), {}).get("score", 0),
            "spamStatus": spam_meta.get(int(user.id), {}).get("status", "normal"),
            "cancelRatio14d": spam_meta.get(int(user.id), {}).get("cancelRatio", 0),
            "cancelled14d": spam_meta.get(int(user.id), {}).get("cancelledRecent", 0),
            "bookings14d": spam_meta.get(int(user.id), {}).get("totalRecent", 0),
        }
        for user in users if user.role == "user"
    ]
    owner_booking_counts: dict[int, int] = {}
    owner_avg_occupancy: dict[int, int] = {}
    for owner in owners:
        owner_lots = lot_by_owner.get(int(owner.id)) if int(owner.id) in lot_by_owner and lot_by_owner.get(int(owner.id)) else []
        owner_lot_ids = [int(item["id"]) for item in owner_lots if item.get("id") is not None]
        owner_booking_counts[int(owner.id)] = sum(booking_counts_by_lot.get(lot_id, 0) for lot_id in owner_lot_ids)
        if owner_lot_ids:
            occupancy_values = []
            for lot_id in owner_lot_ids:
                counts = slot_counts.get(lot_id, {"total": 0, "occupied": 0})
                occupancy_values.append((counts["occupied"] / counts["total"]) * 100 if counts["total"] > 0 else 0.0)
            owner_avg_occupancy[int(owner.id)] = int(round(sum(occupancy_values) / len(occupancy_values))) if occupancy_values else 0
        else:
            owner_avg_occupancy[int(owner.id)] = 0
    owner_rows = [
        {
            "id": owner.id,
            "name": owner.name,
            "email": owner.email,
            "phone": owner.phone,
            "parkingLots": lot_by_owner.get(int(owner.id)) if int(owner.id) in lot_by_owner and lot_by_owner.get(int(owner.id)) else [],
            # legacy single-string field for backward compatibility (first lot name or placeholder)
            "parkingLot": (lot_by_owner.get(int(owner.id))[0]["name"] if int(owner.id) in lot_by_owner and lot_by_owner.get(int(owner.id)) else "Chưa gán trong CSDL"),
            "status": "active" if _to_status_label(owner) == "active" else "suspended",
            "performance": f"{owner_booking_counts.get(int(owner.id), 0)} lượt đặt chỗ • {owner_avg_occupancy.get(int(owner.id), 0)}% lấp đầy",
            "passwordHint": "Có thể reset từ admin",
        }
        for owner in owners
    ]

    parking_rows = []
    for lot in parking_lots:
        counts = slot_counts.get(int(lot.id), {"total": 0, "occupied": 0})
        total = counts["total"]
        occupied = counts["occupied"]
        occupancy = int(round((occupied / total) * 100)) if total > 0 else 0
        parking_rows.append({
            "id": lot.id,
            "name": lot.name,
            "address": lot.address,
            "owner": owner_by_lot.get(int(lot.id)).name if owner_by_lot.get(int(lot.id)) else "Chưa gán trong CSDL",
            "phone": lot.phone,
            "slotCount": total,
            "status": _lot_status(lot),
            "occupancy": occupancy,
        })

    booking_rows = []
    for booking in bookings:
        user = booking.user
        lot = booking.parking_lot
        slot = booking.slot
        booking_rows.append({
            "id": f"BK-{booking.id}",
            "user": user.name if user else "Unknown user",
            "plate": user.vehicle_plate if user and user.vehicle_plate else "ChÆ°a cÃ³ biá»ƒn sá»‘",
            "parkingLot": lot.name if lot else "ChÆ°a cÃ³ bÃ£i",
            "checkIn": (booking.start_time or booking.created_at or datetime.utcnow()).isoformat(),
            "checkOut": (booking.expire_time or booking.created_at or datetime.utcnow()).isoformat(),
            "status": booking.status,
            "amount": float(booking.total_amount or 0),
            "anomaly": booking.total_amount is None or float(booking.total_amount or 0) <= 0 or slot is None,
        })

    transaction_rows = []
    if payments:
        for payment in payments:
            booking = db.query(Booking).filter(Booking.id == payment.booking_id).first()
            user = booking.user if booking else None
            lot = booking.parking_lot if booking else None
            revenue = split_revenue(float(payment.amount or 0) + float(payment.overtime_fee or 0))
            transaction_rows.append({
                "id": f"TX-{payment.id}",
                "bookingId": f"BK-{payment.booking_id}",
                "user": user.name if user else "Unknown user",
                "parkingLot": lot.name if lot else "ChÆ°a cÃ³ bÃ£i",
                "time": (payment.paid_at or payment.created_at or datetime.utcnow()).isoformat(),
                "gross": revenue["gross"],
                "commission": revenue["commission"],
                "ownerPayout": revenue["ownerPayout"],
                "status": payment.payment_status,
            })
    else:
        for booking in bookings:
            revenue = split_revenue(booking.total_amount)
            transaction_rows.append({
                "id": f"TX-BK-{booking.id}",
                "bookingId": f"BK-{booking.id}",
                "user": booking.user.name if booking.user else "Unknown user",
                "parkingLot": booking.parking_lot.name if booking.parking_lot else "ChÆ°a cÃ³ bÃ£i",
                "time": (booking.created_at or datetime.utcnow()).isoformat(),
                "gross": revenue["gross"],
                "commission": revenue["commission"],
                "ownerPayout": revenue["ownerPayout"],
                "status": "paid" if booking.status in {"booked", "checked_in", "completed"} else booking.status,
            })

    revenue_series, commission_series = _build_revenue_series(payments, bookings)
    revenue_monthly, commission_monthly, bookings_monthly = _build_monthly_revenue_series(payments, bookings)
    avg_occupancy = int(round(sum(item["occupancy"] for item in parking_rows) / len(parking_rows))) if parking_rows else 0
    active_parking = sum(1 for item in parking_rows if item["status"] == "active")
    top_parking = max(parking_rows, key=lambda item: item["occupancy"], default=None)
    growth_values = _build_user_growth_series(bookings)
    prev_growth = growth_values[-2]["amount"] if len(growth_values) > 1 else 0
    current_growth = growth_values[-1]["amount"] if growth_values else 0
    growth_percent = int(round(((current_growth - prev_growth) / prev_growth) * 100)) if prev_growth > 0 else (100 if current_growth > 0 else 0)
    activity_logs = _build_activity_logs(db, bookings, parking_lots)
    combined_logs = activity_logs[:20]

    notifications = [
        {
            "id": item["id"],
            "title": item["action"],
            "time": item["time"],
            "level": item["type"],  # "security", "warning", "booking", etc.
        }
        for item in combined_logs
    ]

    return {
        "commissionRate": get_commission_rate_percent(),
        "users": user_rows,
        "owners": owner_rows,
        "employees": [{
            "id": emp.id,
            "name": emp.name,
            "email": emp.email,
            "phone": emp.phone,
            "status": _to_status_label(emp),
        } for emp in employees],
        "parkingLots": parking_rows,
        "bookings": booking_rows,
        "transactions": transaction_rows,
        "systemRevenue": {
            "revenue": revenue_series,
            "commission": commission_series,
            "revenueMonthly": revenue_monthly,
            "commissionMonthly": commission_monthly,
            "bookings": _build_booking_series(bookings),
            "bookingsMonthly": bookings_monthly,
            "userGrowth": _build_user_growth_series(bookings),
            "occupancy": [{"label": lot["name"], "amount": lot["occupancy"]} for lot in parking_rows[:6]],
        },
        "analyticsSummary": {
            "userGrowthPercent": growth_percent,
            "averageOccupancy": avg_occupancy,
            "activeParkingLots": active_parking,
            "topParking": top_parking["name"] if top_parking else "Chưa có",
            "topParkingOccupancy": top_parking["occupancy"] if top_parking else 0,
        },
        "notifications": notifications,
        "logs": combined_logs,
        "loginHistory": _build_login_history(db),
        "settings": ADMIN_RUNTIME_SETTINGS,
    }


@router.get("/dashboard-stats")
def get_dashboard_stats(
    range: str = "7days",
    dateFrom: str = None,
    dateTo: str = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _build_dashboard_stats(db, date_range=range, date_from=dateFrom, date_to=dateTo)


@router.get("/bootstrap")
def admin_bootstrap(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _serialize_bootstrap(db)


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    payload: UserStatusUpdateRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.role == "user").first()
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

    previous_status = _to_status_label(user)
    user.status = payload.status
    user.is_active = 1 if payload.status == "active" else 0

    if previous_status != payload.status:
        now = vn_now()
        actor_name = admin.name or admin.email or "Admin"
        if payload.status == "banned":
            _record_security_event(
                db,
                event_key=f"user-lock-{user.id}-{int(now.timestamp())}",
                actor=actor_name,
                action=f"Tài khoản {user.email} đang bị khóa",
                target=user.email,
                target_type="user",
                level="security",
                created_at=now,
            )
        else:
            _record_security_event(
                db,
                event_key=f"user-unlock-{user.id}-{int(now.timestamp())}",
                actor=actor_name,
                action=f"Tài khoản {user.email} đã được mở khóa",
                target=user.email,
                target_type="user",
                level="success",
                created_at=now,
            )

    db.commit()
    return {"message": "Cập nhật trạng thái người dùng thành công"}


@router.post("/owners")
def create_owner(
    payload: OwnerCreateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    existing_user = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="Email Ä‘Ã£ tá»“n táº¡i")

    temporary_password = payload.temporary_password.strip() if payload.temporary_password else _generate_strong_password()
    ensure_strong_password(temporary_password)
    initial_status = "active" if payload.status == "active" else "banned"
    initial_is_active = 1 if payload.status == "active" else 0

    owner = User(
        name=payload.name.strip(),
        email=payload.email.lower().strip(),
        role="owner",
        phone=payload.phone.strip() if payload.phone else None,
        vehicle_plate=None,
        status=initial_status,
        is_active=initial_is_active,
        password="__legacy_disabled__",
        password_hash=generate_password_hash(temporary_password),
    )
    db.add(owner)
    db.flush()
    if payload.parking_lot:
        lot = _find_parking_lot_by_reference(db, payload.parking_lot)
        # náº¿u khÃ´ng tÃ¬m tháº¥y bÃ£i theo tham chiáº¿u, thá»­ tÃ¬m tÃªn gáº§n Ä‘Ãºng (case-insensitive)
        if not lot:
            normalized = payload.parking_lot.strip()
            lot = db.query(ParkingLot).filter(ParkingLot.name.ilike(f"%{normalized}%")).first()
        # náº¿u váº«n khÃ´ng cÃ³, táº¡o bÃ£i má»›i tá»± Ä‘á»™ng Ä‘á»ƒ gÃ¡n (hÃ nh vi trÆ°á»›c Ä‘Ã³)
        if not lot:
            lot = ParkingLot(
                name=payload.parking_lot.strip(),
                address=payload.parking_lot.strip(),
                latitude=10.0,
                longitude=106.0,
                has_roof=0,
                is_active=1,
            )
            db.add(lot)
            db.flush()
            price = ParkingPrice(
                parking_id=lot.id,
                price_per_hour=10000,
                price_per_day=70000,
                price_per_month=1500000,
            )
            db.add(price)
            # táº¡o 1 slot máº·c Ä‘á»‹nh
            db.add(ParkingSlot(code=f"P{lot.id}-1", slot_number="1", parking_id=lot.id, status="available"))
        # A parking lot can only have one owner assignment.
        existing_assignment = db.query(OwnerParking).filter(OwnerParking.parking_id == lot.id).first()
        if existing_assignment:
            raise HTTPException(status_code=409, detail="Bai nay da duoc gan cho owner khac")
        db.add(OwnerParking(owner_id=owner.id, parking_id=lot.id))
    db.commit()

    # build response owner info including assigned parking lots (if any)
    assigned = []
    rows = (
        db.query(OwnerParking.parking_id, ParkingLot.name)
        .join(ParkingLot, ParkingLot.id == OwnerParking.parking_id)
        .filter(OwnerParking.owner_id == owner.id)
        .all()
    )
    for r in rows:
        assigned.append({"id": int(r.parking_id), "name": r.name})

    owner_info = {
        "id": owner.id,
        "name": owner.name,
        "email": owner.email,
        "phone": owner.phone,
        "parkingLots": assigned,
        "parkingLot": assigned[0]["name"] if assigned else "Chưa gán trong CSDL",
        "status": payload.status,
        "performance": "0 lượt đặt chỗ • 0% lấp đầy",
        "passwordHint": "Có thể reset từ admin",
    }

    return {"message": "Tạo tài khoản chủ khu vực thành công", "default_password": temporary_password, "owner": owner_info}


@router.patch("/owners/{owner_id}")
def update_owner(
    owner_id: int,
    payload: OwnerUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
    if not owner:
        raise HTTPException(status_code=404, detail="Khong tim thay owner")

    if payload.name is not None:
        owner.name = payload.name.strip()

    if payload.email is not None:
        normalized_email = payload.email.lower().strip()
        duplicate = db.query(User.id).filter(User.email == normalized_email, User.id != owner_id).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Email da ton tai")
        owner.email = normalized_email

    if payload.phone is not None:
        owner.phone = payload.phone.strip() or None

    if payload.status is not None:
        owner.status = "active" if payload.status == "active" else "banned"
        owner.is_active = 1 if payload.status == "active" else 0

    if payload.parking_lot is not None:
        db.query(OwnerParking).filter(OwnerParking.owner_id == owner_id).delete()
        if payload.parking_lot.strip():
            lot = _find_parking_lot_by_reference(db, payload.parking_lot)
            if not lot:
                raise HTTPException(status_code=404, detail="Khong tim thay bai do")
            existing_assignment = db.query(OwnerParking).filter(OwnerParking.parking_id == lot.id).first()
            if existing_assignment and int(existing_assignment.owner_id) != int(owner_id):
                raise HTTPException(status_code=409, detail="Bai do da gan cho owner khac")
            db.add(OwnerParking(owner_id=owner_id, parking_id=lot.id))

    db.commit()
    return {"message": "Da cap nhat thong tin owner"}


@router.patch("/owners/{owner_id}/status")
def update_owner_status(
    owner_id: int,
    payload: OwnerStatusUpdateRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
    if not owner:
        raise HTTPException(status_code=404, detail="Không tìm thấy chủ khu vực")

    previous_status = "active" if _to_status_label(owner) == "active" else "suspended"
    owner.status = "active" if payload.status == "active" else "banned"
    owner.is_active = 1 if payload.status == "active" else 0

    if previous_status != payload.status:
        now = vn_now()
        actor_name = admin.name or admin.email or "Admin"
        if payload.status == "suspended":
            _record_security_event(
                db,
                event_key=f"owner-lock-{owner.id}-{int(now.timestamp())}",
                actor=actor_name,
                action=f"Tài khoản chủ khu vực {owner.email} đang bị khóa",
                target=owner.email,
                target_type="owner",
                level="security",
                created_at=now,
            )
        else:
            _record_security_event(
                db,
                event_key=f"owner-unlock-{owner.id}-{int(now.timestamp())}",
                actor=actor_name,
                action=f"Tài khoản chủ khu vực {owner.email} đã được mở khóa",
                target=owner.email,
                target_type="owner",
                level="success",
                created_at=now,
            )

    db.commit()
    return {"message": "Cập nhật trạng thái chủ khu vực thành công"}


@router.post("/owners/{owner_id}/reset-password")
def reset_owner_password(
    owner_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
    if not owner:
        raise HTTPException(status_code=404, detail="Không tìm thấy chủ khu vực")

    temp_password = _generate_strong_password()
    owner.password = "__legacy_disabled__"
    owner.password_hash = generate_password_hash(temp_password)
    db.commit()
    return {"message": "Đã đặt lại mật khẩu chủ khu vực", "temporary_password": temp_password}


@router.delete("/owners/{owner_id}")
def delete_owner(
    owner_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
    if not owner:
        raise HTTPException(status_code=404, detail="Không tìm thấy chủ khu vực")

    # Xóa đồng bộ dữ liệu liên quan owner để tránh vướng khóa ngoại.
    # 1) Xóa phân công bãi của owner.
    _remove_owner_assignments(db, owner.id)

    # 2) Lấy toàn bộ nhân viên thuộc owner.
    employee_rows = (
        db.query(User.id)
        .filter(User.owner_id == owner.id, User.role == "employee")
        .all()
    )
    employee_ids = [int(row.id) for row in employee_rows]

    # 3) Xóa log hoạt động của nhân viên trước.
    if employee_ids:
        db.query(EmployeeActivity).filter(EmployeeActivity.employee_id.in_(employee_ids)).delete(synchronize_session=False)

        # 4) Xóa toàn bộ tài khoản nhân viên thuộc owner.
        db.query(User).filter(User.id.in_(employee_ids), User.role == "employee").delete(synchronize_session=False)

    # 5) Dọn tham chiếu owner_id còn sót (nếu có).
    db.query(User).filter(User.owner_id == owner.id).update({User.owner_id: None}, synchronize_session=False)

    # 6) Xóa owner.
    db.delete(owner)
    db.commit()
    return {
        "message": "Đã xóa chủ khu vực và đồng bộ dữ liệu liên quan",
        "deletedEmployees": len(employee_ids),
    }


@router.post("/employees/sync-login-format")
def sync_employee_login_format(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    employees = db.query(User).filter(User.role == "employee").all()
    updated = 0
    skipped = 0

    for employee in employees:
        if not employee.parking_id:
            skipped += 1
            continue
        parking_lot = db.query(ParkingLot).filter(ParkingLot.id == employee.parking_id).first()
        if not parking_lot:
            skipped += 1
            continue

        token = _parking_login_token(parking_lot.name)
        next_email = f"bx{token}@gmail.com"
        next_password = f"{token}@hcm"

        duplicate = db.query(User.id).filter(User.email == next_email, User.id != employee.id).first()
        if duplicate:
            skipped += 1
            continue

        employee.email = next_email
        employee.password = "__legacy_disabled__"
        employee.password_hash = generate_password_hash(next_password)
        updated += 1

    db.commit()
    return {
        "message": "Đã đồng bộ format đăng nhập employee",
        "updated": updated,
        "skipped": skipped,
    }


@router.post("/parking-lots")
def create_parking_lot(
    payload: ParkingLotCreateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    owner = _find_owner_by_reference(db, payload.owner)
    if payload.owner and not owner:
        raise HTTPException(status_code=404, detail="Không tìm thấy chủ khu vực")
    duplicate_name = db.query(ParkingLot.id).filter(ParkingLot.name == payload.name.strip()).first()
    if duplicate_name:
        raise HTTPException(status_code=409, detail="Ten bai do da ton tai")

    lot = ParkingLot(
        name=payload.name.strip(),
        address=payload.address.strip(),
        phone=payload.phone.strip() if payload.phone else None,
        latitude=10.0,
        longitude=106.0,
        has_roof=0,
        is_active=1 if payload.status == "active" else 0,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)

    price = ParkingPrice(
        parking_id=lot.id,
        price_per_hour=10000,
        price_per_day=70000,
        price_per_month=1500000,
    )
    db.add(price)
    db.commit()

    for index in range(1, payload.slot_count + 1):
        db.add(ParkingSlot(code=f"P{lot.id}-{index}", slot_number=str(index), parking_id=lot.id, status="available"))
    if owner:
        _assign_owner_parking(db, owner.id, lot.id)
    db.commit()
    return {"message": "ÄÃ£ táº¡o bÃ£i Ä‘á»—"}


@router.patch("/parking-lots/{lot_id}")
def update_parking_lot(
    lot_id: int,
    payload: ParkingLotUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y bÃ£i Ä‘á»—")

    if payload.name is not None:
        lot.name = payload.name.strip()
    if payload.address is not None:
        lot.address = payload.address.strip()
    if payload.phone is not None:
        lot.phone = payload.phone.strip() or None
    if payload.owner is not None:
        db.query(OwnerParking).filter(OwnerParking.parking_id == lot.id).delete()
        owner = _find_owner_by_reference(db, payload.owner)
        if payload.owner.strip():
            if not owner:
                raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y owner")
            _assign_owner_parking(db, owner.id, lot.id)
    if payload.status is not None:
        lot.is_active = 1 if payload.status == "active" else 0
    db.commit()
    return {"message": "ÄÃ£ cáº­p nháº­t bÃ£i Ä‘á»—"}


@router.delete("/parking-lots/{lot_id}")
def delete_parking_lot(
    lot_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y bÃ£i Ä‘á»—")
    has_bookings = db.query(Booking.id).filter(Booking.parking_id == lot_id).first()
    if has_bookings:
        raise HTTPException(status_code=409, detail="Khong the xoa bai do da phat sinh booking")
    db.query(OwnerParking).filter(OwnerParking.parking_id == lot_id).delete()
    db.query(ParkingSlot).filter(ParkingSlot.parking_id == lot_id).delete()
    price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == lot_id).first()
    if price:
        db.delete(price)
    db.delete(lot)
    db.commit()
    return {"message": "ÄÃ£ xÃ³a bÃ£i Ä‘á»—"}


@router.patch("/bookings/{booking_id}/status")
def update_booking_status(
    booking_id: int,
    payload: BookingStatusUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="KhÃ´ng tÃ¬m tháº¥y booking")

    if booking.status == payload.status:
        return {"message": "Booking da o trang thai yeu cau"}

    if booking.status == "completed" and payload.status == "cancelled":
        raise HTTPException(status_code=409, detail="Khong the huy booking da hoan tat")

    booking.status = payload.status
    if booking.slot:
        if payload.status == "cancelled":
            booking.slot.status = "available"
        elif payload.status in {"checked_in", "in_progress"}:
            booking.slot.status = "occupied"
            if payload.status == "checked_in" and booking.actual_checkin is None:
                booking.actual_checkin = datetime.utcnow()
        elif payload.status == "completed":
            booking.slot.status = "available"
            if booking.actual_checkout is None:
                booking.actual_checkout = datetime.utcnow()
    db.commit()
    return {"message": "ÄÃ£ cáº­p nháº­t booking"}


@router.patch("/settings")
def update_admin_settings(
    payload: AdminSettingsUpdateRequest,
    _: User = Depends(require_admin),
):
    try:
        commission_rate = float(payload.commissionRate)
        alert_threshold = float(payload.alertThreshold)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Commission va nguong canh bao phai la so") from exc

    if not 0 <= commission_rate <= 100:
        raise HTTPException(status_code=422, detail="Commission rate phai nam trong khoang 0-100")
    if not 0 <= alert_threshold <= 100:
        raise HTTPException(status_code=422, detail="Nguong canh bao phai nam trong khoang 0-100")
    if "@" not in payload.supportEmail or "." not in payload.supportEmail:
        raise HTTPException(status_code=422, detail="Email ho tro khong hop le")

    ADMIN_RUNTIME_SETTINGS.update({
        "commissionRate": str(int(commission_rate) if commission_rate.is_integer() else commission_rate),
        "supportEmail": payload.supportEmail.strip(),
        "maintenanceWindow": payload.maintenanceWindow.strip(),
        "alertThreshold": str(int(alert_threshold) if alert_threshold.is_integer() else alert_threshold),
    })
    return {"message": "ÄÃ£ cáº­p nháº­t cáº¥u hÃ¬nh admin", "settings": ADMIN_RUNTIME_SETTINGS}


@router.post("/rebuild-owner-assignments")
def rebuild_owner_assignments(_ : User = Depends(require_admin), db: Session = Depends(get_db)):
    """Rebuild OwnerParking assignments from current `managed_district_id` on users.

    For owners with `managed_district_id` set, existing assignments for that owner
    will be removed and replaced by all active parking lots in that district.
    Owners without `managed_district_id` are left unchanged.
    """
    from app.models.models import OwnerParking, ParkingLot, User

    # clear all existing owner_parking rows first
    removed = db.query(OwnerParking).delete()

    # collect owners grouped by district
    districts = db.query(User.managed_district_id).filter(User.role == "owner", User.managed_district_id != None).distinct().all()
    created = 0
    for (district_id,) in districts:
        owners_in_district = db.query(User).filter(User.role == "owner", User.managed_district_id == district_id).order_by(User.id.asc()).all()
        if not owners_in_district:
            continue
        lots = db.query(ParkingLot).filter(ParkingLot.district_id == district_id, ParkingLot.is_active == 1).order_by(ParkingLot.id.asc()).all()
        if not lots:
            continue
        # distribute lots evenly among owners in that district (round-robin)
        for index, lot in enumerate(lots):
            owner = owners_in_district[index % len(owners_in_district)]
            db.add(OwnerParking(owner_id=owner.id, parking_id=lot.id))
            created += 1

    db.commit()
    return {"message": "ÄÃ£ rebuild owner_parking assignments", "removed": removed, "created": created}


@router.get("/owner-assignments-debug")
def owner_assignments_debug(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Debug endpoint: return all owner_parking rows with owner and parking names."""
    rows = (
        db.query(OwnerParking.id.label("id"), OwnerParking.owner_id.label("owner_id"), User.name.label("owner_name"), OwnerParking.parking_id.label("parking_id"), ParkingLot.name.label("parking_name"))
        .join(User, User.id == OwnerParking.owner_id)
        .join(ParkingLot, ParkingLot.id == OwnerParking.parking_id)
        .order_by(OwnerParking.owner_id.asc(), OwnerParking.parking_id.asc())
        .all()
    )
    return [ {"id": int(r.id), "owner_id": int(r.owner_id), "owner_name": r.owner_name, "parking_id": int(r.parking_id), "parking_name": r.parking_name} for r in rows ]


@router.post("/auto-assign-owners")
def auto_assign_owners(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Auto-assign owners to parking lots using managed_district_id or heuristics from owner name.

    Behaviour:
    - Clear existing `owner_parking` rows.
    - For each owner:
      * If `managed_district_id` present -> assign all active lots in that district (round-robin among owners in that district).
      * Else try to extract district number from `name` (e.g. 'Quan 1', 'Quáº­n 3', 'quáº­n 7').
      * If district found -> assign active lots in that district to the owner.
    """
    # New behavior: assign parking lots exclusively per district.
    # For each district, find owner(s) that manage that district (by managed_district_id or name heuristic).
    # If exactly one owner found -> assign all active lots in that district to that owner.
    # If multiple owners found -> assign to the first and report potential conflicts.
    from app.models.models import OwnerParking, ParkingLot, User, District
    import re

    # Clear existing assignments first
    db.query(OwnerParking).delete()

    owners_all = db.query(User).filter(User.role == "owner").all()
    districts = db.query(District).order_by(District.id.asc()).all()

    assigned = 0
    conflicts: dict[int, list[int]] = {}
    unassigned: list[str] = []

    # index owners by managed_district_id
    owners_by_did: dict[int, list[User]] = {}
    for o in owners_all:
        if o.managed_district_id:
            owners_by_did.setdefault(int(o.managed_district_id), []).append(o)

    # For quick name heuristics, lowercase owner names
    owners_no_did = [o for o in owners_all if not o.managed_district_id]

    for d in districts:
        did = int(d.id)
        candidate_owners = owners_by_did.get(did, [])

        # if none by managed_district_id, try name heuristics
        if not candidate_owners:
            dname = (d.name or "").lower()
            for o in owners_no_did:
                on = (o.name or "").lower()
                # match 'quan X' or district name substring
                m = re.search(r"quan\s*(\d+)|quáº­n\s*(\d+)", on)
                matched = False
                if m:
                    num = m.group(1) or m.group(2)
                    try:
                        if int(num) == did:
                            candidate_owners.append(o)
                            matched = True
                    except Exception:
                        pass
                if not matched and dname and dname in on:
                    candidate_owners.append(o)

        if not candidate_owners:
            unassigned.append(d.name or f"district_{did}")
            continue

        # If multiple owners, record conflict and pick first
        if len(candidate_owners) > 1:
            conflicts[did] = [int(o.id) for o in candidate_owners]

        owner = candidate_owners[0]
        lots = db.query(ParkingLot).filter(ParkingLot.district_id == did, ParkingLot.is_active == 1).all()
        for lot in lots:
            db.add(OwnerParking(owner_id=owner.id, parking_id=lot.id))
            assigned += 1

    db.commit()
    return {"message": "Auto-assign completed (exclusive per-district)", "assigned": assigned, "conflicts": conflicts, "unassigned_districts": unassigned}
