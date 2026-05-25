from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, DECIMAL, Float, CheckConstraint, ForeignKey, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base
from app.utils.timezone import vn_now


class District(Base):
    __tablename__ = "districts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column("full_name", String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=True)
    password_hash = Column(String(255), nullable=True)
    phone = Column(String(30))
    vehicle_plate = Column(String(30), nullable=True)
    vehicle_color = Column(String(50), nullable=True)
    managed_district_id = Column(Integer, ForeignKey("districts.id"), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=True)
    role = Column(String(50), default="user")
    status = Column(String(20), default="active")
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    managed_district = relationship("District", foreign_keys=[managed_district_id])
    vehicle_profile = relationship("UserVehicle", back_populates="user", uselist=False)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String(128), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class UserVehicle(Base):
    __tablename__ = "user_vehicles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    license_plate = Column(String(30), nullable=True)
    brand = Column(String(100), nullable=True)
    vehicle_model = Column(String(100), nullable=True)
    seat_count = Column(Integer, nullable=True)
    vehicle_color = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="vehicle_profile")


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (
        CheckConstraint("balance >= 0", name="ck_wallet_balance_nonnegative"),
        CheckConstraint("reserved_balance >= 0", name="ck_wallet_reserved_balance_nonnegative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    balance = Column(DECIMAL(12, 2), default=0)
    reserved_balance = Column(DECIMAL(12, 2), default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"
    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_wallet_transaction_amount_nonnegative"),
    )

    id = Column(Integer, primary_key=True, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id"), nullable=False, index=True)
    transaction_type = Column(String(50), nullable=False)
    amount = Column(DECIMAL(12, 2), nullable=False)
    reference_type = Column(String(50), nullable=True)
    reference_id = Column(Integer, nullable=True, index=True)
    source_type = Column(String(50), nullable=True)
    source_id = Column(Integer, nullable=True, index=True)
    actor_id = Column(Integer, nullable=True, index=True)
    actor_role = Column(String(50), nullable=True)
    request_ip = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    wallet = relationship("Wallet")


class ParkingSlot(Base):
    __tablename__ = "parking_slots"

    id = Column(Integer, primary_key=True, index=True)
    parking_id = Column(Integer, nullable=True)
    slot_number = Column(String(20), nullable=True)
    slot_type = Column(String(20), nullable=True)
    zone = Column(String(50), nullable=True)
    level = Column(String(50), nullable=True)
    code = Column(String(50), unique=True)
    status = Column(String(50), default="available")
    created_at = Column(DateTime, default=vn_now)
    updated_at = Column(DateTime, default=vn_now, onupdate=vn_now)


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"))
    vehicle_id = Column(Integer, nullable=True)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=True)
    slot_id = Column(Integer, ForeignKey("parking_slots.id"))

    start_time = Column("checkin_time", DateTime, default=datetime.utcnow)
    expire_time = Column("checkout_time", DateTime)
    actual_checkin = Column(DateTime, nullable=True)
    actual_checkout = Column(DateTime, nullable=True)
    overstay_minutes = Column(Integer, default=0, nullable=True)
    overstay_fee = Column(DECIMAL(12, 2), default=0, nullable=True)
    total_actual_fee = Column(DECIMAL(12, 2), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    booking_mode = Column(String(20), default="hourly")
    billed_units = Column(Float, default=0)
    total_amount = Column(DECIMAL(12, 2), default=0)

    status = Column(String(50), default="pending")
    qr_code = Column(String(255))
    qr_code_path = Column(String(255), nullable=True)
    qr_generated_at = Column(DateTime, nullable=True)
    last_gate_action = Column(String(20), nullable=True)
    last_gate_action_at = Column(DateTime, nullable=True)
    qr_token_expires_at = Column(DateTime, nullable=True)
    cancel_reason = Column(String(255), nullable=True)
    is_reviewed = Column(Integer, default=0, nullable=False)

    user = relationship("User")
    slot = relationship("ParkingSlot")
    parking_lot = relationship("ParkingLot")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)

    booking_id = Column(Integer, ForeignKey("bookings.id"))

    amount = Column(DECIMAL(12, 2))
    payment_status = Column(String(50), default="pending")
    user_id = Column(Integer, nullable=True)
    parking_id = Column(Integer, nullable=True)
    vehicle_id = Column(Integer, nullable=True)
    gate_id = Column(String(100), nullable=True)
    action_type = Column(String(20), nullable=True)
    source_type = Column(String(20), nullable=True)
    result = Column(String(20), nullable=True)
    note = Column(String(255), nullable=True)
    image_url = Column(String(500), nullable=True)
    license_plate = Column(String(30), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), unique=True, nullable=False)

    amount = Column(DECIMAL(12, 2), nullable=False)
    overtime_fee = Column(DECIMAL(12, 2), default=0)
    payment_method = Column(String(50), default="vnpay")
    payment_status = Column(String(20), default="pending")
    paid_at = Column(DateTime, nullable=True)
    vnpay_url = Column(String(500), nullable=True)
    qr_code = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    deposit_amount = Column(DECIMAL(12, 2), default=0)
    remaining_amount = Column(DECIMAL(12, 2), default=0)


class OwnerParking(Base):
    __tablename__ = "owner_parking"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=False)


