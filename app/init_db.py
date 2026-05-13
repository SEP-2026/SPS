import time

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.database import Base, SessionLocal, engine
from app.models import models


def _run_ddl_with_retry(statement: str, retries: int = 3, delay_seconds: float = 0.5) -> bool:
    for attempt in range(retries):
        try:
            with engine.begin() as conn:
                conn.execute(text(statement))
            return True
        except SQLAlchemyError as exc:
            error_code = getattr(exc.orig, "args", [None])[0] if getattr(exc, "orig", None) else None
            if error_code in {1213, 1205} and attempt < retries - 1:
                time.sleep(delay_seconds)
                continue
            print(f"Skipped migration statement after failure: {statement}")
            return False


def _run_migration_step(name: str, fn) -> None:
    try:
        fn()
    except Exception as exc:
        print(f"Migration step failed [{name}]: {exc}")


def migrate_parking_lots_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "parking_lots" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("parking_lots")}
    alter_statements = []

    if "latitude" not in columns:
        alter_statements.append("ADD COLUMN latitude DECIMAL(10,6)")
    if "longitude" not in columns:
        alter_statements.append("ADD COLUMN longitude DECIMAL(10,6)")
    if "district_id" not in columns:
        alter_statements.append("ADD COLUMN district_id INT NULL")
    if "has_roof" not in columns:
        alter_statements.append("ADD COLUMN has_roof TINYINT(1) NOT NULL DEFAULT 0")
    if "is_active" not in columns:
        alter_statements.append("ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1")
    if "avg_rating" not in columns:
        alter_statements.append("ADD COLUMN avg_rating DECIMAL(3,1) NOT NULL DEFAULT 0.0")
    if "review_count" not in columns:
        alter_statements.append("ADD COLUMN review_count INT NOT NULL DEFAULT 0")
    if "phone" not in columns:
        alter_statements.append("ADD COLUMN phone VARCHAR(30) NULL")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE parking_lots {', '.join(alter_statements)}"))
    if "district_id" in columns or any("district_id" in statement for statement in alter_statements):
        _run_ddl_with_retry("ALTER TABLE parking_lots MODIFY COLUMN district_id INT NULL")
def migrate_users_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "users" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("users")}
    alter_statements = []

    if "full_name" not in columns:
        alter_statements.append("ADD COLUMN full_name VARCHAR(255) NULL")
    if "email" not in columns:
        alter_statements.append("ADD COLUMN email VARCHAR(255) NULL")
    if "password" not in columns:
        alter_statements.append("ADD COLUMN password VARCHAR(255) NULL")
    if "password_hash" not in columns:
        alter_statements.append("ADD COLUMN password_hash VARCHAR(255) NULL")
    if "phone" not in columns:
        alter_statements.append("ADD COLUMN phone VARCHAR(30) NULL")
    if "vehicle_plate" not in columns:
        alter_statements.append("ADD COLUMN vehicle_plate VARCHAR(30) NULL")
    if "vehicle_color" not in columns:
        alter_statements.append("ADD COLUMN vehicle_color VARCHAR(50) NULL")
    if "managed_district_id" not in columns:
        alter_statements.append("ADD COLUMN managed_district_id INT NULL")
    if "owner_id" not in columns:
        alter_statements.append("ADD COLUMN owner_id INT NULL")
    if "parking_id" not in columns:
        alter_statements.append("ADD COLUMN parking_id INT NULL")
    if "is_active" not in columns:
        alter_statements.append("ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1")
    if "status" not in columns:
        alter_statements.append("ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE users {', '.join(alter_statements)}"))
    if "managed_district_id" in columns or any("managed_district_id" in statement for statement in alter_statements):
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users MODIFY COLUMN managed_district_id INT NULL"))

    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET full_name = COALESCE(full_name, 'Unknown User')"))
        conn.execute(text("UPDATE users SET email = CONCAT('legacy_user_', id, '@local.test') WHERE email IS NULL OR email = ''"))
        conn.execute(text("UPDATE users SET password = COALESCE(password, '123456')"))
        conn.execute(text("UPDATE users SET status = COALESCE(status, 'active')"))
        conn.execute(text("UPDATE users SET is_active = COALESCE(is_active, 1)"))

    indexes = {index["name"] for index in inspector.get_indexes("users")}
    if "uq_users_email" not in indexes:
        with engine.begin() as conn:
            conn.execute(text("CREATE UNIQUE INDEX uq_users_email ON users (email)"))


