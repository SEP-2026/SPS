from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import (
    AdminSecurityEvent,
    Booking,
    District,
    OwnerParking,
    ParkingLot,
    Payment,
    User,
    UserVehicle,
    Wallet,
    WalletTransaction,
)
from app.services.admin_owners import _district_maps, _owner_parking_maps, _resolve_district_name
from app.services.revenue_settings import split_revenue
from app.utils.timezone import isoformat_vn, vn_now, vn_today

MANAGED_ROLES = ("user", "owner", "employee")

ROLE_LABELS = {
    "owner": "Quản lý khu vực",
    "employee": "Tài khoản bãi",
    "user": "Người dùng",
}

ROLE_KEYS = {
    "owner": "area_manager",
    "employee": "parking_account",
    "user": "end_user",
}

ROLE_INPUT_ALIASES = {
    "user": "user",
    "end_user": "user",
    "owner": "owner",
    "area_manager": "owner",
    "employee": "employee",
    "parking_account": "employee",
}


def _to_status_label(user: User) -> str:
    if user.status and user.status.lower() == "banned":
        return "banned"
    return "active" if user.is_active == 1 else "banned"


def _evaluate_user_spam(db: Session, users: list[User], bookings: list[Booking]) -> tuple[dict[int, dict], list]:
    now = vn_now()
    user_meta: dict[int, dict] = {}
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
        }
        if is_spam and user.is_active == 1 and (not user.status or user.status.lower() != "banned"):
            user.status = "banned"
            user.is_active = 0
            db.flush()

    return user_meta, []


def _growth_percent(current: float, previous: float) -> float:
    if previous <= 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 1)


def _username_handle(email: str | None) -> str:
    if not email or "@" not in email:
        return ""
    local = email.split("@", 1)[0].strip().lower()
    return f"@{local}"


def _initials(name: str | None) -> str:
    if not name:
        return "?"
    parts = [p for p in name.strip().split() if p]
    if len(parts) >= 2:
        return f"{parts[0][0]}{parts[-1][0]}".upper()
    return name.strip()[:2].upper()


def _display_status(user: User) -> str:
    if user.is_active == 0 or (user.status or "").lower() in {"banned", "suspended", "locked"}:
        return "locked"
    return "active"


def _status_label_vi(status: str) -> str:
    return "Hoạt động" if status == "active" else "Tạm khóa"


def _role_permissions(role: str) -> list[dict[str, Any]]:
    if role == "owner":
        return [
            {"key": "manage_parking", "label": "Quản lý bãi đỗ", "allowed": True},
            {"key": "view_reports", "label": "Xem báo cáo", "allowed": True},
            {"key": "manage_employees", "label": "Quản lý nhân viên", "allowed": True},
            {"key": "system_settings", "label": "Cài đặt hệ thống", "allowed": False},
        ]
    if role == "employee":
        return [
            {"key": "manage_parking", "label": "Quản lý bãi đỗ", "allowed": True},
            {"key": "view_reports", "label": "Xem báo cáo", "allowed": False},
            {"key": "manage_employees", "label": "Quản lý nhân viên", "allowed": False},
            {"key": "system_settings", "label": "Cài đặt hệ thống", "allowed": False},
        ]
    return [
        {"key": "manage_parking", "label": "Quản lý bãi đỗ", "allowed": False},
        {"key": "view_reports", "label": "Xem báo cáo", "allowed": False},
        {"key": "book_parking", "label": "Đặt chỗ bãi xe", "allowed": True},
        {"key": "system_settings", "label": "Cài đặt hệ thống", "allowed": False},
    ]


def _month_bounds(reference: date) -> tuple[date, date, date, date]:
    # Current period: from 1st of this month to today
    first_this = reference.replace(day=1)
    
    # Previous period: same number of days last month
    # This ensures fair comparison even when current month is incomplete
    days_elapsed = (reference - first_this).days + 1  # +1 to include the 1st day
    first_prev = first_this - timedelta(days=days_elapsed)
    last_prev = first_prev + timedelta(days=days_elapsed - 1)
    
    return first_this, reference, first_prev, last_prev


