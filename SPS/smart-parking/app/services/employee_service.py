import json
import math
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from app.models.models import (
    Booking,
    EmployeeActivity,
    EmployeeVehicle,
    OwnerParking,
    ParkingLot,
    ParkingLotOperational,
    ParkingPrice,
    ParkingSlot,
    User,
)
from app.routes.auth import create_access_token


class EmployeeService:
    @staticmethod
    def create_employee(
        db: Session,
        owner: User,
        username: str,
        password: str,
        parking_lot_id: int,
    ) -> User:
        if owner.role != "owner":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chi owner moi duoc tao employee")

        owner_parking = (
            db.query(OwnerParking)
            .filter(OwnerParking.owner_id == owner.id, OwnerParking.parking_id == parking_lot_id)
            .first()
        )
        if not owner_parking:
            raise HTTPException(status_code=403, detail="Owner khong quan ly bai do nay")

        normalized_username = username.strip().lower()
        if not normalized_username:
            raise HTTPException(status_code=400, detail="username khong hop le")

        existing_username = db.query(User).filter(User.username == normalized_username).first()
        if existing_username:
            raise HTTPException(status_code=409, detail="username da ton tai")

        parking_lot = db.query(ParkingLot).filter(ParkingLot.id == parking_lot_id).first()
        if not parking_lot:
            raise HTTPException(status_code=404, detail="parking lot khong ton tai")

        synthetic_email = f"employee_{normalized_username}@local.smartparking"
        if db.query(User).filter(User.email == synthetic_email).first():
            synthetic_email = f"employee_{normalized_username}_{int(datetime.utcnow().timestamp())}@local.smartparking"

        employee = User(
            name=normalized_username,
            email=synthetic_email,
            username=normalized_username,
            password="__legacy_disabled__",
            password_hash=generate_password_hash(password),
            role="employee",
            owner_id=owner.id,
            parking_lot_id=parking_lot_id,
            status="active",
            is_active=1,
        )
        db.add(employee)
        db.flush()

        EmployeeService._ensure_operational(db, parking_lot_id)
        EmployeeService._add_activity(
            db=db,
            employee_id=employee.id,
            parking_lot_id=parking_lot_id,
            action="employee_created",
            detail=f"Owner #{owner.id} tao tai khoan employee {normalized_username}",
        )

        db.commit()
        db.refresh(employee)
        return employee

    @staticmethod
    def login_employee(db: Session, username: str, password: str) -> dict[str, Any]:
        normalized_username = username.strip().lower()
        employee = (
            db.query(User)
            .filter(User.username == normalized_username, User.role == "employee", User.is_active == 1)
            .first()
        )
        if not employee:
            raise HTTPException(status_code=401, detail="Sai username hoac mat khau")

        password_ok = False
        if employee.password_hash:
            password_ok = check_password_hash(employee.password_hash, password)
        elif employee.password:
            password_ok = employee.password == password

        if not password_ok:
            raise HTTPException(status_code=401, detail="Sai username hoac mat khau")

        token, expires_at, _ = create_access_token(employee)

        return {
            "token": token,
            "expires_in": int((expires_at - datetime.utcnow().astimezone(expires_at.tzinfo)).total_seconds()),
            "employee": employee,
        }

    @staticmethod
    def get_parking_lot(db: Session, employee: User) -> tuple[ParkingLot, ParkingLotOperational]:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        parking_lot = db.query(ParkingLot).filter(ParkingLot.id == parking_lot_id).first()
        if not parking_lot:
            raise HTTPException(status_code=404, detail="Khong tim thay bai do duoc phan cong")

        operational = EmployeeService._ensure_operational(db, parking_lot_id)
        EmployeeService._sync_revenue(db, operational)
        db.commit()
        db.refresh(operational)

        return parking_lot, operational

    @staticmethod
    def check_in(db: Session, employee: User, qr_data: str) -> EmployeeVehicle:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        payload = EmployeeService._parse_qr_data(qr_data)

        booking_id = payload.get("booking_id")
        license_plate = (payload.get("license_plate") or "").strip().upper()

        if booking_id:
            booking = db.query(Booking).filter(Booking.id == booking_id).first()
            if not booking:
                raise HTTPException(status_code=404, detail="Booking khong ton tai")
            if booking.parking_lot_id and booking.parking_lot_id != parking_lot_id:
                raise HTTPException(status_code=403, detail="Booking khong thuoc bai xe duoc phan cong")
            if booking.user and booking.user.vehicle_plate:
                license_plate = booking.user.vehicle_plate.strip().upper()

        if not license_plate:
            raise HTTPException(status_code=400, detail="QR data thieu license plate")

        existing = (
            db.query(EmployeeVehicle)
            .filter(
                EmployeeVehicle.parking_lot_id == parking_lot_id,
                EmployeeVehicle.license_plate == license_plate,
                EmployeeVehicle.status == "parked",
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Xe da dang o trong bai")

        vehicle = EmployeeVehicle(
            license_plate=license_plate,
            parking_lot_id=parking_lot_id,
            employee_id=employee.id,
            booking_id=booking_id,
            status="parked",
            qr_data=qr_data,
        )
        db.add(vehicle)
        db.flush()

        operational = EmployeeService._ensure_operational(db, parking_lot_id)
        EmployeeService._add_activity(
            db=db,
            employee_id=employee.id,
            parking_lot_id=parking_lot_id,
            action="check_in",
            detail=f"Check-in xe {license_plate}",
            vehicle_id=vehicle.id,
        )

        EmployeeService._sync_slot_metrics(db, operational)
        db.commit()
        db.refresh(vehicle)

        return vehicle

    @staticmethod
    def check_out(db: Session, employee: User, qr_data: str) -> EmployeeVehicle:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        payload = EmployeeService._parse_qr_data(qr_data)

        vehicle = EmployeeService._find_active_vehicle(db, parking_lot_id, payload)
        if not vehicle:
            raise HTTPException(status_code=404, detail="Khong tim thay xe dang do de check-out")

        now = datetime.utcnow()
        fee_amount = EmployeeService._calculate_fee(db, parking_lot_id, vehicle.check_in_time, now)

        vehicle.status = "checked_out"
        vehicle.check_out_time = now
        vehicle.fee_amount = fee_amount

        operational = EmployeeService._ensure_operational(db, parking_lot_id)
        EmployeeService._sync_slot_metrics(db, operational)
        EmployeeService._sync_revenue(db, operational)

        EmployeeService._add_activity(
            db=db,
            employee_id=employee.id,
            parking_lot_id=parking_lot_id,
            action="check_out",
            detail=f"Check-out xe {vehicle.license_plate}",
            vehicle_id=vehicle.id,
            amount=fee_amount,
        )

        db.commit()
        db.refresh(vehicle)
        return vehicle

    @staticmethod
    def get_parked_vehicles(db: Session, employee: User) -> list[EmployeeVehicle]:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        return (
            db.query(EmployeeVehicle)
            .filter(EmployeeVehicle.parking_lot_id == parking_lot_id, EmployeeVehicle.status == "parked")
            .order_by(EmployeeVehicle.check_in_time.desc())
            .all()
        )

    @staticmethod
    def update_parking_status(db: Session, employee: User, status_value: str) -> ParkingLotOperational:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        operational = EmployeeService._ensure_operational(db, parking_lot_id)
        operational.status = status_value
        operational.updated_at = datetime.utcnow()

        EmployeeService._add_activity(
            db=db,
            employee_id=employee.id,
            parking_lot_id=parking_lot_id,
            action="update_status",
            detail=f"Cap nhat trang thai bai: {status_value}",
        )

        db.commit()
        db.refresh(operational)
        return operational

    @staticmethod
    def get_revenue(db: Session, employee: User) -> ParkingLotOperational:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        operational = EmployeeService._ensure_operational(db, parking_lot_id)
        EmployeeService._sync_revenue(db, operational)
        db.commit()
        db.refresh(operational)
        return operational

    @staticmethod
    def get_history(db: Session, employee: User) -> list[EmployeeActivity]:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        return (
            db.query(EmployeeActivity)
            .filter(EmployeeActivity.employee_id == employee.id, EmployeeActivity.parking_lot_id == parking_lot_id)
            .order_by(EmployeeActivity.created_at.desc())
            .limit(200)
            .all()
        )

    @staticmethod
    def get_gate_booking(db: Session, employee: User, booking_id: int) -> dict:
        parking_lot_id = EmployeeService._employee_parking_lot_id(employee)
        booking = db.query(Booking).filter(Booking.id == booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Không tìm thấy booking")
        if int(booking.parking_lot_id or 0) != int(parking_lot_id):
            raise HTTPException(status_code=403, detail="Booking không thuộc bãi được phân công")
        
        user = booking.user if booking.user else None
        return {
            "booking_id": booking.id,
            "booking_code": f"BK-{booking.id}",
            "booking_status": booking.status,
            "booking_mode": booking.booking_mode,
            "user_name": user.name if user else None,
            "user_phone": user.phone if user else None,
            "vehicle_plate": user.vehicle_plate if user else None,
            "slot_code": booking.slot.code if booking.slot else None,
            "zone": booking.slot.zone if booking.slot else None,
            "start_time": booking.start_time,
            "expire_time": booking.expire_time,
            "parking_lot_id": booking.parking_lot_id,
            "total_amount": booking.total_amount,
        }

    @staticmethod
    def _parse_qr_data(qr_data: str) -> dict[str, Any]:
        raw = (qr_data or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="QR data khong duoc de trong")

        if raw.isdigit():
            return {"booking_id": int(raw)}

        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError("invalid json object")
            return payload
        except Exception:
            return {"license_plate": raw.upper()}

    @staticmethod
    def _find_active_vehicle(db: Session, parking_lot_id: int, payload: dict[str, Any]) -> EmployeeVehicle | None:
        query = db.query(EmployeeVehicle).filter(
            EmployeeVehicle.parking_lot_id == parking_lot_id,
            EmployeeVehicle.status == "parked",
        )

        if payload.get("vehicle_id"):
            return query.filter(EmployeeVehicle.id == int(payload["vehicle_id"])).first()

        if payload.get("booking_id"):
            vehicle = query.filter(EmployeeVehicle.booking_id == int(payload["booking_id"])).first()
            if vehicle:
                return vehicle

        license_plate = (payload.get("license_plate") or "").strip().upper()
        if license_plate:
            return query.filter(EmployeeVehicle.license_plate == license_plate).first()

        return None

    @staticmethod
    def _calculate_fee(db: Session, parking_lot_id: int, check_in_time: datetime, check_out_time: datetime) -> float:
        if check_out_time <= check_in_time:
            return 0.0

        duration_hours = (check_out_time - check_in_time).total_seconds() / 3600
        billed_hours = max(1, math.ceil(duration_hours))

        price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == parking_lot_id).first()
        price_per_hour = float(price.price_per_hour) if price and price.price_per_hour is not None else 10000.0

        return round(billed_hours * price_per_hour, 2)

    @staticmethod
    def _employee_parking_lot_id(employee: User) -> int:
        if employee.role != "employee":
            raise HTTPException(status_code=403, detail="Tai khoan khong phai employee")

        if not employee.parking_lot_id:
            raise HTTPException(status_code=400, detail="Employee chua duoc gan bai do")

        return employee.parking_lot_id

    @staticmethod
    def _ensure_operational(db: Session, parking_lot_id: int) -> ParkingLotOperational:
        operational = (
            db.query(ParkingLotOperational)
            .filter(ParkingLotOperational.parking_lot_id == parking_lot_id)
            .with_for_update()
            .first()
        )

        if not operational:
            operational = ParkingLotOperational(parking_lot_id=parking_lot_id, status="open")
            db.add(operational)
            db.flush()

        EmployeeService._sync_slot_metrics(db, operational)
        return operational

    @staticmethod
    def _sync_slot_metrics(db: Session, operational: ParkingLotOperational) -> None:
        total_slots = (
            db.query(func.count(ParkingSlot.id))
            .filter(ParkingSlot.parking_id == operational.parking_lot_id)
            .scalar()
            or 0
        )

        occupied_slots = (
            db.query(func.count(EmployeeVehicle.id))
            .filter(
                EmployeeVehicle.parking_lot_id == operational.parking_lot_id,
                EmployeeVehicle.status == "parked",
            )
            .scalar()
            or 0
        )

        operational.total_slots = int(total_slots)
        operational.occupied_slots = int(min(occupied_slots, total_slots))
        operational.empty_slots = int(max(total_slots - operational.occupied_slots, 0))
        operational.updated_at = datetime.utcnow()

        if operational.occupied_slots >= operational.total_slots and operational.total_slots > 0:
            operational.status = "full"
        elif operational.status == "full":
            operational.status = "open"

    @staticmethod
    def _sync_revenue(db: Session, operational: ParkingLotOperational) -> None:
        now = datetime.utcnow()
        start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        revenue_today = (
            db.query(func.coalesce(func.sum(EmployeeVehicle.fee_amount), 0.0))
            .filter(
                EmployeeVehicle.parking_lot_id == operational.parking_lot_id,
                EmployeeVehicle.status == "checked_out",
                EmployeeVehicle.check_out_time >= start_today,
            )
            .scalar()
            or 0.0
        )
        revenue_month = (
            db.query(func.coalesce(func.sum(EmployeeVehicle.fee_amount), 0.0))
            .filter(
                EmployeeVehicle.parking_lot_id == operational.parking_lot_id,
                EmployeeVehicle.status == "checked_out",
                EmployeeVehicle.check_out_time >= start_month,
            )
            .scalar()
            or 0.0
        )

        operational.revenue_today = float(round(revenue_today, 2))
        operational.revenue_month = float(round(revenue_month, 2))
        operational.updated_at = datetime.utcnow()

    @staticmethod
    def _add_activity(
        db: Session,
        employee_id: int,
        parking_lot_id: int,
        action: str,
        detail: str,
        vehicle_id: int | None = None,
        amount: float | None = None,
    ) -> None:
        activity = EmployeeActivity(
            employee_id=employee_id,
            parking_lot_id=parking_lot_id,
            action=action,
            detail=detail,
            vehicle_id=vehicle_id,
            amount=amount or 0,
        )
        db.add(activity)