def migrate_districts_normalization():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "districts" not in table_names:
        return

    parking_columns = {column["name"] for column in inspector.get_columns("parking_lots")}
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    has_legacy_parking_district = "district" in parking_columns
    has_legacy_user_managed_district = "managed_district" in user_columns

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT IGNORE INTO districts (name)
                SELECT 'Quận Tân Phú'
                """
            )
        )

        if has_legacy_parking_district:
            conn.execute(
                text(
                    """
                    INSERT IGNORE INTO districts (name)
                    SELECT DISTINCT TRIM(p.district)
                    FROM parking_lots p
                    WHERE p.district IS NOT NULL AND TRIM(p.district) <> ''
                    """
                )
            )

        if has_legacy_user_managed_district:
            conn.execute(
                text(
                    """
                    INSERT IGNORE INTO districts (name)
                    SELECT DISTINCT TRIM(u.managed_district)
                    FROM users u
                    WHERE u.managed_district IS NOT NULL AND TRIM(u.managed_district) <> ''
                    """
                )
            )

        if has_legacy_parking_district:
            conn.execute(
                text(
                    """
                    UPDATE parking_lots p
                    JOIN districts d ON d.name = TRIM(p.district)
                    SET p.district_id = d.id
                    WHERE p.district_id IS NULL
                      AND p.district IS NOT NULL
                      AND TRIM(p.district) <> ''
                    """
                )
            )

        if has_legacy_user_managed_district:
            conn.execute(
                text(
                    """
                    UPDATE users u
                    JOIN districts d ON d.name = TRIM(u.managed_district)
                    SET u.managed_district_id = d.id
                    WHERE u.managed_district_id IS NULL
                      AND u.managed_district IS NOT NULL
                      AND TRIM(u.managed_district) <> ''
                    """
                )
            )

        conn.execute(
            text(
                """
                UPDATE parking_lots p
                JOIN districts d ON d.name = 'Quận Tân Phú'
                SET p.district_id = d.id
                WHERE p.district_id IS NULL
                  AND (
                    LOWER(p.address) LIKE '%tan phu%'
                    OR LOWER(p.name) LIKE '%tan phu%'
                  )
                """
            )
        )

        conn.execute(
            text(
                """
                UPDATE users u
                JOIN districts d ON d.name = 'Quận Tân Phú'
                SET u.managed_district_id = d.id
                WHERE u.managed_district_id IS NULL
                  AND u.role = 'owner'
                """
            )
        )

    fk_checks = []
    with engine.begin() as conn:
        fk_checks = conn.execute(
            text(
                """
                SELECT TABLE_NAME, COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND REFERENCED_TABLE_NAME = 'districts'
                  AND TABLE_NAME IN ('parking_lots', 'users')
                  AND COLUMN_NAME IN ('district_id', 'managed_district_id')
                """
            )
        ).mappings().all()

        has_parking_fk = any(r["TABLE_NAME"] == "parking_lots" and r["COLUMN_NAME"] == "district_id" for r in fk_checks)
        has_user_fk = any(r["TABLE_NAME"] == "users" and r["COLUMN_NAME"] == "managed_district_id" for r in fk_checks)

        if "district_id" in parking_columns and not has_parking_fk:
            _run_ddl_with_retry(
                """
                ALTER TABLE parking_lots
                ADD CONSTRAINT fk_parking_lots_district_id
                FOREIGN KEY (district_id) REFERENCES districts(id)
                """.strip()
            )

        if "managed_district_id" in user_columns and not has_user_fk:
            _run_ddl_with_retry(
                """
                ALTER TABLE users
                ADD CONSTRAINT fk_users_managed_district_id
                FOREIGN KEY (managed_district_id) REFERENCES districts(id)
                """.strip()
            )

    # Legacy text columns are removed after data has been migrated to FK columns.
    drop_statements = []
    if "district" in parking_columns:
        drop_statements.append("ALTER TABLE parking_lots DROP COLUMN district")
    if "managed_district" in user_columns:
        drop_statements.append("ALTER TABLE users DROP COLUMN managed_district")

    if drop_statements:
        with engine.begin() as conn:
            for statement in drop_statements:
                conn.execute(text(statement))


def migrate_user_vehicles_table():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "user_vehicles" not in table_names or "users" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("user_vehicles")}
    alter_statements = []

    if "vehicle_color" not in columns:
        alter_statements.append("ADD COLUMN vehicle_color VARCHAR(50) NULL")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE user_vehicles {', '.join(alter_statements)}"))

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO user_vehicles (user_id, license_plate, brand, vehicle_model, seat_count, vehicle_color, created_at, updated_at)
                SELECT u.id, u.vehicle_plate, NULL, NULL, NULL, u.vehicle_color, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM users u
                WHERE (u.vehicle_plate IS NOT NULL OR u.vehicle_color IS NOT NULL)
                  AND NOT EXISTS (
                    SELECT 1 FROM user_vehicles uv WHERE uv.user_id = u.id
                  )
                """
            )
        )


