from datetime import datetime

from app.database import SessionLocal
from app.models.models import Booking, District, OwnerParking, ParkingLot, ParkingPrice, ParkingSlot, User, UserVehicle
from app.utils.timezone import vn_now
from werkzeug.security import generate_password_hash

db = SessionLocal()


def seed_districts() -> dict[str, int]:
    district_names = [
        "Quận 1",
        "Quận 3",
        "Quận 4",
        "Quận 5",
        "Quận 6",
        "Quận 7",
        "Quận 8",
        "Quận 10",
        "Quận 11",
        "Quận 12",
        "Quận Tân Phú",
        "Thủ Đức",
        "Bình Tân",
    ]

    for name in district_names:
        district = db.query(District).filter(District.name == name).first()
        if not district:
            db.add(District(name=name))

    db.commit()

    districts = db.query(District).all()
    return {item.name: item.id for item in districts}


def seed_slots():
    parking_lots = db.query(ParkingLot).order_by(ParkingLot.id.asc()).all()
    if not parking_lots:
        print("No parking lot found for slot seeding")
        return

    for lot in parking_lots:
        for i in range(1, 11):
            code = f"A{i}"
            slot_index = i - 1
            zone = f"Khu {chr(65 + (slot_index % 4))}"
            level = f"Tầng {(slot_index // 20) + 1}"
            exists = (
                db.query(ParkingSlot)
                .filter(
                    ParkingSlot.parking_id == lot.id,
                    ParkingSlot.slot_number == code,
                )
                .first()
            )
            if not exists:
                slot = ParkingSlot(
                    code=f"{lot.id}-{code}",
                    slot_number=code,
                    parking_id=lot.id,
                    zone=zone,
                    level=level,
                    status="available",
                )
                db.add(slot)
            else:
                exists.code = f"{lot.id}-{code}"
                exists.slot_number = code
                exists.parking_id = lot.id
                exists.zone = zone
                exists.level = level
                exists.updated_at = vn_now()

    db.commit()
    print("Seeded slots!")


def seed_default_user(district_map: dict[str, int]):
    accounts = [
        {
            "name": "Demo User",
            "email": "user1@gmail.com",
            "phone": "0900000000",
            "vehicle_plate": "30A-12345",
            "vehicle_color": "Đen",
            "brand": "VinFast",
            "vehicle_model": "VF e34",
            "seat_count": 5,
            "role": "user",
            "password": "123456",
        },
   
   
        {
            "name": "Admin One",
            "email": "admin1@gmail.com",
            "phone": "0900000002",
            "vehicle_plate": "51A-99999",
            "vehicle_color": "Xanh",
            "brand": "Kia",
            "vehicle_model": "Morning",
            "seat_count": 4,
            "role": "admin",
            "password": "123456",
        },
    ]

    for item in accounts:
        user = db.query(User).filter(User.email == item["email"]).first()
        if not user:
            user = User(
                name=item["name"],
                email=item["email"],
                phone=item["phone"],
                vehicle_plate=item["vehicle_plate"],
                vehicle_color=item["vehicle_color"],
                managed_district_id=district_map.get(item.get("managed_district_name", "")),
                role=item["role"],
                is_active=1,
            )
            db.add(user)

        user.name = item["name"]
        user.phone = item["phone"]
        user.vehicle_plate = item["vehicle_plate"]
        user.vehicle_color = item["vehicle_color"]
        user.managed_district_id = district_map.get(item.get("managed_district_name", ""))
        user.role = item["role"]
        user.email = item["email"]
        user.password = item["password"]
        user.password_hash = generate_password_hash(item["password"])
        user.status = "active"
        user.is_active = 1

        db.flush()
        vehicle = db.query(UserVehicle).filter(UserVehicle.user_id == user.id).first()
        if not vehicle:
            vehicle = UserVehicle(user_id=user.id)
            db.add(vehicle)

        vehicle.license_plate = item["vehicle_plate"]
        vehicle.vehicle_color = item["vehicle_color"]
        vehicle.brand = item["brand"]
        vehicle.vehicle_model = item["vehicle_model"]
        vehicle.seat_count = item["seat_count"]

    db.commit()
    print("Seeded default users!")


def seed_employees():
    """Seed employee accounts assigned to parking lots"""
    owner = db.query(User).filter(User.email == "owner1@gmail.com", User.role == "owner").first()
    first_lot = db.query(ParkingLot).order_by(ParkingLot.id.asc()).first()

    if not owner or not first_lot:
        print("Cannot seed employees: missing owner or parking lot")
        return

    employees = [
        {
            "name": "Nhân viên 1",
            "email": "employee1@gmail.com",
            "phone": "0901000001",
            "password": "123456",
        },
    ]

    for item in employees:
        employee = db.query(User).filter(User.email == item["email"], User.role == "employee").first()
        if not employee:
            employee = User(
                name=item["name"],
                email=item["email"],
                phone=item["phone"],
                owner_id=owner.id,
                parking_id=first_lot.id,
                role="employee",
                status="active",
                is_active=1,
            )
            db.add(employee)

        employee.name = item["name"]
        employee.email = item["email"]
        employee.phone = item["phone"]
        employee.owner_id = owner.id
        employee.parking_id = first_lot.id
        employee.role = "employee"
        employee.status = "active"
        employee.is_active = 1
        employee.password_hash = generate_password_hash(item["password"])
        employee.password = "__legacy_disabled__"

    db.commit()
    print("Seeded employees!")