def _serialize_list_row(
    user: User,
    *,
    districts: dict[int, str],
    parking_by_owner: dict[int, list[int]],
    lots_by_id: dict[int, ParkingLot],
    lot_district: dict[int, int | None],
    employee_parking: dict[int, ParkingLot],
    booking_counts: dict[int, int],
    spam_meta: dict[int, dict],
    last_booking: dict[int, datetime],
) -> dict[str, Any]:
    role = user.role or "user"
    user_id = int(user.id)
    status = _display_status(user)

    area_label = "—"
    parking_label = "—"
    if role == "owner":
        parking_ids = parking_by_owner.get(user_id, [])
        district_name, _ = _resolve_district_name(user, parking_ids, districts, lot_district, lots_by_id)
        area_label = district_name or "—"
        if parking_ids:
            names = [lots_by_id[pid].name for pid in parking_ids if pid in lots_by_id]
            parking_label = ", ".join(names[:2]) + ("..." if len(names) > 2 else "") if names else "—"
    elif role == "employee":
        lot = employee_parking.get(user_id)
        if lot:
            parking_label = lot.name
            area_label = lot.district.name if lot.district else "—"
    elif role == "user":
        parking_label = "—"

    spam = spam_meta.get(user_id, {}) if role == "user" else {}

    return {
        "id": user_id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone or "",
        "username": _username_handle(user.email),
        "initials": _initials(user.name),
        "role": role,
        "roleKey": ROLE_KEYS.get(role, role),
        "roleLabel": ROLE_LABELS.get(role, role),
        "areaLabel": area_label,
        "parkingLabel": parking_label,
        "status": status,
        "statusLabel": _status_label_vi(status),
        "accountStatus": _to_status_label(user),
        "createdAt": isoformat_vn(user.created_at),
        "updatedAt": isoformat_vn(user.created_at),
        "lastActive": isoformat_vn(last_booking.get(user_id)) if last_booking.get(user_id) else None,
        "bookingCount": booking_counts.get(user_id, 0),
        "spamScore": spam.get("score", 0),
        "spamStatus": spam.get("status", "normal"),
        "bookings14d": spam.get("totalRecent", 0),
        "cancelled14d": spam.get("cancelledRecent", 0),
    }