def migrate_parking_slots_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "parking_slots" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("parking_slots")}
    alter_statements = []

    if "code" not in columns:
        alter_statements.append("ADD COLUMN code VARCHAR(50) NULL")
    if "slot_number" not in columns:
        alter_statements.append("ADD COLUMN slot_number VARCHAR(20) NULL")
    if "parking_id" not in columns:
        alter_statements.append("ADD COLUMN parking_id BIGINT NULL")
    if "status" not in columns:
        alter_statements.append("ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'available'")
    if "zone" not in columns:
        alter_statements.append("ADD COLUMN zone VARCHAR(50) NULL")
    if "level" not in columns:
        alter_statements.append("ADD COLUMN level VARCHAR(50) NULL")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")
    if "updated_at" not in columns:
        alter_statements.append("ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE parking_slots {', '.join(alter_statements)}"))

    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE parking_slots MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'available'"))
        conn.execute(
            text(
                """
                ALTER TABLE parking_slots
                MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                """
            )
        )

    indexes = {index["name"] for index in inspector.get_indexes("parking_slots")}
    if "uq_parking_slots_code" not in indexes:
        with engine.begin() as conn:
            conn.execute(text("CREATE UNIQUE INDEX uq_parking_slots_code ON parking_slots (code)"))

    session = SessionLocal()
    try:
        slots = (
            session.query(models.ParkingSlot)
            .order_by(models.ParkingSlot.parking_id.asc(), models.ParkingSlot.id.asc())
            .all()
        )
        current_parking_id = None
        lot_index = -1
        for slot in slots:
            if slot.parking_id != current_parking_id:
                current_parking_id = slot.parking_id
                lot_index = 0
            else:
                lot_index += 1

            if not slot.zone:
                slot.zone = f"Khu {chr(65 + (lot_index % 4))}"
            if not slot.level:
                slot.level = f"Tầng {(lot_index // 20) + 1}"
            if not slot.created_at:
                slot.created_at = slot.updated_at
        session.commit()
    finally:
        session.close()


