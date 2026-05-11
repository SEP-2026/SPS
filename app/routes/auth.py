import os
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_
from jwt import ExpiredSignatureError, InvalidTokenError
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.database import get_db
from app.models.models import District, RevokedToken, User, Wallet
from app.schemas.auth import (
    ChangePasswordRequest,
    ChangePasswordResponse,
    ForgotPasswordRequest,
    ForgotPasswordRequestResponse,
    ForgotPasswordResetRequest,
    ForgotPasswordResetResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    RegisterRequest,
    RegisterResponse,
    UpdateProfileRequest,
    UpdateProfileResponse,
    UserInfo,
)
from app.security.password_policy import ensure_strong_password

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "3"))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "10"))

_PASSWORD_RESET_STORE: dict[str, dict[str, Any]] = {}
_PASSWORD_RESET_STORE_LOCK = Lock()


def _build_user_info(user: User) -> UserInfo:
    normalized_role = (user.role or "").strip().lower()
    return UserInfo(
        id=user.id,
        email=user.email,
        username=user.email if normalized_role == "employee" else None,
        role=user.role,
        owner_id=user.owner_id if normalized_role == "employee" else None,
        parking_id=user.parking_id if normalized_role == "employee" else None,
        status=user.status,
        name=user.name,
        phone=user.phone,
        vehicle_plate=user.vehicle_plate,
        vehicle_color=user.vehicle_color,
        managed_district_id=user.managed_district_id,
        managed_district=user.managed_district.name if user.managed_district else None,
    )


def create_access_token_for_subject(subject: str, role: str, identity: str) -> tuple[str, datetime, str]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    jti = str(uuid4())
    payload = {
        "sub": subject,
        "email": identity,
        "role": role,
        "jti": jti,
        "iat": now,
        "exp": expires_at,
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token, expires_at, jti


def _create_access_token(user: User) -> tuple[str, datetime, str]:
    return create_access_token_for_subject(str(user.id), user.role, user.email)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token da het han") from exc
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token khong hop le") from exc


def _is_token_revoked(db: Session, jti: str) -> bool:
    return db.query(RevokedToken).filter(RevokedToken.jti == jti).first() is not None


def _normalize_identity(identity: str) -> str:
    return (identity or "").strip().lower()


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in (phone or "") if ch.isdigit())


