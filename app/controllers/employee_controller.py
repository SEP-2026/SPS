from sqlalchemy.orm import Session

from app.models.models import User
from app.services.employee_service import (
    create_employee_for_owner,
    delete_owner_employee,
    employee_check_in,
    employee_check_out,
    employee_get_gate_booking,
    employee_login,
    get_owner_employees,
    get_employee_dashboard,
    get_employee_history,
    get_employee_profile,
    get_employee_revenue,
    get_employee_slots_overview,
    get_employee_vehicles,
    update_owner_employee,
    update_employee_parking_status,
)


def create_owner_employee_controller(
    owner: User,
    full_name: str,
    email: str,
    phone: str | None,
    password: str,
    parking_id: int,
    db: Session,
    username: str | None = None,
) -> dict:
    return create_employee_for_owner(
        owner=owner,
        full_name=full_name,
        email=email,
        phone=phone,
        password=password,
        parking_id=parking_id,
        db=db,
        username=username,
    )


def owner_employees_controller(owner: User, db: Session) -> dict:
    return get_owner_employees(owner, db)


def update_owner_employee_controller(
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
    return update_owner_employee(
        owner,
        employee_id,
        db,
        full_name=full_name,
        email=email,
        phone=phone,
        password=password,
        parking_id=parking_id,
        status=status,
    )


def delete_owner_employee_controller(owner: User, employee_id: int, db: Session) -> dict:
    return delete_owner_employee(owner, employee_id, db)


def employee_login_controller(
    username: str,
    password: str,
    db: Session,
    *,
    request_ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    return employee_login(username, password, db, request_ip=request_ip, user_agent=user_agent)


def employee_dashboard_controller(employee: User, db: Session) -> dict:
    return get_employee_dashboard(employee, db)


def employee_profile_controller(employee: User, db: Session) -> dict:
    return get_employee_profile(employee, db)


def employee_vehicles_controller(employee: User, db: Session) -> dict:
    return get_employee_vehicles(employee, db)


def employee_revenue_controller(employee: User, db: Session) -> dict:
    return get_employee_revenue(employee, db)


def employee_slots_overview_controller(employee: User, db: Session) -> dict:
    return get_employee_slots_overview(employee, db)


def employee_parking_status_controller(employee: User, status_value: str, db: Session) -> dict:
    return update_employee_parking_status(employee, status_value, db)


def employee_check_in_controller(employee: User, qr_data: str, db: Session) -> dict:
    return employee_check_in(employee, qr_data, db)


def employee_check_out_controller(employee: User, qr_data: str, payment_method: str, db: Session) -> dict:
    return employee_check_out(employee, qr_data, payment_method, db)


def employee_gate_booking_controller(employee: User, booking_id: int, db: Session) -> dict:
    return employee_get_gate_booking(employee, booking_id, db)


def employee_history_controller(
    employee: User,
    db: Session,
    *,
    limit: int = 200,
    action: str | None = None,
) -> dict:
    return get_employee_history(employee, db, limit=limit, action=action)