def migrate_reviews_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "reviews" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("reviews")}
    alter_statements = []

    if "owner_reply" not in columns:
        alter_statements.append("ADD COLUMN owner_reply TEXT NULL")
    if "owner_replied_at" not in columns:
        alter_statements.append("ADD COLUMN owner_replied_at DATETIME NULL")
    if "booking_id" not in columns:
        alter_statements.append("ADD COLUMN booking_id INT NULL")
    if "updated_at" not in columns:
        alter_statements.append(
            "ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        )

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE reviews {', '.join(alter_statements)}"))

    if "comment" in columns:
        _run_ddl_with_retry("ALTER TABLE reviews MODIFY COLUMN comment TEXT NULL")
    _run_ddl_with_retry("ALTER TABLE reviews MODIFY COLUMN owner_reply TEXT NULL")
    _run_ddl_with_retry("ALTER TABLE reviews MODIFY COLUMN rating TINYINT NOT NULL")

    indexes = {index["name"] for index in inspector.get_indexes("reviews")}
    if "unique_user_parking_review" in indexes:
        if "idx_reviews_user_id" not in indexes:
            _run_ddl_with_retry("CREATE INDEX idx_reviews_user_id ON reviews (user_id)")
        _run_ddl_with_retry("DROP INDEX unique_user_parking_review ON reviews")

    with engine.begin() as conn:
        conn.execute(text("UPDATE reviews SET booking_id = id WHERE booking_id IS NULL"))

    indexes = {index["name"] for index in inspect(engine).get_indexes("reviews")}
    if "uq_reviews_booking_id" not in indexes:
        _run_ddl_with_retry("CREATE UNIQUE INDEX uq_reviews_booking_id ON reviews (booking_id)")
    _run_ddl_with_retry(
        """
        ALTER TABLE reviews
        ADD CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES bookings(id)
        """.strip()
    )
    _run_ddl_with_retry(
        """
        ALTER TABLE reviews
        ADD CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
        """.strip()
    )
    _run_ddl_with_retry("ALTER TABLE reviews MODIFY COLUMN booking_id INT NOT NULL")


def migrate_bookings_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "bookings" not in table_names:
        return

    columns = {column["name"]: column for column in inspector.get_columns("bookings")}
    alter_statements = []

    if "booking_mode" not in columns:
        alter_statements.append("ADD COLUMN booking_mode VARCHAR(20) NOT NULL DEFAULT 'hourly'")
    if "billed_units" not in columns:
        alter_statements.append("ADD COLUMN billed_units FLOAT NOT NULL DEFAULT 0")
    if "total_amount" not in columns:
        alter_statements.append("ADD COLUMN total_amount FLOAT NOT NULL DEFAULT 0")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")
    if "qr_code_path" not in columns:
        alter_statements.append("ADD COLUMN qr_code_path VARCHAR(255) NULL")
    if "qr_generated_at" not in columns:
        alter_statements.append("ADD COLUMN qr_generated_at DATETIME NULL")
    if "last_gate_action" not in columns:
        alter_statements.append("ADD COLUMN last_gate_action VARCHAR(20) NULL")
    if "last_gate_action_at" not in columns:
        alter_statements.append("ADD COLUMN last_gate_action_at DATETIME NULL")
    if "qr_token_expires_at" not in columns:
        alter_statements.append("ADD COLUMN qr_token_expires_at DATETIME NULL")
    if "cancel_reason" not in columns:
        alter_statements.append("ADD COLUMN cancel_reason VARCHAR(255) NULL")
    if "overstay_minutes" not in columns:
        alter_statements.append("ADD COLUMN overstay_minutes INT NULL DEFAULT 0")
    if "overstay_fee" not in columns:
        alter_statements.append("ADD COLUMN overstay_fee DECIMAL(10,2) NULL DEFAULT 0")
    if "total_actual_fee" not in columns:
        alter_statements.append("ADD COLUMN total_actual_fee DECIMAL(10,2) NULL")
    if "is_reviewed" not in columns:
        alter_statements.append("ADD COLUMN is_reviewed TINYINT(1) NOT NULL DEFAULT 0")

    if alter_statements:
        _run_ddl_with_retry(f"ALTER TABLE bookings {', '.join(alter_statements)}")

    # Ho tro day du trang thai booking cho luong payment moi.
    booking_vehicle_column = columns.get("vehicle_id")
    if booking_vehicle_column is not None and not booking_vehicle_column["nullable"]:
        _run_ddl_with_retry("ALTER TABLE bookings MODIFY COLUMN vehicle_id INT NULL")

    booking_parking_column = columns.get("parking_id")
    if booking_parking_column is not None and not booking_parking_column["nullable"]:
        _run_ddl_with_retry("ALTER TABLE bookings MODIFY COLUMN parking_id INT NULL")

    booking_status_column = columns.get("status")
    current_status_type = str(booking_status_column["type"]).lower() if booking_status_column is not None else ""
    if "enum" not in current_status_type:
        _run_ddl_with_retry(
            """
            ALTER TABLE bookings
            MODIFY COLUMN status ENUM(
                'pending','booked','checked_in','checked_out','completed','cancelled'
            ) DEFAULT 'pending'
            """.strip()
        )


def migrate_payments_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "payments" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("payments")}
    alter_statements = []

    if "amount" not in columns:
        alter_statements.append("ADD COLUMN amount FLOAT NOT NULL DEFAULT 0")
    if "overtime_fee" not in columns:
        alter_statements.append("ADD COLUMN overtime_fee FLOAT NOT NULL DEFAULT 0")
    if "payment_method" not in columns:
        alter_statements.append("ADD COLUMN payment_method VARCHAR(50) NOT NULL DEFAULT 'vnpay'")
    if "payment_status" not in columns:
        alter_statements.append("ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'pending'")
    if "paid_at" not in columns:
        alter_statements.append("ADD COLUMN paid_at DATETIME NULL")
    if "vnpay_url" not in columns:
        alter_statements.append("ADD COLUMN vnpay_url VARCHAR(500) NULL")
    if "qr_code" not in columns:
        alter_statements.append("ADD COLUMN qr_code VARCHAR(255) NULL")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")
    if "deposit_amount" not in columns:
        alter_statements.append("ADD COLUMN deposit_amount FLOAT NOT NULL DEFAULT 0")
    if "remaining_amount" not in columns:
        alter_statements.append("ADD COLUMN remaining_amount FLOAT NOT NULL DEFAULT 0")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE payments {', '.join(alter_statements)}"))

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE payments
                MODIFY COLUMN payment_method ENUM('qr','cash','vnpay','wallet') DEFAULT 'vnpay'
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE payments
                MODIFY COLUMN payment_status ENUM('pending','paid','failed') DEFAULT 'pending'
                """
            )
        )

    indexes = {index["name"] for index in inspector.get_indexes("payments")}
    if "uq_payments_booking_id" not in indexes:
        with engine.begin() as conn:
            conn.execute(text("CREATE UNIQUE INDEX uq_payments_booking_id ON payments (booking_id)"))


def migrate_wallets():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "wallets" not in table_names or "users" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("wallets")}
    alter_statements = []

    if "balance" not in columns:
        alter_statements.append("ADD COLUMN balance DECIMAL(12,2) NOT NULL DEFAULT 0")
    else:
        alter_statements.append("MODIFY COLUMN balance DECIMAL(12,2) NOT NULL DEFAULT 0")
    if "reserved_balance" not in columns:
        alter_statements.append("ADD COLUMN reserved_balance DECIMAL(12,2) NOT NULL DEFAULT 0")
    else:
        alter_statements.append("MODIFY COLUMN reserved_balance DECIMAL(12,2) NOT NULL DEFAULT 0")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")
    if "updated_at" not in columns:
        alter_statements.append("ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE wallets {', '.join(alter_statements)}"))

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO wallets (user_id, balance, reserved_balance, created_at, updated_at)
                SELECT u.id, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM users u
                LEFT JOIN wallets w ON w.user_id = u.id
                WHERE w.id IS NULL
                """
            )
        )
        try:
            conn.execute(text("ALTER TABLE wallets ADD CONSTRAINT chk_wallet_balance_nonnegative CHECK (balance >= 0)"))
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE wallets ADD CONSTRAINT chk_wallet_reserved_balance_nonnegative CHECK (reserved_balance >= 0)"))
        except Exception:
            pass


