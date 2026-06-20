from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import re
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.models.models import (
    Booking,
    EmployeeActivity,
    OwnerParking,
    ParkingLot,
    ParkingOperationalState,
    ParkingSlot,
    User,
)
from app.routes.auth import create_access_token_for_subject
from app.routes.booking import _overview_slot_status
from app.routes.gate import (
    _execute_check_in,
    _execute_check_out,
    _get_payment,
    _local_now,
    _parse_scan_payload,
    _serialize_booking_detail,
)

APP_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")
EMPLOYEE_PASSWORD_MIN_LENGTH = 6
PARKING_LOGIN_PREFIXES = (
    "smart parking",
    "bai dau xe",
    "bai giu xe",
    "bai do",
    "bai xe",
    "parking lot",
    "parking",
)
LOCATION_TOKEN_ALIASES = (
    (("ho chi minh", "tp hcm", "tphcm", "hcm", "sai gon", "saigon"), "hcm"),
    (("ha noi", "hanoi"), "hanoi"),
    (("da nang", "danang"), "danang"),
    (("can tho", "cantho"), "cantho"),
    (("hai phong", "haiphong"), "haiphong"),
    (("binh duong",), "binhduong"),
    (("dong nai",), "dongnai"),
)

BOOKING_STATUS_PRIORITY = {
    "checked_in": 0,
    "in_progress": 1,
    "booked": 2,
    "pending": 3,
}


def _get_owner_assignment(owner_id: int, parking_id: int, db: Session) -> OwnerParking | None:
    return (
        db.query(OwnerParking)
        .filter(OwnerParking.owner_id == owner_id, OwnerParking.parking_id == parking_id)
        .first()
    )


def _get_employee_parking(employee: User, db: Session) -> ParkingLot:
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == employee.parking_id).first()
    if not parking_lot:
        raise HTTPException(status_code=404, detail="Không tìm thấy bãi được phân công")
    return parking_lot


def _get_operational_state(parking_id: int, db: Session) -> ParkingOperationalState:
    state = db.query(ParkingOperationalState).filter(ParkingOperationalState.parking_id == parking_id).first()
    if not state:
        state = ParkingOperationalState(parking_id=parking_id, status="open")
        db.add(state)
        db.flush()
    return state


def _compute_slot_metrics(parking_id: int, db: Session) -> tuple[int, int, int]:
    total_slots = (
        db.query(func.count())
        .select_from(ParkingSlot)
        .filter(ParkingSlot.parking_id == parking_id)
        .scalar()
        or 0
    )
    occupied_slots = (
        db.query(func.count())
        .select_from(Booking)
        .filter(Booking.parking_id == parking_id, Booking.status.in_(["pending", "booked", "checked_in"]))
        .scalar()
        or 0
    )
    empty_slots = max(int(total_slots) - int(occupied_slots), 0)
    return int(total_slots), int(occupied_slots), int(empty_slots)


def _resolve_status(parking_id: int, db: Session) -> str:
    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == parking_id).first()
    if not parking_lot:
        return "closed"
    if int(parking_lot.is_active or 0) != 1:
        return "locked"

    total_slots, occupied_slots, _ = _compute_slot_metrics(parking_id, db)
    state = _get_operational_state(parking_id, db)
    if state.status == "closed":
        return "closed"
    if state.status == "full" or (total_slots > 0 and occupied_slots >= total_slots):
        return "full"
    return "open"


def _assert_employee_can_check_in(parking_id: int, db: Session) -> None:
    if _resolve_status(parking_id, db) == "locked":
        raise HTTPException(status_code=409, detail="Bãi đang bị khóa, không thể check-in")

    total_slots, occupied_slots, _ = _compute_slot_metrics(parking_id, db)
    state = _get_operational_state(parking_id, db)
    if state.status == "closed":
        raise HTTPException(status_code=409, detail="Bãi đang đóng, không thể check-in")
    if state.status == "full" or (total_slots > 0 and occupied_slots >= total_slots):
        raise HTTPException(status_code=409, detail="Bãi đang đầy, không thể check-in")


def _serialize_employee(employee: User) -> dict:
    return {
        "id": employee.id,
        "username": employee.email,
        "email": employee.email,
        "full_name": employee.name,
        "role": employee.role,
        "owner_id": employee.owner_id,
        "parking_id": employee.parking_id,
        "status": employee.status,
        "created_at": employee.created_at,
    }


def _normalize_identity(value: str) -> str:
    return value.strip().lower()