def sync_legacy_owner_districts(district_map: dict[str, int]):
    legacy_owner_districts = {
        "quan1@gmail.com": "Quận 1",
        "quan3@gmail.com": "Quận 3",
        "quan4@gmail.com": "Quận 4",
        "quan5@gmail.com": "Quận 5",
        "quan6@gmail.com": "Quận 6",
        "quan7@gmail.com": "Quận 7",
        "quan8@gmail.com": "Quận 8",
        "quan10@gmail.com": "Quận 10",
        "quan11@gmail.com": "Quận 11",
        "quan12@gmail.com": "Quận 12",
        "quanthuduc@gmail.com": "Thủ Đức",
        "quantanphu@gmail.com": "Quận Tân Phú",
        "quanbinhtan@gmail.com": "Bình Tân",
    }

    for email, district_name in legacy_owner_districts.items():
        owner = db.query(User).filter(User.email == email, User.role == "owner").first()
        if not owner:
            continue
        owner.managed_district_id = district_map.get(district_name)

    db.commit()
    print("Synced legacy owner districts!")


def seed_parking_lots_and_prices(district_map: dict[str, int]):
    lots = [
        {
            "name": "Bai xe Tao Dan",
            "address": "Cong vien Tao Dan, Quan 1, TP.HCM",
            "district_name": "Quận 1",
            "latitude": 10.7734,
            "longitude": 106.6917,
            "has_roof": 1,
            "price_per_hour": 15000,
            "price_per_day": 90000,
            "price_per_month": 2200000,
        },
        {
            "name": "Ham Vincom Dong Khoi",
            "address": "72 Le Thanh Ton, Quan 1, TP.HCM",
            "district_name": "Quận 1",
            "latitude": 10.7785,
            "longitude": 106.7027,
            "has_roof": 1,
            "price_per_hour": 18000,
            "price_per_day": 110000,
            "price_per_month": 2500000,
        },
        {
            "name": "Bai xe Nguyen Binh Khiem",
            "address": "32 Nguyen Binh Khiem, Quan 1, TP.HCM",
            "district_name": "Quận 1",
            "latitude": 10.7871,
            "longitude": 106.7044,
            "has_roof": 0,
            "price_per_hour": 14000,
            "price_per_day": 85000,
            "price_per_month": 2100000,
        },
        {
            "name": "Bai xe Vo Van Tan",
            "address": "Vo Van Tan, Quan 3, TP.HCM",
            "district_name": "Quận 3",
            "latitude": 10.7788,
            "longitude": 106.6856,
            "has_roof": 1,
            "price_per_hour": 13000,
            "price_per_day": 85000,
            "price_per_month": 1900000,
        },
        {
            "name": "Bai xe Cach Mang Thang 8",
            "address": "Cach Mang Thang 8, Quan 3, TP.HCM",
            "district_name": "Quận 3",
            "latitude": 10.7797,
            "longitude": 106.6809,
            "has_roof": 0,
            "price_per_hour": 12000,
            "price_per_day": 80000,
            "price_per_month": 1800000,
        },
        {
            "name": "Bai xe Ho Xuan Huong",
            "address": "Ho Xuan Huong, Quan 3, TP.HCM",
            "district_name": "Quận 3",
            "latitude": 10.7811,
            "longitude": 106.6843,
            "has_roof": 1,
            "price_per_hour": 14000,
            "price_per_day": 88000,
            "price_per_month": 2000000,
        },
        {
            "name": "Bai xe Nguyen Van Sang",
            "address": "Nguyen Van Sang, Tan Phu, TP.HCM",
            "district_name": "Quận Tân Phú",
            "latitude": 10.7915,
            "longitude": 106.6261,
            "has_roof": 1,
            "price_per_hour": 10000,
            "price_per_day": 70000,
            "price_per_month": 1500000,
        },
        {
            "name": "Bai xe Tan Ky Tan Quy",
            "address": "Tan Ky Tan Quy, Tan Phu, TP.HCM",
            "district_name": "Quận Tân Phú",
            "latitude": 10.7932,
            "longitude": 106.6250,
            "has_roof": 0,
            "price_per_hour": 12000,
            "price_per_day": 80000,
            "price_per_month": 1700000,
        },
        {
            "name": "Bai xe Luy Ban Bich",
            "address": "Luy Ban Bich, Tan Phu, TP.HCM",
            "district_name": "Quận Tân Phú",
            "latitude": 10.7818,
            "longitude": 106.6364,
            "has_roof": 1,
            "price_per_hour": 9000,
            "price_per_day": 65000,
            "price_per_month": 1400000,
        },
        {
            "name": "Bai xe Au Co",
            "address": "Au Co, Tan Phu, TP.HCM",
            "district_name": "Quận Tân Phú",
            "latitude": 10.7864,
            "longitude": 106.6402,
            "has_roof": 0,
            "price_per_hour": 11000,
            "price_per_day": 75000,
            "price_per_month": 1600000,
        },
        {
            "name": "Bai xe Truong Chinh",
            "address": "Truong Chinh, Tan Phu, TP.HCM",
            "district_name": "Quận Tân Phú",
            "latitude": 10.8031,
            "longitude": 106.6287,
            "has_roof": 1,
            "price_per_hour": 10000,
            "price_per_day": 72000,
            "price_per_month": 1550000,
        },
    ]

    for item in lots:
        lot = db.query(ParkingLot).filter(ParkingLot.name == item["name"]).first()
        if not lot:
            lot = ParkingLot(
                name=item["name"],
                address=item["address"],
                district_id=district_map.get(item["district_name"]),
                latitude=item["latitude"],
                longitude=item["longitude"],
                has_roof=item["has_roof"],
                is_active=1,
            )
            db.add(lot)
            db.flush()
        else:
            lot.address = item["address"]
            lot.district_id = district_map.get(item["district_name"])
            lot.latitude = item["latitude"]
            lot.longitude = item["longitude"]
            lot.has_roof = item["has_roof"]
            lot.is_active = 1

        price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == lot.id).first()
        if not price:
            price = ParkingPrice(
                parking_id=lot.id,
                price_per_hour=item["price_per_hour"],
                price_per_day=item["price_per_day"],
                price_per_month=item["price_per_month"],
            )
            db.add(price)
        else:
            price.price_per_hour = item["price_per_hour"]
            price.price_per_day = item["price_per_day"]
            price.price_per_month = item["price_per_month"]

    db.commit()
    print("Seeded parking lots and prices!")