def migrate_wallet_transactions_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "wallet_transactions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("wallet_transactions")}
    alter_statements = []

    if "source_type" not in columns:
        alter_statements.append("ADD COLUMN source_type VARCHAR(50) NULL")
    if "source_id" not in columns:
        alter_statements.append("ADD COLUMN source_id INT NULL")
    if "actor_id" not in columns:
        alter_statements.append("ADD COLUMN actor_id INT NULL")
    if "actor_role" not in columns:
        alter_statements.append("ADD COLUMN actor_role VARCHAR(50) NULL")
    if "request_ip" not in columns:
        alter_statements.append("ADD COLUMN request_ip VARCHAR(45) NULL")
    if "user_agent" not in columns:
        alter_statements.append("ADD COLUMN user_agent VARCHAR(255) NULL")

    if alter_statements:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE wallet_transactions {', '.join(alter_statements)}"))


def migrate_transactions_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "transactions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("transactions")}
    alter_statements = []

    if "user_id" not in columns:
        alter_statements.append("ADD COLUMN user_id INT NULL")
    if "parking_id" not in columns:
        alter_statements.append("ADD COLUMN parking_id INT NULL")
    if "vehicle_id" not in columns:
        alter_statements.append("ADD COLUMN vehicle_id INT NULL")
    if "gate_id" not in columns:
        alter_statements.append("ADD COLUMN gate_id VARCHAR(100) NULL")
    if "action_type" not in columns:
        alter_statements.append("ADD COLUMN action_type VARCHAR(20) NULL")
    if "source_type" not in columns:
        alter_statements.append("ADD COLUMN source_type VARCHAR(20) NULL")
    if "result" not in columns:
        alter_statements.append("ADD COLUMN result VARCHAR(20) NULL")
    if "note" not in columns:
        alter_statements.append("ADD COLUMN note VARCHAR(255) NULL")
    if "image_url" not in columns:
        alter_statements.append("ADD COLUMN image_url VARCHAR(500) NULL")
    if "license_plate" not in columns:
        alter_statements.append("ADD COLUMN license_plate VARCHAR(30) NULL")

    if alter_statements:
        _run_ddl_with_retry(f"ALTER TABLE transactions {', '.join(alter_statements)}")