class ParkingLot(Base):
    __tablename__ = "parking_lots"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    address = Column(String(255), nullable=False)
    phone = Column(String(30), nullable=True)
    district_id = Column(Integer, ForeignKey("districts.id"), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    has_roof = Column(Integer, default=0)
    is_active = Column(Integer, default=1)
    avg_rating = Column(Float, default=0)
    review_count = Column(Integer, default=0)

    district = relationship("District", foreign_keys=[district_id])


class ParkingPrice(Base):
    __tablename__ = "parking_prices"

    id = Column(Integer, primary_key=True, index=True)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), unique=True, nullable=False)
    price_per_hour = Column(DECIMAL(12, 2), nullable=False)
    price_per_day = Column(DECIMAL(12, 2), nullable=False)
    price_per_month = Column(DECIMAL(12, 2), nullable=False)

    parking = relationship("ParkingLot")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), unique=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=False)
    rating = Column(SmallInteger, nullable=False)
    comment = Column(Text, nullable=True)
    owner_reply = Column(Text, nullable=True)
    owner_replied_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    parking = relationship("ParkingLot")


class ParkingOperationalState(Base):
    __tablename__ = "parking_operational_states"

    id = Column(Integer, primary_key=True, index=True)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=False, unique=True, index=True)
    status = Column(String(20), default="open", nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parking_lot = relationship("ParkingLot")


class EmployeeActivity(Base):
    __tablename__ = "employee_activities"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=False, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=True, index=True)
    action = Column(String(50), nullable=False)
    detail = Column(String(500), nullable=True)
    amount = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("User")
    parking_lot = relationship("ParkingLot")
    booking = relationship("Booking")


class OwnerBalance(Base):
    __tablename__ = "owner_balances"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    available_balance = Column(DECIMAL(12, 2), default=0, nullable=False)
    lifetime_earned = Column(DECIMAL(12, 2), default=0, nullable=False)
    lifetime_withdrawn = Column(DECIMAL(12, 2), default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User")


class OwnerBankAccount(Base):
    __tablename__ = "owner_bank_accounts"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bank_code = Column(String(20), nullable=False)
    bank_name = Column(String(100), nullable=False)
    account_number = Column(String(50), nullable=False)
    account_holder_name = Column(String(255), nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User")


class OwnerWithdrawal(Base):
    __tablename__ = "owner_withdrawals"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    bank_account_id = Column(Integer, ForeignKey("owner_bank_accounts.id"), nullable=True)
    request_code = Column(String(32), unique=True, nullable=False, index=True)
    amount = Column(DECIMAL(12, 2), nullable=False)
    fee = Column(DECIMAL(12, 2), default=0, nullable=False)
    net_amount = Column(DECIMAL(12, 2), nullable=False)
    status = Column(String(20), default="processing", nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User")
    bank_account = relationship("OwnerBankAccount")


class CashReconciliationSlip(Base):
    __tablename__ = "cash_reconciliation_slips"
    __table_args__ = (
        UniqueConstraint("slip_code", name="uq_cash_reconciliation_slip_code"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    parking_id = Column(Integer, ForeignKey("parking_lots.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    slip_code = Column(String(32), nullable=False)
    reconciliation_date = Column(Date, nullable=False, index=True)
    total_collected = Column(DECIMAL(12, 2), default=0, nullable=False)
    deposited_amount = Column(DECIMAL(12, 2), default=0, nullable=False)
    variance = Column(DECIMAL(12, 2), default=0, nullable=False)
    status = Column(String(20), default="pending", nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", foreign_keys=[owner_id])
    employee = relationship("User", foreign_keys=[employee_id])
    parking_lot = relationship("ParkingLot")
    items = relationship("CashReconciliationItem", back_populates="slip", cascade="all, delete-orphan")


class CashReconciliationItem(Base):
    __tablename__ = "cash_reconciliation_items"

    id = Column(Integer, primary_key=True, index=True)
    slip_id = Column(Integer, ForeignKey("cash_reconciliation_slips.id"), nullable=False, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False, index=True)
    booking_id = Column(Integer, ForeignKey("bookings.id"), nullable=False, index=True)
    amount = Column(DECIMAL(12, 2), nullable=False)

    slip = relationship("CashReconciliationSlip", back_populates="items")
    payment = relationship("Payment")
    booking = relationship("Booking")
