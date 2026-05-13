from datetime import datetime
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.controllers.employee_controller import (
    create_owner_employee_controller,
    delete_owner_employee_controller,
    employee_check_in_controller,
    employee_check_out_controller,
    employee_dashboard_controller,
    employee_gate_booking_controller,
    employee_history_controller,
    employee_login_controller,
    employee_parking_status_controller,
    employee_profile_controller,
    employee_revenue_controller,
    employee_slots_overview_controller,
    employee_vehicles_controller,
    owner_employees_controller,
    update_owner_employee_controller,
)
from app.database import get_db
from app.models.models import Booking, ParkingPrice, ParkingSlot, RevokedToken, User
from app.routes.auth import decode_access_token, get_current_user
from app.security.password_policy import ensure_strong_password
from app.schemas.employee import (
    EmployeeChangePasswordRequest,
    EmployeeChangePasswordResponse,
    EmployeeHistoryResponse,
    EmployeeInfo,
    EmployeeLoginRequest,
    EmployeeLoginResponse,
    EmployeeParkingOverview,
    EmployeeParkingStatusRequest,
    EmployeeProfileResponse,
    EmployeeQrActionRequest,
    EmployeeQrActionResponse,
    EmployeeRevenueResponse,
    EmployeeSlotsOverviewResponse,
    EmployeeVehicleResponse,
    OwnerCreateEmployeeRequest,
    OwnerEmployeeActionResponse,
    OwnerEmployeeListResponse,
    OwnerUpdateEmployeeRequest,
)

router = APIRouter(prefix="/api/employee", tags=["employee"])
owner_employee_router = APIRouter(prefix="/api/owner", tags=["owner-employee"])
security = HTTPBearer(auto_error=False)
class EmployeeAssistBookingRequest(BaseModel):
    user_id: int = Field(gt=0)
    slot_id: int = Field(gt=0)
    start_time: datetime
    expire_time: datetime
    booking_mode: str = Field(default="hourly", pattern="^(hourly|daily|monthly)$")


class EmployeeAssistBookingResponse(BaseModel):
    message: str
    booking_id: int
    total_amount: float


def _serialize_employee_info(payload: dict) -> EmployeeInfo:
    return EmployeeInfo(**payload)


def _serialize_parking_info(payload: dict) -> EmployeeParkingOverview:
    return EmployeeParkingOverview(**payload)