def _ascii_words(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").replace("Đ", "D").replace("đ", "d"))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


def _is_address_number_token(value: str) -> bool:
    return bool(re.fullmatch(r"\d+[a-z]?", value or ""))


def _strip_leading_address_tokens(normalized: str) -> str:
    tokens = normalized.split()
    while tokens and _is_address_number_token(tokens[0]) and any(not _is_address_number_token(token) for token in tokens[1:]):
        tokens.pop(0)
    return " ".join(tokens)


def _parking_login_token(parking_name: str) -> str:
    normalized = _ascii_words(parking_name)

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

    normalized = _strip_leading_address_tokens(normalized)
    token = re.sub(r"[^a-z0-9]+", "", normalized)
    return token or "parking"


def _parking_location_token(parking_lot: ParkingLot) -> str:
    district_name = parking_lot.district.name if parking_lot.district else ""
    normalized = _ascii_words(f"{parking_lot.address} {district_name} {parking_lot.name}")
    compact = re.sub(r"[^a-z0-9]+", "", normalized)

    for keywords, token in LOCATION_TOKEN_ALIASES:
        for keyword in keywords:
            if keyword in normalized or re.sub(r"[^a-z0-9]+", "", keyword) in compact:
                return token

    district_token = re.sub(r"[^a-z0-9]+", "", _ascii_words(district_name))
    if district_token.startswith("quan") or district_token in {"tanphu", "binhtan", "thuduc"}:
        return "hcm"
    return district_token or "hcm"


def _summarize_user_agent(user_agent: str | None) -> str:
    value = (user_agent or "").strip()
    if not value:
        return "Không ghi nhận"
    normalized = value.lower()
    os_name = "Thiết bị"
    if "windows" in normalized:
        os_name = "Windows"
    elif "mac os" in normalized or "macintosh" in normalized:
        os_name = "macOS"
    elif "android" in normalized:
        os_name = "Android"
    elif "iphone" in normalized or "ios" in normalized:
        os_name = "iOS"
    elif "linux" in normalized:
        os_name = "Linux"

    browser = "Trình duyệt"
    if "edg/" in normalized:
        browser = "Edge"
    elif "chrome/" in normalized and "chromium" not in normalized:
        browser = "Chrome"
    elif "safari/" in normalized and "chrome/" not in normalized:
        browser = "Safari"
    elif "firefox/" in normalized:
        browser = "Firefox"
    return f"{browser} - {os_name}"


def _login_detail(request_ip: str | None, user_agent: str | None) -> str:
    return " | ".join(
        [
            "Đăng nhập tài khoản bãi",
            f"IP: {(request_ip or '').strip() or 'Không ghi nhận'}",
            f"Thiết bị: {_summarize_user_agent(user_agent)}",
        ]
    )


def _extract_login_field(detail: str | None, field_name: str) -> str:
    match = re.search(rf"{re.escape(field_name)}:\s*([^|]+)", detail or "", re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _employee_email_candidates(login_token: str, parking_id: int):
    candidate_tokens = [login_token, f"{login_token}{parking_id}"]

    for index in range(2, 100):
        candidate_tokens.append(f"{login_token}{parking_id}{index}")

    for candidate in candidate_tokens:
        yield f"bx{candidate}@gmail.com"


def _available_employee_email(
    login_token: str,
    parking_id: int,
    db: Session,
    current_employee_id: int | None = None,
) -> str:
    for email in _employee_email_candidates(login_token, parking_id):
        duplicate = db.query(User.id).filter(User.email == email).first()
        if not duplicate or (current_employee_id and int(duplicate.id) == int(current_employee_id)):
            return email
    raise HTTPException(status_code=409, detail="Không thể tạo email employee tự động cho bãi này")


def _build_employee_credentials(parking_lot: ParkingLot, db: Session) -> tuple[str, str]:
    login_token = _parking_login_token(parking_lot.name)
    password = f"{login_token}@{_parking_location_token(parking_lot)}"
    return _available_employee_email(login_token, int(parking_lot.id), db), password


def _sync_owner_employee_assignments(owner: User, parking_lots: list[ParkingLot], db: Session) -> None:
    changed = False
    claimed_employee_ids: set[int] = set()

    for parking_lot in parking_lots:
        existing = (
            db.query(User)
            .filter(User.role == "employee", User.parking_id == parking_lot.id)
            .first()
        )
        if existing:
            token = _parking_login_token(parking_lot.name)
            desired_email = _available_employee_email(token, int(parking_lot.id), db, current_employee_id=int(existing.id))
            if _normalize_identity(existing.email or "") != desired_email:
                existing.email = desired_email
                existing.password = "__legacy_disabled__"
                existing.password_hash = generate_password_hash(f"{token}@{_parking_location_token(parking_lot)}")
                changed = True
            continue

        token = _parking_login_token(parking_lot.name)
        expected_email = f"bx{token}@gmail.com"
        employee = (
            db.query(User)
            .filter(User.role == "employee", func.lower(User.email) == expected_email)
            .first()
        )
        if not employee:
            compact_token = token.casefold()
            unassigned_rows = (
                db.query(User)
                .filter(User.role == "employee", User.parking_id.is_(None))
                .order_by(User.id.asc())
                .all()
            )
            for candidate in unassigned_rows:
                compact_text = re.sub(r"[^a-z0-9]+", "", _ascii_words(f"{candidate.email} {candidate.name}"))
                if compact_token and compact_token in compact_text:
                    employee = candidate
                    break

        if not employee or int(employee.id) in claimed_employee_ids:
            continue
        if employee.owner_id != owner.id or employee.parking_id != parking_lot.id:
            employee.owner_id = owner.id
            employee.parking_id = parking_lot.id
            changed = True
        claimed_employee_ids.add(int(employee.id))

    if changed:
        db.flush()


def _serialize_parking(parking_lot: ParkingLot, db: Session) -> dict:
    total_slots, occupied_slots, empty_slots = _compute_slot_metrics(parking_lot.id, db)
    return {
        "parking_id": parking_lot.id,
        "parking_name": parking_lot.name,
        "address": parking_lot.address,
        "totalSlots": total_slots,
        "occupiedSlots": occupied_slots,
        "emptySlots": empty_slots,
        "status": _resolve_status(parking_lot.id, db),
    }


def _log_activity(
    employee: User,
    parking_id: int,
    action: str,
    detail: str,
    db: Session,
    booking_id: int | None = None,
    amount: float = 0,
) -> None:
    db.add(
        EmployeeActivity(
            employee_id=employee.id,
            parking_id=parking_id,
            booking_id=booking_id,
            action=action,
            detail=detail,
            amount=amount,
        )
    )


def create_employee_for_owner(
    owner: User,
    full_name: str,
    email: str,
    phone: str | None,
    password: str,
    parking_id: int,
    db: Session,
    username: str | None = None,
    commit: bool = True,
) -> dict:
    owner_email = _normalize_identity(owner.email or "")
    owner_record = (
        db.query(User)
        .filter(
            User.id == owner.id,
            User.email == owner_email,
            User.role == "owner",
            User.is_active == 1,
        )
        .first()
    )
    if not owner_record:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner account is not authorized")

    if owner.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ owner mới tạo được employee")
    if _get_owner_assignment(owner.id, parking_id, db) is None:
        raise HTTPException(status_code=403, detail="Owner email is not allowed to manage this parking")

    parking_lot = db.query(ParkingLot).filter(ParkingLot.id == parking_id).first()
    if not parking_lot:
        raise HTTPException(status_code=404, detail="Không tìm thấy bãi để tạo tài khoản nhân viên")

    existing_employee = (
        db.query(User.id)
        .filter(
            User.parking_id == parking_id,
            User.role == "employee",
        )
        .first()
    )
    if existing_employee:
        raise HTTPException(status_code=409, detail="Mỗi bãi xe chỉ được tạo 01 tài khoản vận hành")

    normalized_email = _normalize_identity(email) if email else ""
    generated_password = password or ""
    if normalized_email:
        if "@" not in normalized_email:
            raise HTTPException(status_code=400, detail="Employee email is invalid")
        duplicate_user = db.query(User.id).filter(User.email == normalized_email).first()
        if duplicate_user:
            raise HTTPException(status_code=409, detail="Employee email already exists")
    else:
        normalized_email, generated_password = _build_employee_credentials(parking_lot, db)
    if not generated_password or len(generated_password) < EMPLOYEE_PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Employee password must be at least {EMPLOYEE_PASSWORD_MIN_LENGTH} characters",
        )

    normalized_full_name = (full_name or "").strip()
    normalized_phone = (phone or "").strip()
    if not normalized_full_name:
        raise HTTPException(status_code=400, detail="Employee full name is required")
    if not normalized_phone:
        raise HTTPException(status_code=400, detail="Employee phone is required")

    user = User(
        name=normalized_full_name,
        email=normalized_email,
        password="__legacy_disabled__",
        password_hash=generate_password_hash(generated_password),
        phone=normalized_phone,
        owner_id=owner.id,
        parking_id=parking_id,
        role="employee",
        status="active",
        is_active=1,
    )
    db.add(user)
    db.flush()

    _get_operational_state(parking_id, db)
    _log_activity(user, parking_id, "employee_created", f"Owner #{owner.id} created employee {normalized_email}", db)
    if commit:
        db.commit()
        db.refresh(user)
    return {
        **_serialize_employee(user),
        "user_id": user.id,
        "email": user.email,
        "full_name": user.name,
        "phone": user.phone,
        "default_password": generated_password,
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


def _is_preferred_slot_booking(candidate: Booking, current: Booking) -> bool:
    candidate_status = (candidate.status or "").lower()
    current_status = (current.status or "").lower()
    candidate_priority = BOOKING_STATUS_PRIORITY.get(candidate_status, 99)
    current_priority = BOOKING_STATUS_PRIORITY.get(current_status, 99)
    if candidate_priority != current_priority:
        return candidate_priority < current_priority

    candidate_time = candidate.actual_checkin or candidate.start_time or candidate.created_at
    current_time = current.actual_checkin or current.start_time or current.created_at
    if current_time is None:
        return True
    if candidate_time is None:
        return False
    return candidate_time > current_time


def get_owner_employees(owner: User, db: Session) -> dict:
    owner_parking_rows = (
        db.query(ParkingLot)
        .join(OwnerParking, OwnerParking.parking_id == ParkingLot.id)
        .filter(OwnerParking.owner_id == owner.id)
        .all()
    )
    _sync_owner_employee_assignments(owner, owner_parking_rows, db)
    db.commit()
    owner_parking_ids = [int(item.id) for item in owner_parking_rows]
    employees = (
        db.query(User)
        .filter(
            User.role == "employee",
            or_(
                User.owner_id == owner.id,
                User.parking_id.in_(owner_parking_ids) if owner_parking_ids else False,
            ),
        )
        .order_by(User.created_at.desc(), User.id.desc())
        .all()
    )
    if not employees:
        return {"employees": [], "total_count": 0}

    parking_ids = list({int(item.parking_id) for item in employees if item.parking_id})
    parking_rows = db.query(ParkingLot).filter(ParkingLot.id.in_(parking_ids)).all() if parking_ids else []
    parking_meta = {
        int(item.id): {
            "name": item.name,
            "district": item.district.name if item.district else "",
        }
        for item in parking_rows
    }
    employee_ids = [int(item.id) for item in employees]
    activity_rows = (
        db.query(
            EmployeeActivity.employee_id,
            func.count(EmployeeActivity.id),
            func.max(EmployeeActivity.created_at),
        )
        .filter(EmployeeActivity.employee_id.in_(employee_ids))
        .group_by(EmployeeActivity.employee_id)
        .all()
    )
    activity_stats = {
        int(employee_id): {
            "activity_count": int(activity_count or 0),
            "last_activity_at": last_activity_at,
        }
        for employee_id, activity_count, last_activity_at in activity_rows
    }
    latest_login_by_employee: dict[int, EmployeeActivity] = {}
    for log in (
        db.query(EmployeeActivity)
        .filter(EmployeeActivity.employee_id.in_(employee_ids), EmployeeActivity.action == "employee_login")
        .order_by(EmployeeActivity.created_at.desc(), EmployeeActivity.id.desc())
        .all()
    ):
        employee_id = int(log.employee_id)
        if employee_id not in latest_login_by_employee:
            latest_login_by_employee[employee_id] = log

    result = []
    for employee in employees:
        parking_id = int(employee.parking_id or 0)
        login_log = latest_login_by_employee.get(int(employee.id))
        login_detail = login_log.detail if login_log else ""
        result.append(
            {
                "id": employee.id,
                "user_id": employee.id,
                "username": employee.email,
                "email": employee.email,
                "full_name": employee.name,
                "phone": employee.phone,
                "role": employee.role,
                "owner_id": employee.owner_id or owner.id,
                "parking_id": employee.parking_id,
                "parking_name": parking_meta.get(parking_id, {}).get("name"),
                "parking_district": parking_meta.get(parking_id, {}).get("district"),
                "parking_code": f"BX{parking_id:03d}" if parking_id else "",
                "status": employee.status,
                "created_at": employee.created_at,
                "activity_count": activity_stats.get(int(employee.id), {}).get("activity_count", 0),
                "last_activity_at": activity_stats.get(int(employee.id), {}).get("last_activity_at"),
                "last_login_at": login_log.created_at if login_log else None,
                "login_ip": _extract_login_field(login_detail, "IP"),
                "login_device": _extract_login_field(login_detail, "Thiết bị"),
                "status_detail": "Hoạt động bình thường" if employee.status == "active" else "Cần kiểm tra trạng thái",
            }
        )
    return {"employees": result, "total_count": len(result)}


def update_owner_employee(
    owner: User,
    employee_id: int,
    db: Session,
    *,
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    password: str | None = None,
    parking_id: int | None = None,
    status: str | None = None,
) -> dict:
    employee = (
        db.query(User)
        .filter(User.id == employee_id, User.owner_id == owner.id, User.role == "employee")
        .first()
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    next_parking_id = int(parking_id) if parking_id else int(employee.parking_id)
    if _get_owner_assignment(owner.id, next_parking_id, db) is None:
        raise HTTPException(status_code=403, detail="Owner email is not allowed to manage this parking")

    if full_name is not None and not full_name.strip():
        raise HTTPException(status_code=400, detail="Employee full name is required")
    if phone is not None and not phone.strip():
        raise HTTPException(status_code=400, detail="Employee phone is required")

    next_email = _normalize_identity(email) if email else _normalize_identity(employee.email)
    if "@" not in next_email:
        raise HTTPException(status_code=400, detail="Employee email is invalid")

    duplicate_user = db.query(User).filter(User.email == next_email).first()
    if duplicate_user and duplicate_user.id != employee.id:
        raise HTTPException(status_code=409, detail="Employee email already exists")

    employee.email = next_email
    employee.parking_id = next_parking_id
    if full_name is not None:
        employee.name = full_name.strip()
    if phone is not None:
        employee.phone = phone.strip() or None

    if password:
        if len(password) < EMPLOYEE_PASSWORD_MIN_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Employee password must be at least {EMPLOYEE_PASSWORD_MIN_LENGTH} characters",
            )
        password_hash = generate_password_hash(password)
        employee.password = "__legacy_disabled__"
        employee.password_hash = password_hash
    if status is not None:
        normalized_status = status.strip().lower()
        if normalized_status not in {"active", "suspended", "inactive"}:
            raise HTTPException(status_code=400, detail="Employee status is invalid")
        employee.status = normalized_status
        employee.is_active = 0 if normalized_status == "inactive" else 1

    db.commit()
    db.refresh(employee)
    return {
        "id": employee.id,
        "user_id": employee.id,
        "username": employee.email,
        "email": employee.email,
        "full_name": employee.name,
        "phone": employee.phone,
        "role": employee.role,
        "owner_id": employee.owner_id,
        "parking_id": employee.parking_id,
        "parking_name": (
            db.query(ParkingLot.name).filter(ParkingLot.id == employee.parking_id).scalar()
        ),
        "status": employee.status,
        "created_at": employee.created_at,
        "activity_count": (
            db.query(func.count(EmployeeActivity.id))
            .filter(EmployeeActivity.employee_id == employee.id)
            .scalar()
            or 0
        ),
        "last_activity_at": (
            db.query(func.max(EmployeeActivity.created_at))
            .filter(EmployeeActivity.employee_id == employee.id)
            .scalar()
        ),
    }


def delete_owner_employee(owner: User, employee_id: int, db: Session) -> dict:
    employee = (
        db.query(User)
        .filter(User.id == employee_id, User.owner_id == owner.id, User.role == "employee")
        .first()
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    db.query(EmployeeActivity).filter(EmployeeActivity.employee_id == employee.id).delete(synchronize_session=False)
    db.delete(employee)

    db.commit()
    return {"message": "Deleted employee account permanently"}


def employee_login(
    username: str,
    password: str,
    db: Session,
    *,
    request_ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    normalized_username = username.strip().lower()
    employee = db.query(User).filter(User.email == normalized_username, User.role == "employee", User.is_active == 1).first()
    if not employee and "@" not in normalized_username:
        employee = (
            db.query(User)
            .filter(
                User.role == "employee",
                User.is_active == 1,
                or_(User.email == normalized_username, User.email.like(f"{normalized_username}@%")),
            )
            .first()
        )
    if not employee or employee.status != "active":
        raise HTTPException(status_code=401, detail="Sai username ho?c m?t kh?u")
    password_ok = False
    if employee.password_hash:
        password_ok = check_password_hash(employee.password_hash, password)
    elif employee.password:
        password_ok = employee.password == password
        if password_ok:
            employee.password_hash = generate_password_hash(password)
            employee.password = "__legacy_disabled__"
            db.commit()
    if not password_ok:
        raise HTTPException(status_code=401, detail="Sai username ho?c m?t kh?u")

    token, expires_at, _ = create_access_token_for_subject(
        subject=str(employee.id),
        role="employee",
        identity=employee.email,
    )
    _log_activity(
        employee,
        int(employee.parking_id),
        "employee_login",
        _login_detail(request_ip, user_agent),
        db,
    )
    db.commit()
    return {
        "message": "Ðang nh?p employee thành công",
        "token": token,
        "expires_in": int((expires_at - datetime.now(expires_at.tzinfo)).total_seconds()),
        "user": _serialize_employee(employee),
    }


def get_employee_profile(employee: User, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    return {
        "employee": _serialize_employee(employee),
        "parking_lot": _serialize_parking(parking_lot, db),
    }


def get_employee_dashboard(employee: User, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    return _serialize_parking(parking_lot, db)


def get_employee_vehicles(employee: User, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    rows = db.execute(
        text(
            """
            SELECT
                b.id AS booking_id,
                u.vehicle_plate AS license_plate,
                u.full_name AS owner_name,
                u.phone AS owner_phone,
                COALESCE(b.actual_checkin, b.checkin_time) AS check_in_time,
                b.status AS status,
                COALESCE(ps.slot_number, ps.code) AS slot_code,
                b.booking_mode AS booking_mode
            FROM bookings b
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN parking_slots ps ON ps.id = b.slot_id
            WHERE b.parking_id = :parking_id
              AND b.status IN ('pending', 'booked', 'checked_in', 'in_progress')
            ORDER BY
              CASE b.status
                WHEN 'checked_in' THEN 1
                WHEN 'in_progress' THEN 2
                WHEN 'booked' THEN 3
                WHEN 'pending' THEN 4
                ELSE 5
              END,
              COALESCE(b.actual_checkin, b.checkin_time) DESC,
              b.id DESC
            """
        ),
        {"parking_id": parking_lot.id},
    ).mappings().all()
    vehicles = [
        {
            "booking_id": row["booking_id"],
            "license_plate": row["license_plate"],
            "owner_name": row["owner_name"],
            "owner_phone": row["owner_phone"],
            "check_in_time": row["check_in_time"],
            "status": row["status"],
            "slot_code": row["slot_code"],
            "booking_mode": row["booking_mode"],
        }
        for row in rows
    ]
    return {"vehicles": vehicles, "total_count": len(vehicles)}


def get_employee_slots_overview(employee: User, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    slots = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.parking_id == parking_lot.id)
        .order_by(ParkingSlot.level.asc(), ParkingSlot.zone.asc(), ParkingSlot.slot_number.asc(), ParkingSlot.code.asc())
        .all()
    )
    active_bookings = db.query(Booking).filter(
        Booking.parking_id == parking_lot.id,
        Booking.status.in_(["pending", "booked", "checked_in"]),
    ).all()

    booking_statuses_by_slot: dict[int, set[str]] = {}
    latest_booking_by_slot: dict[int, Booking] = {}
    for booking in active_bookings:
        if not booking.slot_id:
            continue
        slot_id = int(booking.slot_id)
        booking_statuses_by_slot.setdefault(slot_id, set()).add((booking.status or "").lower())
        if slot_id not in latest_booking_by_slot or _is_preferred_slot_booking(booking, latest_booking_by_slot[slot_id]):
            latest_booking_by_slot[slot_id] = booking

    slot_rows = []
    for slot in slots:
        status = _overview_slot_status(slot.status, booking_statuses_by_slot.get(int(slot.id), set()))
        active_booking = latest_booking_by_slot.get(int(slot.id))
        slot_rows.append(
            {
                "id": int(slot.id),
                "code": _display_slot_code(slot),
                "booking_id": int(active_booking.id) if active_booking else None,
                "booking_status": (active_booking.status if active_booking else None),
                "zone": slot.zone or "Chua phân khu",
                "level": slot.level or "Chưa gán tầng",
                "status": status,
                "owner_name": active_booking.user.name if active_booking and active_booking.user else None,
                "owner_phone": active_booking.user.phone if active_booking and active_booking.user else None,
                "vehicle_plate": active_booking.user.vehicle_plate if active_booking and active_booking.user else None,
                "booking_mode": active_booking.booking_mode if active_booking else None,
                "check_in_time": (active_booking.actual_checkin or active_booking.start_time) if active_booking else None,
                "check_out_time": (active_booking.actual_checkout or active_booking.expire_time) if active_booking else None,
                "booking_code": f"BK-{active_booking.id}" if active_booking else None,
            }
        )

    available_slots = [item for item in slot_rows if item["status"] == "available"]
    maintenance_slots = [item for item in slot_rows if item["status"] == "maintenance"]
    occupied_slots = [item for item in slot_rows if item["status"] == "occupied"]

    return {
        "parking_id": int(parking_lot.id),
        "parking_name": parking_lot.name,
        "total_slots": len(slot_rows),
        "available_slots": len(available_slots),
        "reserved_slots": 0,
        "in_use_slots": len(occupied_slots),
        "maintenance_slots": len(maintenance_slots),
        "occupied_or_reserved_slots": len(slot_rows) - len(available_slots),
        "slots": slot_rows,
    }


def get_employee_revenue(employee: User, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    today = datetime.now(APP_TIMEZONE).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    month_start = today.replace(day=1)
    week_start = today - timedelta(days=6)
    revenue_today = 0.0
    revenue_month = 0.0
    total_paid_bookings = 0

    revenue_by_day = {}
    for day_offset in range(7):
        current_day = week_start + timedelta(days=day_offset)
        revenue_by_day[current_day.date()] = {
            "label": current_day.strftime("%d/%m"),
            "amount": 0.0,
        }

    rows = db.execute(
        text(
            """
            SELECT
                COALESCE(p.paid_at, p.created_at) AS paid_time,
                COALESCE(p.amount, 0) + COALESCE(p.overtime_fee, 0) AS total_amount
            FROM payments p
            INNER JOIN bookings b ON b.id = p.booking_id
            WHERE b.parking_id = :parking_id
              AND p.payment_status = 'paid'
            """
        ),
        {"parking_id": parking_lot.id},
    ).mappings().all()

    for row in rows:
        paid_at = row["paid_time"]
        amount = float(row["total_amount"] or 0)

        if paid_at:
            paid_date = paid_at.date()
            if paid_date in revenue_by_day:
                revenue_by_day[paid_date]["amount"] += amount

            if paid_at >= month_start:
                revenue_month += amount
                if paid_at >= today:
                    revenue_today += amount

        total_paid_bookings += 1

    activity_rows = db.execute(
        text(
            """
            SELECT action, created_at
            FROM employee_activities
            WHERE parking_id = :parking_id
              AND action IN ('check_in', 'check_out')
              AND created_at >= :today_start
              AND created_at < :tomorrow_start
            ORDER BY created_at ASC
            """
        ),
        {
            "parking_id": parking_lot.id,
            "today_start": today,
            "tomorrow_start": today + timedelta(days=1),
        },
    ).mappings().all()

    traffic_by_hour = {}
    for hour in range(6, 23, 2):
        traffic_by_hour[hour] = {
            "label": f"{hour:02d}:00",
            "check_ins": 0,
            "check_outs": 0,
        }

    for row in activity_rows:
        created_at = row["created_at"]
        if not created_at:
            continue
        base_hour = int(created_at.hour // 2) * 2
        base_hour = min(22, max(6, base_hour))
        bucket = traffic_by_hour.get(base_hour)
        if not bucket:
            continue
        if row["action"] == "check_in":
            bucket["check_ins"] += 1
        elif row["action"] == "check_out":
            bucket["check_outs"] += 1

    total_slots, occupied_slots, _ = _compute_slot_metrics(parking_lot.id, db)
    occupancy_ratio = round((occupied_slots / total_slots) * 100, 2) if total_slots > 0 else 0

    return {
        "revenueToday": round(revenue_today, 2),
        "revenueMonth": round(revenue_month, 2),
        "revenueByDay": [
            {"label": item["label"], "amount": round(item["amount"], 2)}
            for item in revenue_by_day.values()
        ],
        "trafficByHour": list(traffic_by_hour.values()),
        "occupancyRatio": occupancy_ratio,
        "totalPaidBookings": int(total_paid_bookings),
    }


def update_employee_parking_status(employee: User, status_value: str, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    if int(parking_lot.is_active or 0) != 1:
        raise HTTPException(status_code=409, detail="Bãi đang bị admin khóa, không thể đổi trạng thái vận hành")
    state = _get_operational_state(employee.parking_id, db)
    state.status = status_value
    state.updated_at = datetime.utcnow()
    _log_activity(employee, employee.parking_id, "parking_status_updated", f"C?p nh?t tr?ng thái bãi sang {status_value}", db)
    db.commit()
    return get_employee_dashboard(employee, db)


def employee_check_in(employee: User, qr_data: str, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    _assert_employee_can_check_in(parking_lot.id, db)
    parsed = _parse_scan_payload(qr_data, "qr_scan")
    booking = db.query(Booking).filter(Booking.id == parsed["booking_id"]).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm th?y booking")
    if int(booking.parking_id or 0) != int(parking_lot.id):
        raise HTTPException(status_code=403, detail="Booking không thu?c bãi du?c phân công")
    payment = _get_payment(booking.id, db, lock=True)
    detail = _execute_check_in(
        booking=booking,
        payment=payment,
        gate_id=f"EMP-{employee.email}",
        source_type="qr_scan",
        actor=employee,
        db=db,
    )
    _log_activity(
        employee,
        parking_lot.id,
        "check_in",
        f"Check-in booking BK-{booking.id}",
        db,
        booking_id=booking.id,
    )
    db.commit()
    return {
        "message": "Employee check-in thành công",
        "booking": detail,
        "payment_preview": detail.get("pricing_preview"),
    }


def employee_get_gate_booking(employee: User, booking_id: int, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm th?y booking")
    if int(booking.parking_id or 0) != int(parking_lot.id):
        raise HTTPException(status_code=403, detail="Employee không có quyền thao tác tại bãi này")
    payment = _get_payment(booking.id, db, lock=False)
    _log_activity(
        employee,
        parking_lot.id,
        "resolve_booking",
        f"Xem thông tin booking BK-{booking.id}",
        db,
        booking_id=booking.id,
    )
    db.commit()
    return _serialize_booking_detail(booking, payment, db, _local_now())


def employee_check_out(employee: User, qr_data: str, payment_method: str, db: Session) -> dict:
    parking_lot = _get_employee_parking(employee, db)
    parsed = _parse_scan_payload(qr_data, "qr_scan")
    booking = db.query(Booking).filter(Booking.id == parsed["booking_id"]).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Không tìm th?y booking")
    if int(booking.parking_id or 0) != int(parking_lot.id):
        raise HTTPException(status_code=403, detail="Booking không thu?c bãi du?c phân công")

    # Fallback for legacy/edge data where a vehicle is physically occupying a slot but booking was not transitioned to checked_in.
    now = _local_now()
    normalized_status = (booking.status or "").lower()
    is_overdue = bool(booking.expire_time and booking.expire_time <= now)
    if normalized_status in {"pending", "booked"} and is_overdue:
        booking.status = "checked_in"
        if booking.actual_checkin is None:
            booking.actual_checkin = booking.start_time or now
        if booking.slot:
            booking.slot.status = "occupied"

    payment = _get_payment(booking.id, db, lock=True)
    detail = _execute_check_out(
        booking=booking,
        payment=payment,
        gate_id=f"EMP-{employee.email}",
        source_type="qr_scan",
        payment_method=payment_method,
        actor=employee,
        db=db,
    )
    pricing_preview = detail.get("pricing_preview") or {}
    # Prefer the actual checkout charge; fallback to remaining due for legacy cases.
    amount = float(
        pricing_preview.get("total_charge")
        or pricing_preview.get("remaining_due")
        or detail.get("total_actual_fee")
        or detail.get("total_amount")
        or 0
    )
    _log_activity(
        employee,
        parking_lot.id,
        "check_out",
        f"Check-out booking BK-{booking.id}",
        db,
        booking_id=booking.id,
        amount=amount,
    )
    db.commit()
    return {
        "message": "Employee check-out thành công",
        "booking": detail,
        "payment_preview": detail.get("pricing_preview"),
    }


def get_employee_history(
    employee: User,
    db: Session,
    *,
    limit: int = 200,
    action: str | None = None,
) -> dict:
    safe_limit = max(1, min(int(limit or 200), 500))
    query = db.query(EmployeeActivity).filter(EmployeeActivity.employee_id == employee.id)
    if action:
        query = query.filter(EmployeeActivity.action == action.strip())
    rows = (
        query
        .order_by(EmployeeActivity.created_at.desc(), EmployeeActivity.id.desc())
        .limit(safe_limit)
        .all()
    )
    # Backfill amount for legacy check-out logs where amount was saved as 0.
    checkout_booking_ids: set[int] = set()
    checkout_amount_by_booking_id: dict[int, float] = {}
    for row in rows:
        if row.action != "check_out" or float(row.amount or 0) > 0:
            continue
        detail_text = str(row.detail or "")
        match = re.search(r"BK-(\d+)", detail_text, re.IGNORECASE)
        if match:
            checkout_booking_ids.add(int(match.group(1)))

    if checkout_booking_ids:
        booking_rows = (
            db.query(Booking.id, Booking.total_actual_fee, Booking.total_amount)
            .filter(Booking.id.in_(checkout_booking_ids))
            .all()
        )
        checkout_amount_by_booking_id = {
            int(booking_id): float(total_actual_fee or total_amount or 0)
            for booking_id, total_actual_fee, total_amount in booking_rows
        }

    history = [
        {
            "id": row.id,
            "action": row.action,
            "detail": row.detail,
            "amount": (
                float(row.amount or 0)
                if not (
                    row.action == "check_out"
                    and float(row.amount or 0) <= 0
                    and re.search(r"BK-(\d+)", str(row.detail or ""), re.IGNORECASE)
                )
                else checkout_amount_by_booking_id.get(
                    int(re.search(r"BK-(\d+)", str(row.detail or ""), re.IGNORECASE).group(1)),
                    float(row.amount or 0),
                )
            ),
            "created_at": row.created_at,
        }
        for row in rows
    ]
    return {"history": history, "total_count": len(history)}
