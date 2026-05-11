from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.controllers.employee_controller import (
    create_employee_controller,
    employee_check_in_controller,
    employee_check_out_controller,
    employee_gate_booking_controller,
    employee_history_controller,
    employee_login_controller,
    employee_parking_lot_controller,
    employee_revenue_controller,
    employee_update_status_controller,
    employee_vehicles_controller,
)
from app.database import get_db
from app.models.models import User
from app.routes.auth import authorize, get_current_user
from app.schemas.employee import (
    EmployeeCheckInOutResponse,
    EmployeeCheckInRequest,
    EmployeeCheckOutRequest,
    EmployeeHistoryResponse,
    EmployeeLoginRequest,
    EmployeeLoginResponse,
    EmployeeParkingLotResponse,
    EmployeeProfileResponse,
    EmployeePublicInfo,
    EmployeeRevenueResponse,
    EmployeeUpdateStatusRequest,
    EmployeeVehiclesResponse,
    OwnerCreateEmployeeRequest,
    OwnerCreateEmployeeResponse,
)

router = APIRouter(prefix="/api/employee", tags=["employee"])
owner_router = APIRouter(prefix="/api/owner", tags=["owner-employee"])


def _serialize_employee(user: User) -> EmployeePublicInfo:
    return EmployeePublicInfo(
        id=user.id,
        username=user.username or "",
        role=user.role,
        owner_id=user.owner_id or 0,
        parking_lot_id=user.parking_lot_id or 0,
        created_at=user.created_at,
    )


def _serialize_parking_lot(parking_lot, operational) -> EmployeeParkingLotResponse:
    return EmployeeParkingLotResponse(
        id=parking_lot.id,
        name=parking_lot.name,
        total_slots=operational.total_slots,
        occupied_slots=operational.occupied_slots,
        empty_slots=operational.empty_slots,
        status=operational.status,
        revenue_today=float(operational.revenue_today or 0),
        revenue_month=float(operational.revenue_month or 0),
        updated_at=operational.updated_at,
    )


@owner_router.post("/create-employee", response_model=OwnerCreateEmployeeResponse)
def create_employee(
    payload: OwnerCreateEmployeeRequest,
    db: Session = Depends(get_db),
    owner: User = Depends(authorize("owner")),
):
    employee = create_employee_controller(
        db=db,
        owner=owner,
        username=payload.username,
        password=payload.password,
        parking_lot_id=payload.parking_lot_id,
    )

    return OwnerCreateEmployeeResponse(
        message="Tao tai khoan employee thanh cong",
        employee=_serialize_employee(employee),
    )


@router.post("/login", response_model=EmployeeLoginResponse)
def employee_login(payload: EmployeeLoginRequest, db: Session = Depends(get_db)):
    result = employee_login_controller(db=db, username=payload.username, password=payload.password)
    employee = result["employee"]
    return EmployeeLoginResponse(
        message="Dang nhap employee thanh cong",
        token=result["token"],
        expires_in=result["expires_in"],
        user=_serialize_employee(employee),
    )


@router.get("/parking-lot", response_model=EmployeeParkingLotResponse)
def get_parking_lot(
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    parking_lot, operational = employee_parking_lot_controller(db=db, employee=employee)
    return _serialize_parking_lot(parking_lot, operational)


@router.post("/check-in", response_model=EmployeeCheckInOutResponse)
def check_in(
    payload: EmployeeCheckInRequest,
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    vehicle = employee_check_in_controller(db=db, employee=employee, qr_data=payload.qr_data)
    return EmployeeCheckInOutResponse(
        message="Check-in thanh cong",
        vehicle_id=vehicle.id,
        license_plate=vehicle.license_plate,
        parking_lot_id=vehicle.parking_lot_id,
        status=vehicle.status,
        check_in_time=vehicle.check_in_time,
        check_out_time=vehicle.check_out_time,
        fee_amount=float(vehicle.fee_amount or 0),
    )


@router.post("/check-out", response_model=EmployeeCheckInOutResponse)
def check_out(
    payload: EmployeeCheckOutRequest,
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    vehicle = employee_check_out_controller(db=db, employee=employee, qr_data=payload.qr_data)
    return EmployeeCheckInOutResponse(
        message="Check-out thanh cong",
        vehicle_id=vehicle.id,
        license_plate=vehicle.license_plate,
        parking_lot_id=vehicle.parking_lot_id,
        status=vehicle.status,
        check_in_time=vehicle.check_in_time,
        check_out_time=vehicle.check_out_time,
        fee_amount=float(vehicle.fee_amount or 0),
    )


@router.get("/vehicles", response_model=EmployeeVehiclesResponse)
def get_vehicles(
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    vehicles = employee_vehicles_controller(db=db, employee=employee)
    return EmployeeVehiclesResponse(
        vehicles=[
            {
                "id": item.id,
                "license_plate": item.license_plate,
                "check_in_time": item.check_in_time,
                "check_out_time": item.check_out_time,
                "status": item.status,
            }
            for item in vehicles
        ],
        total_count=len(vehicles),
    )


@router.put("/update-status", response_model=EmployeeParkingLotResponse)
def update_status(
    payload: EmployeeUpdateStatusRequest,
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    operational = employee_update_status_controller(db=db, employee=employee, status_value=payload.status)
    parking_lot, _ = employee_parking_lot_controller(db=db, employee=employee)
    return _serialize_parking_lot(parking_lot, operational)


@router.get("/revenue", response_model=EmployeeRevenueResponse)
def get_revenue(
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    operational = employee_revenue_controller(db=db, employee=employee)
    return EmployeeRevenueResponse(
        revenue_today=float(operational.revenue_today or 0),
        revenue_month=float(operational.revenue_month or 0),
    )


@router.get("/profile", response_model=EmployeeProfileResponse)
def get_profile(
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    parking_lot, operational = employee_parking_lot_controller(db=db, employee=employee)
    return EmployeeProfileResponse(
        employee=_serialize_employee(employee),
        parking_lot=_serialize_parking_lot(parking_lot, operational),
    )


@router.get("/history", response_model=EmployeeHistoryResponse)
def get_history(
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    history = employee_history_controller(db=db, employee=employee)
    return EmployeeHistoryResponse(
        history=[
            {
                "id": item.id,
                "action": item.action,
                "detail": item.detail,
                "amount": float(item.amount or 0),
                "created_at": item.created_at,
            }
            for item in history
        ],
        total_count=len(history),
    )


@router.get("/me", response_model=EmployeePublicInfo)
def me(employee: User = Depends(authorize("employee"))):
    return _serialize_employee(employee)


@router.get("/bookings/{booking_id}")
def get_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    employee: User = Depends(authorize("employee")),
):
    return employee_gate_booking_controller(db=db, employee=employee, booking_id=booking_id)