def seed_owner_parking_assignments():
    owners = (
        db.query(User)
        .filter(User.role == "owner")
        .order_by(User.id.asc())
        .all()
    )

    for owner in owners:
        if owner.managed_district_id is None:
            continue

        district_lots = (
            db.query(ParkingLot)
            .filter(
                ParkingLot.district_id == owner.managed_district_id,
                ParkingLot.is_active == 1,
            )
            .order_by(ParkingLot.id.asc())
            .all()
        )

        expected_parking_ids = {int(lot.id) for lot in district_lots}
        for lot in district_lots:
            exists = (
                db.query(OwnerParking)
                .filter(
                    OwnerParking.owner_id == owner.id,
                    OwnerParking.parking_id == lot.id,
                )
                .first()
            )
            if not exists:
                db.add(OwnerParking(owner_id=owner.id, parking_id=lot.id))

        existing_assignments = db.query(OwnerParking).filter(OwnerParking.owner_id == owner.id).all()
        for assignment in existing_assignments:
            if int(assignment.parking_id) not in expected_parking_ids:
                db.delete(assignment)

    db.commit()
    print("Seeded owner parking assignments!")


def sync_slot_statuses_from_real_bookings():
    demo_bookings = db.query(Booking).filter(Booking.qr_code.like("seed-booking-%")).all()
    for booking in demo_bookings:
        db.delete(booking)

    db.flush()

    active_booking_by_slot = {
        int(booking.slot_id): booking
        for booking in db.query(Booking).filter(Booking.status.in_(["pending", "booked", "checked_in"])).all()
        if booking.slot_id is not None and not (booking.qr_code or "").startswith("seed-booking-")
    }

    slots = db.query(ParkingSlot).order_by(ParkingSlot.parking_id.asc(), ParkingSlot.id.asc()).all()
    for slot in slots:
        normalized_status = (slot.status or "").lower()
        active_booking = active_booking_by_slot.get(int(slot.id))

        if normalized_status == "maintenance":
            continue
        if active_booking is None:
            slot.status = "available"
        elif (active_booking.status or "").lower() == "checked_in":
            slot.status = "occupied"
        else:
            slot.status = "reserved"

    db.commit()
    print("Synced slot statuses from real bookings!")


if __name__ == "__main__":
    district_map = seed_districts()
    seed_parking_lots_and_prices(district_map)
    seed_slots()
    seed_default_user(district_map)
    seed_employees()
    sync_legacy_owner_districts(district_map)
    seed_owner_parking_assignments()
    sync_slot_statuses_from_real_bookings()