def migrate_employee_accounts_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "employee_accounts" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("employee_accounts")}
    alter_statements = []

    if "username" not in columns:
        alter_statements.append("ADD COLUMN username VARCHAR(100) NOT NULL")
    if "password_hash" not in columns:
        alter_statements.append("ADD COLUMN password_hash VARCHAR(255) NULL")
    if "owner_id" not in columns:
        alter_statements.append("ADD COLUMN owner_id INT NULL")
    if "parking_id" not in columns:
        alter_statements.append("ADD COLUMN parking_id INT NULL")
    if "role" not in columns:
        alter_statements.append("ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'employee'")
    if "status" not in columns:
        alter_statements.append("ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'")
    if "is_active" not in columns:
        alter_statements.append("ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")

    if alter_statements:
        _run_ddl_with_retry(f"ALTER TABLE employee_accounts {', '.join(alter_statements)}")

    with engine.begin() as conn:
        conn.execute(text("UPDATE employee_accounts SET username = LOWER(TRIM(username))"))
        conn.execute(text("UPDATE employee_accounts SET role = COALESCE(NULLIF(role, ''), 'employee')"))
        conn.execute(text("UPDATE employee_accounts SET status = COALESCE(NULLIF(status, ''), 'active')"))
        conn.execute(text("UPDATE employee_accounts SET is_active = COALESCE(is_active, 1)"))

    indexes = {index["name"] for index in inspector.get_indexes("employee_accounts")}
    if "uq_employee_accounts_username" not in indexes:
        _run_ddl_with_retry("CREATE UNIQUE INDEX uq_employee_accounts_username ON employee_accounts (username)")

    # Migrate legacy employee accounts into users table as role=employee.
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO users (
                    full_name, email, password, password_hash, phone, role, status, is_active, owner_id, parking_id, created_at
                )
                SELECT
                    COALESCE(NULLIF(TRIM(ea.username), ''), CONCAT('employee_', ea.id)),
                    LOWER(TRIM(ea.username)),
                    '__legacy_disabled__',
                    ea.password_hash,
                    NULL,
                    'employee',
                    COALESCE(NULLIF(ea.status, ''), 'active'),
                    COALESCE(ea.is_active, 1),
                    ea.owner_id,
                    ea.parking_id,
                    COALESCE(ea.created_at, CURRENT_TIMESTAMP)
                FROM employee_accounts ea
                WHERE ea.username IS NOT NULL
                  AND TRIM(ea.username) <> ''
                  AND NOT EXISTS (
                    SELECT 1 FROM users u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(ea.username))
                  )
                """
            )
        )

    # Drop foreign keys that still reference employee_accounts to allow table removal.
    with engine.begin() as conn:
        fk_rows = conn.execute(
            text(
                """
                SELECT TABLE_NAME, CONSTRAINT_NAME
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND REFERENCED_TABLE_NAME = 'employee_accounts'
                """
            )
        ).mappings().all()

        for fk in fk_rows:
            _run_ddl_with_retry(
                f"ALTER TABLE {fk['TABLE_NAME']} DROP FOREIGN KEY {fk['CONSTRAINT_NAME']}"
            )

    # Remap employee_activities.employee_id from legacy employee_accounts.id -> users.id
    # using normalized username/email before dropping employee_accounts.
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE employee_activities act
                JOIN employee_accounts ea ON ea.id = act.employee_id
                JOIN users u
                  ON LOWER(TRIM(u.email)) = LOWER(TRIM(ea.username))
                 AND LOWER(TRIM(COALESCE(u.role, ''))) = 'employee'
                SET act.employee_id = u.id
                """
            )
        )

    # Drop legacy table after successful migration.
    _run_ddl_with_retry("DROP TABLE IF EXISTS employee_accounts")