def get_current_employee(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")

    payload = decode_access_token(credentials.credentials)
    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if db.query(RevokedToken).filter(RevokedToken.jti == jti).first():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")

    subject = payload.get("sub")
    try:
        employee_id = int(subject)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    employee = db.query(User).filter(User.id == employee_id, User.role == "employee", User.is_active == 1).first()
    if not employee or employee.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Employee not found or inactive")
    return employee


def require_owner(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required")
    return current_user


@owner_employee_router.post("/create-employee")
def create_employee(
    payload: OwnerCreateEmployeeRequest,
    owner: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    employee = create_owner_employee_controller(
        owner=owner,
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        parking_id=payload.parking_id,
        db=db,
        username=payload.username,
    )
    return {"message": "Create employee success", "employee": employee}


@owner_employee_router.get("/employees", response_model=OwnerEmployeeListResponse)
def owner_employees(
    owner: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    return OwnerEmployeeListResponse(**owner_employees_controller(owner, db))


@owner_employee_router.patch("/employees/{employee_id}", response_model=OwnerEmployeeActionResponse)
def update_owner_employee(
    employee_id: int,
    payload: OwnerUpdateEmployeeRequest,
    owner: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    employee = update_owner_employee_controller(
        owner=owner,
        employee_id=employee_id,
        db=db,
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        parking_id=payload.parking_id,
    )
    return OwnerEmployeeActionResponse(message="Updated employee account", employee=employee)


@owner_employee_router.delete("/employees/{employee_id}", response_model=OwnerEmployeeActionResponse)
def delete_owner_employee(
    employee_id: int,
    owner: User = Depends(require_owner),
    db: Session = Depends(get_db),
):
    result = delete_owner_employee_controller(owner=owner, employee_id=employee_id, db=db)
    return OwnerEmployeeActionResponse(message=result["message"], employee=None)


@router.post("/login", response_model=EmployeeLoginResponse)
def employee_login(payload: EmployeeLoginRequest, db: Session = Depends(get_db)):
    result = employee_login_controller(payload.username, payload.password, db)
    return EmployeeLoginResponse(
        message=result["message"],
        token=result["token"],
        expires_in=result["expires_in"],
        user=_serialize_employee_info(result["user"]),
    )


@router.get("/me", response_model=EmployeeInfo)
def employee_me(current_employee: User = Depends(get_current_employee)):
    return _serialize_employee_info(
        {
            "id": current_employee.id,
            "username": current_employee.email,
            "role": current_employee.role,
            "owner_id": current_employee.owner_id,
            "parking_id": current_employee.parking_id,
            "status": current_employee.status,
            "created_at": current_employee.created_at,
        }
    )


@router.post("/change-password", response_model=EmployeeChangePasswordResponse)
def employee_change_password(
    payload: EmployeeChangePasswordRequest,
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Xác nhận mật khẩu không khớp")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mat khau moi phai khac mat khau cu")

    employee = (
        db.query(User)
        .filter(User.id == current_employee.id, User.is_active == 1)
        .with_for_update()
        .first()
    )
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tài khoản nhân viên không tồn tại")
    if not employee.password_hash or not check_password_hash(employee.password_hash, payload.old_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mật khẩu cũ không đúng")

    ensure_strong_password(payload.new_password)
    new_hash = generate_password_hash(payload.new_password)
    employee.password_hash = new_hash

    employee.password = "__legacy_disabled__"

    db.commit()
    return EmployeeChangePasswordResponse(message="Doi mat khau thanh cong")


@router.get("/parking-lot", response_model=EmployeeParkingOverview)
def employee_dashboard(
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return _serialize_parking_info(employee_dashboard_controller(current_employee, db))


@router.get("/vehicles", response_model=EmployeeVehicleResponse)
def employee_vehicles(
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return EmployeeVehicleResponse(**employee_vehicles_controller(current_employee, db))


@router.get("/revenue", response_model=EmployeeRevenueResponse)
def employee_revenue(
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return EmployeeRevenueResponse(**employee_revenue_controller(current_employee, db))


@router.get("/slots-overview", response_model=EmployeeSlotsOverviewResponse)
def employee_slots_overview(
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return EmployeeSlotsOverviewResponse(**employee_slots_overview_controller(current_employee, db))


@router.put("/parking-status", response_model=EmployeeParkingOverview)
def employee_parking_status(
    payload: EmployeeParkingStatusRequest,
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return _serialize_parking_info(employee_parking_status_controller(current_employee, payload.status, db))


@router.get("/profile", response_model=EmployeeProfileResponse)
def employee_profile(
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    profile = employee_profile_controller(current_employee, db)
    return EmployeeProfileResponse(
        employee=_serialize_employee_info(profile["employee"]),
        parking_lot=_serialize_parking_info(profile["parking_lot"]),
    )


@router.get("/history", response_model=EmployeeHistoryResponse)
def employee_history(
    limit: int = Query(default=200, ge=1, le=500),
    action: str | None = Query(default=None),
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return EmployeeHistoryResponse(**employee_history_controller(current_employee, db, limit=limit, action=action))


@router.post("/check-in", response_model=EmployeeQrActionResponse)
def employee_check_in(
    payload: EmployeeQrActionRequest,
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return EmployeeQrActionResponse(**employee_check_in_controller(current_employee, payload.qr_data, db))


@router.post("/check-out", response_model=EmployeeQrActionResponse)
def employee_check_out(
    payload: EmployeeQrActionRequest,
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return EmployeeQrActionResponse(**employee_check_out_controller(current_employee, payload.qr_data, payload.payment_method, db))


@router.get("/bookings/{booking_id}")
def employee_gate_booking(
    booking_id: int,
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    return employee_gate_booking_controller(current_employee, booking_id, db)



@router.get("/customers-list")
def employee_customers_list(
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    if not current_employee.parking_id:
        raise HTTPException(status_code=400, detail="Nhân viên chưa được gán bãi")

    rows = (
        db.query(User)
        .filter(User.role == "user", User.is_active == 1)
        .order_by(User.name.asc())
        .limit(500)
        .all()
    )
    return [
        {
            "id": int(user.id),
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "vehicle_plate": user.vehicle_plate,
        }
        for user in rows
    ]


@router.post("/booking-assist", response_model=EmployeeAssistBookingResponse)
def employee_booking_assist(
    payload: EmployeeAssistBookingRequest,
    current_employee: User = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    if not current_employee.parking_id:
        raise HTTPException(status_code=400, detail="Nhân viên chưa được gán bãi")

    parking_id = int(current_employee.parking_id)
    start_time = payload.start_time
    expire_time = payload.expire_time
    if expire_time <= start_time:
        raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu")

    customer = (
        db.query(User)
        .filter(User.id == payload.user_id, User.role == "user", User.is_active == 1)
        .with_for_update()
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Không tìm thấy khách hàng")

    slot = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.id == payload.slot_id, ParkingSlot.parking_id == parking_id)
        .with_for_update()
        .first()
    )
    if not slot:
        raise HTTPException(status_code=404, detail="Không tìm thấy chỗ đỗ trong bãi được phân công")
    if slot.status != "available":
        raise HTTPException(status_code=400, detail="Chỗ đỗ không còn trống")

    overlapping_slot = (
        db.query(Booking.id)
        .filter(
            Booking.slot_id == slot.id,
            Booking.status.in_(["pending", "booked", "checked_in"]),
            Booking.start_time < expire_time,
            Booking.expire_time > start_time,
        )
        .first()
    )
    if overlapping_slot:
        raise HTTPException(status_code=400, detail="Chỗ đỗ đã có booking trong khung giờ này")

    overlapping_customer = (
        db.query(Booking.id)
        .filter(
            Booking.user_id == customer.id,
            Booking.status.in_(["pending", "booked", "checked_in"]),
            Booking.start_time < expire_time,
            Booking.expire_time > start_time,
        )
        .first()
    )
    if overlapping_customer:
        raise HTTPException(status_code=400, detail="Khách hàng đã có booking trùng thời gian")

    parking_price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == parking_id).first()
    if not parking_price:
        raise HTTPException(status_code=400, detail="Bãi chưa cấu hình bảng giá")

    duration_hours = max((expire_time - start_time).total_seconds() / 3600, 0)
    if payload.booking_mode == "monthly":
        billed_units = max(ceil(duration_hours / (24 * 30)), 1)
        total_amount = float(parking_price.price_per_month or 0) * billed_units
    elif payload.booking_mode == "daily":
        billed_units = max(ceil(duration_hours / 24), 1)
        total_amount = float(parking_price.price_per_day or 0) * billed_units
    else:
        billed_units = max(round(duration_hours, 2), 1)
        total_amount = float(parking_price.price_per_hour or 0) * billed_units

    booking = Booking(
        user_id=customer.id,
        slot_id=slot.id,
        parking_id=parking_id,
        start_time=start_time,
        expire_time=expire_time,
        booking_mode=payload.booking_mode,
        billed_units=billed_units,
        total_amount=round(total_amount, 2),
        status="pending",
        qr_code="",
    )
    db.add(booking)
    slot.status = "reserved"
    db.commit()
    db.refresh(booking)

    return EmployeeAssistBookingResponse(
        message="Đã tạo đặt chỗ giúp khách hàng thành công",
        booking_id=int(booking.id),
        total_amount=float(booking.total_amount or 0),
    )

