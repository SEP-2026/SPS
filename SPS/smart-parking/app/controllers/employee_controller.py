from sqlalchemy.orm import Session

from app.models.models import User
from app.services.employee_service import EmployeeService


def create_employee_controller(db: Session, owner: User, username: str, password: str, parking_lot_id: int) -> User:
    return EmployeeService.create_employee(
        db=db,
        owner=owner,
        username=username,
        password=password,
        parking_lot_id=parking_lot_id,
    )


def employee_login_controller(db: Session, username: str, password: str) -> dict:
    return EmployeeService.login_employee(db=db, username=username, password=password)


def employee_parking_lot_controller(db: Session, employee: User):
    return EmployeeService.get_parking_lot(db=db, employee=employee)


def employee_check_in_controller(db: Session, employee: User, qr_data: str):
    return EmployeeService.check_in(db=db, employee=employee, qr_data=qr_data)


def employee_check_out_controller(db: Session, employee: User, qr_data: str):
    return EmployeeService.check_out(db=db, employee=employee, qr_data=qr_data)


def employee_vehicles_controller(db: Session, employee: User):
    return EmployeeService.get_parked_vehicles(db=db, employee=employee)


def employee_update_status_controller(db: Session, employee: User, status_value: str):
    return EmployeeService.update_parking_status(db=db, employee=employee, status_value=status_value)


def employee_revenue_controller(db: Session, employee: User):
    return EmployeeService.get_revenue(db=db, employee=employee)


def employee_history_controller(db: Session, employee: User):
    return EmployeeService.get_history(db=db, employee=employee)


def employee_gate_booking_controller(db: Session, employee: User, booking_id: int):
    return EmployeeService.get_gate_booking(db=db, employee=employee, booking_id=booking_id)