def migrate_parking_operational_states_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "parking_operational_states" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("parking_operational_states")}
    alter_statements = []

    if "parking_id" not in columns:
        alter_statements.append("ADD COLUMN parking_id INT NULL")
    if "status" not in columns:
        alter_statements.append("ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'open'")
    if "updated_at" not in columns:
        alter_statements.append("ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")

    if alter_statements:
        _run_ddl_with_retry(f"ALTER TABLE parking_operational_states {', '.join(alter_statements)}")

    with engine.begin() as conn:
        conn.execute(text("UPDATE parking_operational_states SET status = COALESCE(NULLIF(status, ''), 'open')"))

    indexes = {index["name"] for index in inspector.get_indexes("parking_operational_states")}
    if "uq_parking_operational_states_parking_id" not in indexes:
        _run_ddl_with_retry(
            "CREATE UNIQUE INDEX uq_parking_operational_states_parking_id ON parking_operational_states (parking_id)"
        )


def migrate_employee_activities_columns():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "employee_activities" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("employee_activities")}
    alter_statements = []

    if "employee_id" not in columns:
        alter_statements.append("ADD COLUMN employee_id INT NULL")
    if "parking_id" not in columns:
        alter_statements.append("ADD COLUMN parking_id INT NULL")
    if "booking_id" not in columns:
        alter_statements.append("ADD COLUMN booking_id INT NULL")
    if "action" not in columns:
        alter_statements.append("ADD COLUMN action VARCHAR(50) NULL")
    if "detail" not in columns:
        alter_statements.append("ADD COLUMN detail VARCHAR(500) NULL")
    if "amount" not in columns:
        alter_statements.append("ADD COLUMN amount FLOAT NOT NULL DEFAULT 0")
    if "created_at" not in columns:
        alter_statements.append("ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP")

    if alter_statements:
        _run_ddl_with_retry(f"ALTER TABLE employee_activities {', '.join(alter_statements)}")

    with engine.begin() as conn:
        conn.execute(text("UPDATE employee_activities SET amount = COALESCE(amount, 0)"))
        conn.execute(
            text(
                """
                DELETE act
                FROM employee_activities act
                LEFT JOIN users u ON u.id = act.employee_id
                WHERE u.id IS NULL
                """
            )
        )

    with engine.begin() as conn:
        fk_exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'employee_activities'
                  AND COLUMN_NAME = 'employee_id'
                  AND REFERENCED_TABLE_NAME = 'users'
                LIMIT 1
                """
            )
        ).first()
    if not fk_exists:
        _run_ddl_with_retry(
            """
            ALTER TABLE employee_activities
            ADD CONSTRAINT fk_employee_activities_employee_id
            FOREIGN KEY (employee_id) REFERENCES users(id)
            """.strip()
        )


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_migration_step("parking_lots", migrate_parking_lots_columns)
    _run_migration_step("users", migrate_users_columns)
    _run_migration_step("districts_normalization", migrate_districts_normalization)
    _run_migration_step("user_vehicles", migrate_user_vehicles_table)
    _run_migration_step("parking_slots", migrate_parking_slots_columns)
    _run_migration_step("reviews", migrate_reviews_columns)
    _run_migration_step("bookings", migrate_bookings_columns)
    _run_migration_step("payments", migrate_payments_columns)
    _run_migration_step("wallets", migrate_wallets)
    _run_migration_step("wallet_transactions", migrate_wallet_transactions_columns)
    _run_migration_step("transactions", migrate_transactions_columns)
    _run_migration_step("employee_accounts", migrate_employee_accounts_columns)
    _run_migration_step("parking_operational_states", migrate_parking_operational_states_columns)
    _run_migration_step("employee_activities", migrate_employee_activities_columns)


if __name__ == "__main__":
    init_db()