def build_user_management(
    db: Session,
    *,
    search: str | None = None,
    role: str | None = None,
    status: str | None = None,
    district_id: int | None = None,
    created_sort: str = "newest",
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    today = vn_today()
    first_this, _, first_prev, last_prev = _month_bounds(today)

    users = (
        db.query(User)
        .filter(User.role.in_(MANAGED_ROLES))
        .order_by(User.id.asc())
        .all()
    )

    districts, lot_district = _district_maps(db)
    parking_by_owner, lots_by_id = _owner_parking_maps(db)

    employee_parking: dict[int, ParkingLot] = {}
    employee_rows = db.query(User).filter(User.role == "employee", User.parking_id.isnot(None)).all()
    lot_ids = {int(row.parking_id) for row in employee_rows if row.parking_id}
    lots_map = {int(lot.id): lot for lot in db.query(ParkingLot).filter(ParkingLot.id.in_(lot_ids)).all()} if lot_ids else {}
    for row in employee_rows:
        if row.parking_id and int(row.parking_id) in lots_map:
            employee_parking[int(row.id)] = lots_map[int(row.parking_id)]

    bookings = db.query(Booking).all()
    booking_counts: dict[int, int] = defaultdict(int)
    last_booking: dict[int, datetime] = {}
    for booking in bookings:
        if not booking.user_id:
            continue
        uid = int(booking.user_id)
        booking_counts[uid] += 1
        moment = booking.created_at or booking.start_time
        if moment and (uid not in last_booking or moment > last_booking[uid]):
            last_booking[uid] = moment

    end_users = [user for user in users if user.role == "user"]
    spam_meta, _ = _evaluate_user_spam(db, end_users, bookings)
    if end_users:
        db.commit()

    all_rows: list[dict[str, Any]] = []
    for user in users:
        row = _serialize_list_row(
            user,
            districts=districts,
            parking_by_owner=parking_by_owner,
            lots_by_id=lots_by_id,
            lot_district=lot_district,
            employee_parking=employee_parking,
            booking_counts=booking_counts,
            spam_meta=spam_meta,
            last_booking=last_booking,
        )
        if role and role != "all" and row["roleKey"] != role and row["role"] != role:
            continue
        if status and status != "all" and row["status"] != status:
            continue
        if district_id is not None:
            resolved_district = None
            if user.role == "owner" and user.managed_district_id:
                resolved_district = int(user.managed_district_id)
            elif user.role == "owner":
                _, resolved_district = _resolve_district_name(
                    user,
                    parking_by_owner.get(int(user.id), []),
                    districts,
                    lot_district,
                    lots_by_id,
                )
            if resolved_district != district_id:
                continue
        if search and search.strip():
            token = search.strip().lower()
            haystack = f"{row['name']} {row['email']} {row['phone']} {row['username']} {row['areaLabel']} {row['parkingLabel']}".lower()
            if token not in haystack:
                continue
        all_rows.append(row)

    reverse = created_sort != "oldest"
    all_rows.sort(key=lambda item: item.get("createdAt") or "", reverse=reverse)

    total = len(all_rows)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start_index = (safe_page - 1) * safe_size
    items = all_rows[start_index : start_index + safe_size]

    def _count_created_between(start: date, end: date, role_filter: str | None = None) -> int:
        total_count = 0
        for user in users:
            if role_filter and user.role != role_filter:
                continue
            if user.created_at and start <= user.created_at.date() <= end:
                total_count += 1
        return total_count

    total_users = len(users)
    area_managers = sum(1 for user in users if user.role == "owner")
    parking_accounts = sum(1 for user in users if user.role == "employee")
    end_users_count = sum(1 for user in users if user.role == "user")

    def _trend(role_filter: str | None = None) -> int:
        current = _count_created_between(first_this, today, role_filter)
        previous = _count_created_between(first_prev, last_prev, role_filter)
        return current - previous

    active_count = sum(1 for row in all_rows if row["status"] == "active")
    locked_count = sum(1 for row in all_rows if row["status"] == "locked")

    return {
        "summary": {
            "totalUsers": total_users,
            "areaManagers": area_managers,
            "parkingAccounts": parking_accounts,
            "endUsers": end_users_count,
            "activeUsers": active_count,
            "lockedUsers": locked_count,
            "trends": {
                "totalUsersChange": _trend(),
                "areaManagersChange": _trend("owner"),
                "parkingAccountsChange": _trend("employee"),
                "endUsersChange": _trend("user"),
            },
        },
        "districts": [{"id": did, "name": name} for did, name in sorted(districts.items(), key=lambda item: item[1])],
        "items": items,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_size,
            "total": total,
            "totalPages": max(1, (total + safe_size - 1) // safe_size),
        },
        "generatedAt": isoformat_vn(vn_now(), fallback_now=True),
    }


def _user_security_events(db: Session, email: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = (
        db.query(AdminSecurityEvent)
        .filter(AdminSecurityEvent.target == email)
        .order_by(AdminSecurityEvent.created_at.desc(), AdminSecurityEvent.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": int(row.id),
            "actor": row.actor,
            "action": row.action,
            "time": isoformat_vn(row.created_at, fallback_now=True),
            "level": row.level,
        }
        for row in rows
    ]


def _owner_monthly_revenue(db: Session, parking_ids: list[int]) -> float:
    if not parking_ids:
        return 0.0
    today = vn_today()
    month_start = today.replace(day=1)
    payments = (
        db.query(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .filter(
            Booking.parking_id.in_(parking_ids),
            Payment.payment_status == "paid",
        )
        .all()
    )
    total = 0.0
    for payment in payments:
        moment = payment.paid_at or payment.created_at
        if not moment or moment.date() < month_start:
            continue
        total += split_revenue(float(payment.amount or 0) + float(payment.overtime_fee or 0))["gross"]
    return round(total, 2)


def build_user_detail(db: Session, user_id: int) -> dict[str, Any]:
    user = db.query(User).filter(User.id == user_id, User.role.in_(MANAGED_ROLES)).first()
    if not user:
        return {}

    districts, lot_district = _district_maps(db)
    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    role = user.role or "user"
    status = _display_status(user)

    managed_areas: list[dict[str, Any]] = []
    managed_parking_lots: list[dict[str, Any]] = []
    parking_ids: list[int] = []

    if role == "owner":
        parking_ids = parking_by_owner.get(int(user.id), [])
        district_name, district_id = _resolve_district_name(user, parking_ids, districts, lot_district, lots_by_id)
        if district_name and district_name != "Khác":
            managed_areas.append({"id": district_id, "name": district_name})
        if user.managed_district_id and int(user.managed_district_id) in districts:
            did = int(user.managed_district_id)
            if not any(item["id"] == did for item in managed_areas):
                managed_areas.append({"id": did, "name": districts[did]})
        for pid in parking_ids:
            lot = lots_by_id.get(pid)
            if lot:
                managed_parking_lots.append({
                    "id": int(lot.id),
                    "name": lot.name,
                    "address": lot.address,
                    "status": "active" if lot.is_active == 1 else "locked",
                })
    elif role == "employee" and user.parking_id:
        lot = db.query(ParkingLot).filter(ParkingLot.id == user.parking_id).first()
        if lot:
            managed_parking_lots.append({
                "id": int(lot.id),
                "name": lot.name,
                "address": lot.address,
                "status": "active" if lot.is_active == 1 else "locked",
            })
            if lot.district_id and int(lot.district_id) in districts:
                managed_areas.append({"id": int(lot.district_id), "name": districts[int(lot.district_id)]})

    location = managed_areas[0]["name"] if managed_areas else "—"
    if role == "user":
        location = "—"

    bookings = (
        db.query(Booking)
        .filter(Booking.user_id == user.id)
        .order_by(Booking.created_at.desc())
        .limit(50)
        .all()
    )
    booking_items = []
    for booking in bookings:
        lot_name = ""
        if booking.parking_id:
            lot = lots_by_id.get(int(booking.parking_id)) or db.query(ParkingLot).filter(ParkingLot.id == booking.parking_id).first()
            lot_name = lot.name if lot else ""
        booking_items.append({
            "id": int(booking.id),
            "parkingLot": lot_name,
            "status": booking.status,
            "amount": float(booking.total_amount or 0),
            "createdAt": isoformat_vn(booking.created_at),
            "checkIn": isoformat_vn(booking.start_time),
            "checkOut": isoformat_vn(booking.expire_time),
        })

    wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
    wallet_balance = float(wallet.balance) if wallet else 0.0
    wallet_transactions: list[dict[str, Any]] = []
    if wallet:
        rows = (
            db.query(WalletTransaction)
            .filter(WalletTransaction.wallet_id == wallet.id)
            .order_by(WalletTransaction.created_at.desc())
            .limit(20)
            .all()
        )
        wallet_transactions = [
            {
                "id": int(row.id),
                "type": row.transaction_type,
                "amount": float(row.amount or 0),
                "note": row.note or "",
                "createdAt": isoformat_vn(row.created_at),
            }
            for row in rows
        ]

    vehicle = db.query(UserVehicle).filter(UserVehicle.user_id == user.id).first()
    spam_meta: dict[str, Any] = {}
    if role == "user":
        all_bookings = db.query(Booking).all()
        meta, _ = _evaluate_user_spam(db, [user], all_bookings)
        spam_meta = meta.get(int(user.id), {})

    employee_count = 0
    monthly_revenue = 0.0
    if role == "owner":
        employee_count = (
            db.query(func.count(User.id))
            .filter(User.role == "employee", User.owner_id == user.id)
            .scalar()
            or 0
        )
        monthly_revenue = _owner_monthly_revenue(db, parking_ids)

    activity = _user_security_events(db, user.email, limit=30)
    for booking in bookings[:10]:
        activity.append({
            "id": f"booking-{booking.id}",
            "actor": user.name,
            "action": f"Đặt chỗ #{booking.id} — {booking.status}",
            "time": isoformat_vn(booking.created_at),
            "level": "system",
        })
    activity.sort(key=lambda item: item.get("time") or "", reverse=True)

    created_by = "Hệ thống"
    first_event = (
        db.query(AdminSecurityEvent)
        .filter(AdminSecurityEvent.target == user.email, AdminSecurityEvent.action.ilike("%tạo%"))
        .order_by(AdminSecurityEvent.created_at.asc())
        .first()
    )
    if first_event:
        created_by = first_event.actor

    return {
        "id": int(user.id),
        "name": user.name,
        "email": user.email,
        "phone": user.phone or "",
        "username": _username_handle(user.email),
        "initials": _initials(user.name),
        "role": role,
        "roleKey": ROLE_KEYS.get(role, role),
        "roleLabel": ROLE_LABELS.get(role, role),
        "status": status,
        "statusLabel": _status_label_vi(status),
        "accountStatus": _to_status_label(user),
        "location": location,
        "address": location,
        "createdAt": isoformat_vn(user.created_at),
        "updatedAt": isoformat_vn(user.created_at),
        "createdBy": created_by,
        "lastLoginAt": isoformat_vn(user.created_at),
        "loginMethod": "Email / Mật khẩu",
        "failedLoginRecent": "—",
        "vehiclePlate": user.vehicle_plate or (vehicle.license_plate if vehicle else ""),
        "vehicleColor": user.vehicle_color or (vehicle.vehicle_color if vehicle else ""),
        "vehicleBrand": vehicle.brand if vehicle else "",
        "vehicleModel": vehicle.vehicle_model if vehicle else "",
        "managedAreas": managed_areas,
        "managedParkingLots": managed_parking_lots,
        "permissions": _role_permissions(role),
        "quickStats": {
            "managedParkingLots": len(managed_parking_lots) if role != "user" else len(bookings),
            "parkingAccounts": int(employee_count),
            "monthlyRevenue": monthly_revenue,
            "walletBalance": wallet_balance,
            "bookingCount": len(bookings),
        },
        "spam": spam_meta,
        "bookings": booking_items,
        "walletTransactions": wallet_transactions,
        "activity": activity[:30],
        "tabs": {
            "general": True,
            "managedAreas": bool(managed_areas),
            "managedParkingLots": bool(managed_parking_lots),
            "activityStats": role == "user",
            "systemLog": True,
        },
    }


def _normalize_role_input(role: str) -> str:
    normalized = ROLE_INPUT_ALIASES.get((role or "").strip().lower())
    if not normalized:
        raise ValueError("Vai trò không hợp lệ")
    return normalized


def build_user_form_options(db: Session) -> dict[str, Any]:
    districts = db.query(District).order_by(District.name.asc()).all()
    owners = (
        db.query(User)
        .filter(User.role == "owner")
        .order_by(User.name.asc())
        .all()
    )
    parking_lots = (
        db.query(ParkingLot)
        .filter(ParkingLot.is_active == 1)
        .order_by(ParkingLot.name.asc())
        .all()
    )
    owner_parking_rows = db.query(OwnerParking.owner_id, OwnerParking.parking_id).all()
    parking_by_owner: dict[int, list[int]] = defaultdict(list)
    assigned_parking_ids: set[int] = set()
    for row in owner_parking_rows:
        parking_by_owner[int(row.owner_id)].append(int(row.parking_id))
        assigned_parking_ids.add(int(row.parking_id))
    employee_parking_ids = {
        int(row.parking_id)
        for row in db.query(User.parking_id).filter(User.role == "employee", User.parking_id.isnot(None)).all()
        if row.parking_id
    }

    return {
        "roles": [
            {"value": "end_user", "label": ROLE_LABELS["user"]},
            {"value": "area_manager", "label": ROLE_LABELS["owner"]},
            {"value": "parking_account", "label": ROLE_LABELS["employee"]},
        ],
        "districts": [{"id": int(d.id), "name": d.name} for d in districts],
        "owners": [
            {
                "id": int(owner.id),
                "name": owner.name,
                "email": owner.email,
                "districtId": int(owner.managed_district_id) if owner.managed_district_id else None,
                "parkingIds": parking_by_owner.get(int(owner.id), []),
            }
            for owner in owners
        ],
        "parkingLots": [
            {
                "id": int(lot.id),
                "name": lot.name,
                "address": lot.address,
                "districtId": int(lot.district_id) if lot.district_id else None,
                "hasOwner": int(lot.id) in assigned_parking_ids,
                "hasEmployee": int(lot.id) in employee_parking_ids,
            }
            for lot in parking_lots
        ],
    }


def create_managed_user(
    db: Session,
    *,
    name: str,
    email: str,
    phone: str | None,
    password: str,
    role: str,
    status: str = "active",
    managed_district_id: int | None = None,
    owner_id: int | None = None,
    parking_id: int | None = None,
    vehicle_plate: str | None = None,
    vehicle_color: str | None = None,
) -> dict[str, Any]:
    from werkzeug.security import generate_password_hash

    normalized_role = _normalize_role_input(role)
    normalized_email = email.lower().strip()
    normalized_name = name.strip()

    if not normalized_name:
        raise ValueError("Họ tên không được để trống")
    if not normalized_email or "@" not in normalized_email:
        raise ValueError("Email không hợp lệ")

    existing = db.query(User).filter(User.email == normalized_email).first()
    if existing:
        raise ValueError("Email đã tồn tại")

    if status in {"suspended", "banned", "locked"}:
        db_status = "banned"
        is_active_flag = 0
    else:
        db_status = "active"
        is_active_flag = 1

    user = User(
        name=normalized_name,
        email=normalized_email,
        phone=phone.strip() if phone else None,
        role=normalized_role,
        status=db_status,
        is_active=is_active_flag,
        password="__legacy_disabled__",
        password_hash=generate_password_hash(password),
        vehicle_plate=vehicle_plate.strip() if vehicle_plate else None,
        vehicle_color=vehicle_color.strip() if vehicle_color else None,
    )

    if normalized_role == "owner":
        if managed_district_id:
            district = db.query(District).filter(District.id == managed_district_id).first()
            if not district:
                raise ValueError("Khu vực quản lý không tồn tại")
            user.managed_district_id = int(district.id)
        if parking_id:
            lot = db.query(ParkingLot).filter(ParkingLot.id == parking_id).first()
            if not lot:
                raise ValueError("Bãi xe không tồn tại")
            existing_assignment = (
                db.query(OwnerParking)
                .filter(OwnerParking.parking_id == parking_id)
                .first()
            )
            if existing_assignment:
                raise ValueError("Bãi xe đã được gán cho quản lý khu vực khác")
    elif normalized_role == "employee":
        if not owner_id:
            raise ValueError("Vui lòng chọn quản lý khu vực (chủ bãi)")
        if not parking_id:
            raise ValueError("Vui lòng chọn bãi xe")
        if not phone or not phone.strip():
            raise ValueError("Số điện thoại là bắt buộc với tài khoản bãi")

        owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
        if not owner:
            raise ValueError("Quản lý khu vực không tồn tại")

        assignment = (
            db.query(OwnerParking)
            .filter(OwnerParking.owner_id == owner_id, OwnerParking.parking_id == parking_id)
            .first()
        )
        if not assignment:
            raise ValueError("Bãi xe không thuộc quyền quản lý của chủ bãi đã chọn")

        duplicate_employee = (
            db.query(User.id)
            .filter(User.role == "employee", User.parking_id == parking_id)
            .first()
        )
        if duplicate_employee:
            raise ValueError("Mỗi bãi xe chỉ được tạo một tài khoản vận hành")

        user.owner_id = int(owner.id)
        user.parking_id = int(parking_id)
    elif normalized_role == "user":
        pass

    db.add(user)
    db.flush()

    if normalized_role == "owner" and parking_id:
        db.add(OwnerParking(owner_id=int(user.id), parking_id=int(parking_id)))

    if normalized_role == "user":
        db.add(Wallet(user_id=int(user.id), balance=0, reserved_balance=0))

    db.commit()
    db.refresh(user)

    return {
        "id": int(user.id),
        "name": user.name,
        "email": user.email,
        "role": normalized_role,
        "roleKey": ROLE_KEYS[normalized_role],
        "roleLabel": ROLE_LABELS[normalized_role],
        "status": _display_status(user),
        "temporaryPassword": password,
    }