def _cleanup_expired_password_reset_tokens() -> None:
    now = datetime.now(timezone.utc)
    with _PASSWORD_RESET_STORE_LOCK:
        expired = [token for token, data in _PASSWORD_RESET_STORE.items() if data["expires_at"] <= now]
        for token in expired:
            _PASSWORD_RESET_STORE.pop(token, None)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Thieu access token")

    payload = decode_access_token(credentials.credentials)
    jti = payload.get("jti")
    if not jti or _is_token_revoked(db, jti):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token da bi thu hoi")

    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token khong hop le")

    try:
        user_id = int(subject)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token khong hop le") from exc

    user = db.query(User).filter(User.id == user_id, User.is_active == 1).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tài khoản không tồn tại hoac da bi khoa")
    if user.status and user.status.lower() == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tai khoan da bi vo hieu hoa")
    return user


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    identity = payload.email.strip().lower()
    auth_error = "Sai email/username hoac mat khau"

    user = db.query(User).filter(User.email == identity).first()
    if not user and "@" not in identity:
        user = (
            db.query(User)
            .filter(
                User.role == "employee",
                User.is_active == 1,
                or_(User.email == identity, User.email.like(f"{identity}@%")),
            )
            .first()
        )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=auth_error)

    password_ok = False
    if user.password_hash:
        password_ok = check_password_hash(user.password_hash, payload.password)
    elif user.password:
        password_ok = user.password == payload.password
    if not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=auth_error)

    if not user.password_hash:
        user.password_hash = generate_password_hash(payload.password)
        db.commit()

    if user.is_active != 1 or (user.status and user.status.lower() == "banned"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tai khoan da bi vo hieu hoa")

    token, expires_at, _ = _create_access_token(user)
    role = (user.role or "").strip().lower()
    message = "Dang nhap employee thanh cong" if role == "employee" else "Dang nhap thanh cong"
    return LoginResponse(
        message=message,
        token=token,
        expires_in=int((expires_at - datetime.now(timezone.utc)).total_seconds()),
        user=_build_user_info(user),
    )


@router.post("/register", response_model=RegisterResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    ensure_strong_password(payload.password)
    normalized_email = payload.email.lower().strip()
    existing_user = db.query(User).filter(User.email == normalized_email).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email da duoc su dung")

    user = User(
        name=payload.name.strip(),
        email=normalized_email,
        password="__legacy_disabled__",
        password_hash=generate_password_hash(payload.password),
        phone=payload.phone.strip() if payload.phone else None,
        vehicle_plate=payload.vehicle_plate.strip() if payload.vehicle_plate else None,
        vehicle_color=payload.vehicle_color.strip() if payload.vehicle_color else None,
        role="user",
        status="active",
        is_active=1,
    )
    db.add(user)
    db.flush()
    db.add(Wallet(user_id=user.id, balance=0, reserved_balance=0))
    db.commit()
    db.refresh(user)
    return RegisterResponse(message="Tao tai khoan user thanh cong", user=_build_user_info(user))


@router.post("/logout", response_model=LogoutResponse)
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Thieu access token")

    payload = decode_access_token(credentials.credentials)
    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti or not exp:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token khong hop le")

    if not _is_token_revoked(db, jti):
        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
        db.add(RevokedToken(jti=jti, expires_at=expires_at))
        db.commit()
    return LogoutResponse(message="Dang xuat thanh cong")


def _resolve_password_reset_subject(identity: str, phone: str, db: Session) -> dict[str, Any]:
    normalized_identity = _normalize_identity(identity)
    normalized_phone = _normalize_phone(phone)

    user = db.query(User).filter(User.email == normalized_identity, User.is_active == 1).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay tai khoan")
    if user.status and user.status.lower() == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tai khoan da bi vo hieu hoa")

    user_phone = _normalize_phone(user.phone or "")
    if not user_phone or user_phone != normalized_phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thong tin xac minh khong hop le")
    return {"kind": "user", "id": int(user.id)}


@router.post("/forgot-password/request", response_model=ForgotPasswordRequestResponse)
def forgot_password_request(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    subject = _resolve_password_reset_subject(payload.identity, payload.phone, db)
    _cleanup_expired_password_reset_tokens()

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
    reset_token = str(uuid4())
    with _PASSWORD_RESET_STORE_LOCK:
        _PASSWORD_RESET_STORE[reset_token] = {
            "kind": subject["kind"],
            "subject_id": subject["id"],
            "expires_at": expires_at,
        }

    expires_in = int((expires_at - now).total_seconds())
    return ForgotPasswordRequestResponse(
        message="Da tao yeu cau dat lai mat khau",
        reset_token=reset_token,
        expires_in=expires_in,
    )


@router.post("/forgot-password/reset", response_model=ForgotPasswordResetResponse)
def forgot_password_reset(payload: ForgotPasswordResetRequest, db: Session = Depends(get_db)):
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mat khau xac nhan khong khop")

    _cleanup_expired_password_reset_tokens()
    with _PASSWORD_RESET_STORE_LOCK:
        record = _PASSWORD_RESET_STORE.get(payload.reset_token)

    if not record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token khong hop le hoac da het han")

    new_hash = generate_password_hash(payload.new_password)
    user = db.query(User).filter(User.id == int(record["subject_id"]), User.is_active == 1).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tài khoản không tồn tại")

    user.password_hash = new_hash
    user.password = "__legacy_disabled__"

    db.commit()
    with _PASSWORD_RESET_STORE_LOCK:
        _PASSWORD_RESET_STORE.pop(payload.reset_token, None)
    return ForgotPasswordResetResponse(message="Dat lai mat khau thanh cong")


@router.get("/me", response_model=UserInfo)
def me(current_user: User = Depends(get_current_user)):
    return _build_user_info(current_user)


@router.put("/me", response_model=UpdateProfileResponse)
def update_me(
    payload: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == current_user.id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Người dùng không tồn tại")

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ten khong duoc de trong")
        user.name = name
    if payload.phone is not None:
        user.phone = payload.phone.strip() or None
    if payload.managed_district_id is not None:
        if user.role not in {"owner", "admin"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chi owner hoac admin moi duoc cap nhat quan quan ly")
        district = db.query(District).filter(District.id == payload.managed_district_id).first()
        if not district:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quan khong ton tai")
        user.managed_district_id = district.id
    if payload.email is not None:
        normalized_email = payload.email.lower().strip()
        if normalized_email != user.email:
            existing_user = db.query(User).filter(User.email == normalized_email, User.id != user.id).first()
            if existing_user:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email da duoc su dung")
            user.email = normalized_email

    db.commit()
    db.refresh(user)
    return UpdateProfileResponse(message="Cap nhat ho so thanh cong", user=_build_user_info(user))


@router.post("/change-password", response_model=ChangePasswordResponse)
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == current_user.id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Người dùng không tồn tại")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mat khau moi phai khac mat khau cu")

    ensure_strong_password(payload.new_password)
    password_ok = False
    if user.password_hash:
        password_ok = check_password_hash(user.password_hash, payload.old_password)
    elif user.password:
        password_ok = user.password == payload.old_password
    if not password_ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mat khau cu khong dung")

    user.password_hash = generate_password_hash(payload.new_password)
    user.password = "__legacy_disabled__"
    db.commit()
    return ChangePasswordResponse(message="Doi mat khau thanh cong")
