from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.models import (
    Booking,
    CashReconciliationItem,
    CashReconciliationSlip,
    EmployeeActivity,
    OwnerBalance,
    OwnerBankAccount,
    OwnerParking,
    OwnerWithdrawal,
    ParkingLot,
    Payment,
    User,
)
from app.services.revenue_settings import split_revenue
from app.utils import isoformat_vn, vn_now

WITHDRAWAL_FEE = Decimal("8000")
MIN_WITHDRAWAL_AMOUNT = Decimal("50000")
SLIP_STATUS_PENDING = "pending"
SLIP_STATUS_DEPOSITED = "deposited"
SLIP_STATUS_VARIANCE = "variance"
WITHDRAWAL_STATUS_PROCESSING = "processing"
WITHDRAWAL_STATUS_COMPLETED = "completed"
WITHDRAWAL_STATUS_CANCELLED = "cancelled"


def _to_decimal(value: float | Decimal | int | None) -> Decimal:
    return Decimal(str(value or 0))


def _float(value: Decimal | float | int | None) -> float:
    return float(_to_decimal(value))


def _payment_gross(payment: Payment) -> Decimal:
    return _to_decimal(payment.amount) + _to_decimal(payment.overtime_fee)


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _day_bounds(target: date) -> tuple[datetime, datetime]:
    start = datetime.combine(target, time.min)
    end = datetime.combine(target, time.max)
    return start, end


def _slip_status_from_amounts(total_collected: Decimal, deposited_amount: Decimal) -> str:
    if deposited_amount <= 0:
        return SLIP_STATUS_PENDING
    variance = deposited_amount - total_collected
    if variance == 0:
        return SLIP_STATUS_DEPOSITED
    return SLIP_STATUS_VARIANCE


def _serialize_bank_account(account: OwnerBankAccount) -> dict[str, Any]:
    return {
        "id": account.id,
        "bankCode": account.bank_code,
        "bankName": account.bank_name,
        "accountNumber": account.account_number,
        "accountHolderName": account.account_holder_name,
        "isDefault": bool(account.is_default),
        "createdAt": isoformat_vn(account.created_at),
    }


def _serialize_withdrawal(
    withdrawal: OwnerWithdrawal,
    bank_account: OwnerBankAccount | None = None,
) -> dict[str, Any]:
    account = bank_account or withdrawal.bank_account
    account_label = None
    if account:
        masked = account.account_number[-4:] if len(account.account_number) >= 4 else account.account_number
        account_label = f"{account.bank_code} - {masked}"
    return {
        "id": withdrawal.id,
        "requestCode": withdrawal.request_code,
        "amount": _float(withdrawal.amount),
        "fee": _float(withdrawal.fee),
        "netAmount": _float(withdrawal.net_amount),
        "status": withdrawal.status,
        "note": withdrawal.note or "",
        "bankAccountId": withdrawal.bank_account_id,
        "bankAccountLabel": account_label,
        "accountHolderName": account.account_holder_name if account else None,
        "createdAt": isoformat_vn(withdrawal.created_at),
        "updatedAt": isoformat_vn(withdrawal.updated_at),
    }


def _serialize_slip(
    slip: CashReconciliationSlip,
    parking: ParkingLot | None = None,
    employee: User | None = None,
) -> dict[str, Any]:
    lot = parking or slip.parking_lot
    staff = employee or slip.employee
    return {
        "id": slip.id,
        "slipCode": slip.slip_code,
        "reconciliationDate": slip.reconciliation_date.isoformat(),
        "parkingId": slip.parking_id,
        "parkingLotName": lot.name if lot else "Chưa có bãi",
        "employeeId": slip.employee_id,
        "employeeName": staff.name if staff else "Chưa gán",
        "totalCollected": _float(slip.total_collected),
        "depositedAmount": _float(slip.deposited_amount),
        "variance": _float(slip.variance),
        "status": slip.status,
        "statusLabel": _slip_status_label(slip.status),
        "note": slip.note or "",
        "transactionCount": len(slip.items or []),
        "createdAt": isoformat_vn(slip.created_at),
        "updatedAt": isoformat_vn(slip.updated_at),
    }


def _slip_status_label(status: str) -> str:
    mapping = {
        SLIP_STATUS_PENDING: "Chưa nộp",
        SLIP_STATUS_DEPOSITED: "Đã nộp",
        SLIP_STATUS_VARIANCE: "Lệch tiền",
    }
    return mapping.get(status, status)


def _next_slip_code(db: Session, owner_id: int, target_date: date) -> str:
    prefix = f"DS{target_date.strftime('%y%m%d')}"
    count = (
        db.query(func.count(CashReconciliationSlip.id))
        .filter(
            CashReconciliationSlip.owner_id == owner_id,
            CashReconciliationSlip.slip_code.like(f"{prefix}-%"),
        )
        .scalar()
        or 0
    )
    return f"{prefix}-{int(count) + 1:03d}"


def _next_withdrawal_code(db: Session, owner_id: int) -> str:
    today = vn_now().date()
    prefix = f"WD{today.strftime('%y%m%d')}"
    count = (
        db.query(func.count(OwnerWithdrawal.id))
        .filter(
            OwnerWithdrawal.owner_id == owner_id,
            OwnerWithdrawal.request_code.like(f"{prefix}-%"),
        )
        .scalar()
        or 0
    )
    return f"{prefix}-{int(count) + 1:03d}"


def _owner_parking_ids(owner_id: int, db: Session) -> list[int]:
    rows = db.query(OwnerParking.parking_id).filter(OwnerParking.owner_id == owner_id).all()
    return [int(row.parking_id) for row in rows]


def _cash_payments_query(db: Session, parking_ids: list[int]):
    return (
        db.query(Payment, Booking)
        .join(Booking, Booking.id == Payment.booking_id)
        .filter(
            Booking.parking_id.in_(parking_ids),
            Payment.payment_method == "cash",
            Payment.payment_status == "paid",
        )
    )


def _reconciled_payment_ids(db: Session, owner_id: int) -> set[int]:
    rows = (
        db.query(CashReconciliationItem.payment_id)
        .join(CashReconciliationSlip, CashReconciliationSlip.id == CashReconciliationItem.slip_id)
        .filter(CashReconciliationSlip.owner_id == owner_id)
        .all()
    )
    return {int(row.payment_id) for row in rows}


def _infer_employee_for_booking(db: Session, booking_id: int, parking_id: int) -> int | None:
    activity = (
        db.query(EmployeeActivity)
        .filter(
            EmployeeActivity.booking_id == booking_id,
            EmployeeActivity.parking_id == parking_id,
        )
        .order_by(EmployeeActivity.created_at.desc())
        .first()
    )
    return int(activity.employee_id) if activity else None


def sync_owner_balance(owner_id: int, db: Session) -> OwnerBalance:
    parking_ids = _owner_parking_ids(owner_id, db)
    balance = db.query(OwnerBalance).filter(OwnerBalance.owner_id == owner_id).first()
    if not balance:
        balance = OwnerBalance(owner_id=owner_id)
        db.add(balance)
        db.flush()

    lifetime_earned = Decimal("0")
    if parking_ids:
        paid_rows = (
            db.query(Payment)
            .join(Booking, Booking.id == Payment.booking_id)
            .filter(
                Booking.parking_id.in_(parking_ids),
                Payment.payment_status == "paid",
            )
            .all()
        )
        for payment in paid_rows:
            revenue = split_revenue(_float(_payment_gross(payment)))
            lifetime_earned += _to_decimal(revenue["ownerPayout"])

    reserved = _to_decimal(
        db.query(func.coalesce(func.sum(OwnerWithdrawal.amount), 0))
        .filter(
            OwnerWithdrawal.owner_id == owner_id,
            OwnerWithdrawal.status == WITHDRAWAL_STATUS_PROCESSING,
        )
        .scalar()
    )
    withdrawn = _to_decimal(
        db.query(func.coalesce(func.sum(OwnerWithdrawal.net_amount), 0))
        .filter(
            OwnerWithdrawal.owner_id == owner_id,
            OwnerWithdrawal.status == WITHDRAWAL_STATUS_COMPLETED,
        )
        .scalar()
    )

    available = lifetime_earned - withdrawn - reserved
    if available < 0:
        available = Decimal("0")

    balance.lifetime_earned = lifetime_earned
    balance.lifetime_withdrawn = withdrawn
    balance.available_balance = available
    balance.updated_at = vn_now()
    db.commit()
    db.refresh(balance)
    return balance


def get_owner_balance_payload(owner_id: int, db: Session) -> dict[str, Any]:
    balance = sync_owner_balance(owner_id, db)
    processing_amount = _float(
        db.query(func.coalesce(func.sum(OwnerWithdrawal.amount), 0))
        .filter(
            OwnerWithdrawal.owner_id == owner_id,
            OwnerWithdrawal.status == WITHDRAWAL_STATUS_PROCESSING,
        )
        .scalar()
    )
    processing_count = (
        db.query(func.count(OwnerWithdrawal.id))
        .filter(
            OwnerWithdrawal.owner_id == owner_id,
            OwnerWithdrawal.status == WITHDRAWAL_STATUS_PROCESSING,
        )
        .scalar()
        or 0
    )
    return {
        "availableBalance": _float(balance.available_balance),
        "lifetimeEarned": _float(balance.lifetime_earned),
        "lifetimeWithdrawn": _float(balance.lifetime_withdrawn),
        "processingAmount": processing_amount,
        "processingCount": int(processing_count),
        "withdrawalFee": _float(WITHDRAWAL_FEE),
        "minWithdrawalAmount": _float(MIN_WITHDRAWAL_AMOUNT),
        "updatedAt": isoformat_vn(balance.updated_at),
    }


def list_bank_accounts(owner_id: int, db: Session) -> list[dict[str, Any]]:
    accounts = (
        db.query(OwnerBankAccount)
        .filter(OwnerBankAccount.owner_id == owner_id)
        .order_by(OwnerBankAccount.is_default.desc(), OwnerBankAccount.id.asc())
        .all()
    )
    return [_serialize_bank_account(account) for account in accounts]


def create_bank_account(owner_id: int, payload: dict[str, Any], db: Session) -> dict[str, Any]:
    should_default = bool(payload.get("isDefault"))
    existing_count = (
        db.query(func.count(OwnerBankAccount.id))
        .filter(OwnerBankAccount.owner_id == owner_id)
        .scalar()
        or 0
    )
    if existing_count == 0:
        should_default = True
    if should_default:
        db.query(OwnerBankAccount).filter(OwnerBankAccount.owner_id == owner_id).update(
            {"is_default": False},
            synchronize_session=False,
        )
    account = OwnerBankAccount(
        owner_id=owner_id,
        bank_code=(payload.get("bankCode") or "").strip().upper(),
        bank_name=(payload.get("bankName") or "").strip(),
        account_number=(payload.get("accountNumber") or "").strip(),
        account_holder_name=(payload.get("accountHolderName") or "").strip().upper(),
        is_default=should_default,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _serialize_bank_account(account)


def update_bank_account(
    owner_id: int,
    account_id: int,
    payload: dict[str, Any],
    db: Session,
) -> dict[str, Any]:
    account = (
        db.query(OwnerBankAccount)
        .filter(OwnerBankAccount.id == account_id, OwnerBankAccount.owner_id == owner_id)
        .first()
    )
    if not account:
        raise ValueError("Không tìm thấy tài khoản ngân hàng")

    if payload.get("bankCode"):
        account.bank_code = str(payload["bankCode"]).strip().upper()
    if payload.get("bankName"):
        account.bank_name = str(payload["bankName"]).strip()
    if payload.get("accountNumber"):
        account.account_number = str(payload["accountNumber"]).strip()
    if payload.get("accountHolderName"):
        account.account_holder_name = str(payload["accountHolderName"]).strip().upper()
    if payload.get("isDefault") is True:
        db.query(OwnerBankAccount).filter(OwnerBankAccount.owner_id == owner_id).update(
            {"is_default": False},
            synchronize_session=False,
        )
        account.is_default = True

    db.commit()
    db.refresh(account)
    return _serialize_bank_account(account)


def delete_bank_account(owner_id: int, account_id: int, db: Session) -> None:
    account = (
        db.query(OwnerBankAccount)
        .filter(OwnerBankAccount.id == account_id, OwnerBankAccount.owner_id == owner_id)
        .first()
    )
    if not account:
        raise ValueError("Không tìm thấy tài khoản ngân hàng")
    db.delete(account)
    db.commit()


def list_withdrawals(
    owner_id: int,
    db: Session,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    balance_payload = get_owner_balance_payload(owner_id, db)
    query = db.query(OwnerWithdrawal).filter(OwnerWithdrawal.owner_id == owner_id)
    start = _parse_date(date_from)
    end = _parse_date(date_to)
    if start:
        query = query.filter(OwnerWithdrawal.created_at >= datetime.combine(start, time.min))
    if end:
        query = query.filter(OwnerWithdrawal.created_at <= datetime.combine(end, time.max))
    if status and status != "all":
        query = query.filter(OwnerWithdrawal.status == status)

    withdrawals = query.order_by(OwnerWithdrawal.created_at.desc()).all()
    period_withdrawn = Decimal("0")
    period_count = 0
    for item in withdrawals:
        if item.status == WITHDRAWAL_STATUS_COMPLETED:
            period_withdrawn += _to_decimal(item.net_amount)
            period_count += 1

    return {
        "balance": balance_payload,
        "summary": {
            "periodWithdrawn": _float(period_withdrawn),
            "periodCount": period_count,
            "totalWithdrawn": balance_payload["lifetimeWithdrawn"],
            "processingAmount": balance_payload["processingAmount"],
            "processingCount": balance_payload["processingCount"],
        },
        "withdrawals": [_serialize_withdrawal(item) for item in withdrawals],
    }


def create_withdrawal(owner_id: int, payload: dict[str, Any], db: Session) -> dict[str, Any]:
    amount = _to_decimal(payload.get("amount"))
    if amount < MIN_WITHDRAWAL_AMOUNT:
        raise ValueError(f"Số tiền tối thiểu {_float(MIN_WITHDRAWAL_AMOUNT):,.0f} đ")

    balance = sync_owner_balance(owner_id, db)
    if amount > balance.available_balance:
        raise ValueError("Số dư khả dụng không đủ")

    bank_account_id = payload.get("bankAccountId")
    account = None
    if bank_account_id:
        account = (
            db.query(OwnerBankAccount)
            .filter(OwnerBankAccount.id == bank_account_id, OwnerBankAccount.owner_id == owner_id)
            .first()
        )
    else:
        account = (
            db.query(OwnerBankAccount)
            .filter(OwnerBankAccount.owner_id == owner_id, OwnerBankAccount.is_default.is_(True))
            .first()
        )
    if not account:
        raise ValueError("Vui lòng thêm tài khoản ngân hàng trước khi rút tiền")

    net_amount = amount - WITHDRAWAL_FEE
    if net_amount <= 0:
        raise ValueError("Số tiền rút quá thấp sau khi trừ phí")

    withdrawal = OwnerWithdrawal(
        owner_id=owner_id,
        bank_account_id=account.id,
        request_code=_next_withdrawal_code(db, owner_id),
        amount=amount,
        fee=WITHDRAWAL_FEE,
        net_amount=net_amount,
        status=WITHDRAWAL_STATUS_PROCESSING,
        note=(payload.get("note") or "").strip() or None,
    )
    db.add(withdrawal)
    db.commit()
    db.refresh(withdrawal)
    sync_owner_balance(owner_id, db)
    return _serialize_withdrawal(withdrawal, account)


def cancel_withdrawal(owner_id: int, withdrawal_id: int, db: Session) -> dict[str, Any]:
    withdrawal = (
        db.query(OwnerWithdrawal)
        .filter(OwnerWithdrawal.id == withdrawal_id, OwnerWithdrawal.owner_id == owner_id)
        .first()
    )
    if not withdrawal:
        raise ValueError("Không tìm thấy yêu cầu rút tiền")
    if withdrawal.status != WITHDRAWAL_STATUS_PROCESSING:
        raise ValueError("Chỉ có thể hủy yêu cầu đang xử lý")
    withdrawal.status = WITHDRAWAL_STATUS_CANCELLED
    withdrawal.updated_at = vn_now()
    db.commit()
    sync_owner_balance(owner_id, db)
    return _serialize_withdrawal(withdrawal)


def complete_withdrawal(owner_id: int, withdrawal_id: int, db: Session) -> dict[str, Any]:
    withdrawal = (
        db.query(OwnerWithdrawal)
        .filter(OwnerWithdrawal.id == withdrawal_id, OwnerWithdrawal.owner_id == owner_id)
        .first()
    )
    if not withdrawal:
        raise ValueError("Không tìm thấy yêu cầu rút tiền")
    if withdrawal.status != WITHDRAWAL_STATUS_PROCESSING:
        raise ValueError("Yêu cầu không ở trạng thái đang xử lý")
    withdrawal.status = WITHDRAWAL_STATUS_COMPLETED
    withdrawal.updated_at = vn_now()
    db.commit()
    sync_owner_balance(owner_id, db)
    return _serialize_withdrawal(withdrawal)


def _collect_cash_payments_for_day(
    db: Session,
    owner_id: int,
    parking_ids: list[int],
    target_date: date,
    *,
    parking_id: int | None = None,
) -> list[tuple[Payment, Booking]]:
    start, end = _day_bounds(target_date)
    reconciled_ids = _reconciled_payment_ids(db, owner_id)
    rows = _cash_payments_query(db, parking_ids).filter(
        Payment.paid_at >= start,
        Payment.paid_at <= end,
    )
    if parking_id:
        rows = rows.filter(Booking.parking_id == parking_id)
    result = []
    for payment, booking in rows.all():
        if int(payment.id) in reconciled_ids:
            continue
        result.append((payment, booking))
    return result


def list_cash_reconciliation(
    owner_id: int,
    db: Session,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    parking_id: int | None = None,
    status: str | None = None,
    employee_id: int | None = None,
) -> dict[str, Any]:
    parking_ids = _owner_parking_ids(owner_id, db)
    query = db.query(CashReconciliationSlip).filter(CashReconciliationSlip.owner_id == owner_id)
    start = _parse_date(date_from)
    end = _parse_date(date_to)
    if start:
        query = query.filter(CashReconciliationSlip.reconciliation_date >= start)
    if end:
        query = query.filter(CashReconciliationSlip.reconciliation_date <= end)
    if parking_id:
        query = query.filter(CashReconciliationSlip.parking_id == parking_id)
    if employee_id:
        query = query.filter(CashReconciliationSlip.employee_id == employee_id)
    if status and status != "all":
        query = query.filter(CashReconciliationSlip.status == status)

    slips = query.order_by(CashReconciliationSlip.reconciliation_date.desc(), CashReconciliationSlip.id.desc()).all()
    parking_map = {
        int(lot.id): lot
        for lot in db.query(ParkingLot).filter(ParkingLot.id.in_(parking_ids)).all()
    } if parking_ids else {}

    total_collected = sum(_to_decimal(slip.total_collected) for slip in slips)
    total_deposited = sum(_to_decimal(slip.deposited_amount) for slip in slips)
    total_variance = sum(_to_decimal(slip.variance) for slip in slips)
    status_counts = defaultdict(int)
    for slip in slips:
        status_counts[slip.status] += 1

    employees = (
        db.query(User)
        .filter(User.owner_id == owner_id, User.role == "employee")
        .order_by(User.name.asc())
        .all()
    )

    return {
        "summary": {
            "totalCollected": _float(total_collected),
            "totalDeposited": _float(total_deposited),
            "notDeposited": _float(max(total_collected - total_deposited, Decimal("0"))),
            "variance": _float(total_variance),
            "slipCount": len(slips),
            "depositedCount": status_counts[SLIP_STATUS_DEPOSITED],
            "pendingCount": status_counts[SLIP_STATUS_PENDING],
            "varianceCount": status_counts[SLIP_STATUS_VARIANCE],
        },
        "slips": [
            _serialize_slip(slip, parking_map.get(int(slip.parking_id)), slip.employee)
            for slip in slips
        ],
        "employees": [{"id": employee.id, "name": employee.name} for employee in employees],
        "parkingLots": [
            {"id": lot.id, "name": lot.name}
            for lot in parking_map.values()
        ],
    }


def get_cash_reconciliation_slip(owner_id: int, slip_id: int, db: Session) -> dict[str, Any]:
    slip = (
        db.query(CashReconciliationSlip)
        .options(
            joinedload(CashReconciliationSlip.items)
            .joinedload(CashReconciliationItem.booking)
            .joinedload(Booking.user),
            joinedload(CashReconciliationSlip.parking_lot),
            joinedload(CashReconciliationSlip.employee),
        )
        .filter(CashReconciliationSlip.id == slip_id, CashReconciliationSlip.owner_id == owner_id)
        .first()
    )
    if not slip:
        raise ValueError("Không tìm thấy phiếu đối soát")
    items = []
    for item in slip.items:
        booking = item.booking
        payment = item.payment
        items.append({
            "id": item.id,
            "paymentId": item.payment_id,
            "bookingId": item.booking_id,
            "bookingCode": f"BK-{item.booking_id}",
            "amount": _float(item.amount),
            "paidAt": isoformat_vn(payment.paid_at or payment.created_at) if payment else None,
            "licensePlate": booking.user.vehicle_plate if booking and booking.user else None,
        })
    payload = _serialize_slip(slip, slip.parking_lot, slip.employee)
    payload["items"] = items
    return payload


def create_cash_reconciliation_slip(owner_id: int, payload: dict[str, Any], db: Session) -> dict[str, Any]:
    parking_ids = _owner_parking_ids(owner_id, db)
    if not parking_ids:
        raise ValueError("Owner chưa được gán bãi xe")

    parking_id = int(payload["parkingId"])
    if parking_id not in parking_ids:
        raise ValueError("Bãi xe không thuộc quyền quản lý")

    target_date = _parse_date(payload.get("date"))
    if not target_date:
        raise ValueError("Ngày đối soát không hợp lệ")

    payments = _collect_cash_payments_for_day(
        db,
        owner_id,
        parking_ids,
        target_date,
        parking_id=parking_id,
    )
    if not payments:
        raise ValueError("Không có giao dịch tiền mặt chưa đối soát trong ngày đã chọn")

    employee_id = payload.get("employeeId")
    if employee_id:
        employee = (
            db.query(User)
            .filter(User.id == employee_id, User.owner_id == owner_id, User.role == "employee")
            .first()
        )
        if not employee:
            raise ValueError("Nhân viên không hợp lệ")
    elif payments:
        employee_id = _infer_employee_for_booking(db, int(payments[0][1].id), parking_id)

    total_collected = sum(_payment_gross(payment) for payment, _booking in payments)
    deposited_amount = _to_decimal(payload.get("depositedAmount") or 0)
    variance = deposited_amount - total_collected
    status = payload.get("status") or _slip_status_from_amounts(total_collected, deposited_amount)

    slip = CashReconciliationSlip(
        owner_id=owner_id,
        parking_id=parking_id,
        employee_id=employee_id,
        slip_code=_next_slip_code(db, owner_id, target_date),
        reconciliation_date=target_date,
        total_collected=total_collected,
        deposited_amount=deposited_amount,
        variance=variance,
        status=status,
        note=(payload.get("note") or "").strip() or None,
    )
    db.add(slip)
    db.flush()

    for payment, booking in payments:
        db.add(
            CashReconciliationItem(
                slip_id=slip.id,
                payment_id=payment.id,
                booking_id=booking.id,
                amount=_payment_gross(payment),
            )
        )

    db.commit()
    db.refresh(slip)
    return get_cash_reconciliation_slip(owner_id, slip.id, db)


def update_cash_reconciliation_slip(
    owner_id: int,
    slip_id: int,
    payload: dict[str, Any],
    db: Session,
) -> dict[str, Any]:
    slip = (
        db.query(CashReconciliationSlip)
        .filter(CashReconciliationSlip.id == slip_id, CashReconciliationSlip.owner_id == owner_id)
        .first()
    )
    if not slip:
        raise ValueError("Không tìm thấy phiếu đối soát")

    if "depositedAmount" in payload:
        slip.deposited_amount = _to_decimal(payload.get("depositedAmount"))
    if payload.get("note") is not None:
        slip.note = str(payload.get("note") or "").strip() or None
    if payload.get("employeeId"):
        employee = (
            db.query(User)
            .filter(
                User.id == int(payload["employeeId"]),
                User.owner_id == owner_id,
                User.role == "employee",
            )
            .first()
        )
        if not employee:
            raise ValueError("Nhân viên không hợp lệ")
        slip.employee_id = employee.id

    slip.variance = _to_decimal(slip.deposited_amount) - _to_decimal(slip.total_collected)
    slip.status = payload.get("status") or _slip_status_from_amounts(
        _to_decimal(slip.total_collected),
        _to_decimal(slip.deposited_amount),
    )
    slip.updated_at = vn_now()
    db.commit()
    return get_cash_reconciliation_slip(owner_id, slip.id, db)


def auto_generate_cash_slips(owner_id: int, db: Session, *, date_from: str | None, date_to: str | None) -> dict[str, Any]:
    parking_ids = _owner_parking_ids(owner_id, db)
    if not parking_ids:
        return {"created": 0, "slips": []}

    start = _parse_date(date_from) or vn_now().date()
    end = _parse_date(date_to) or start
    if end < start:
        start, end = end, start

    created: list[dict[str, Any]] = []
    current = start
    while current <= end:
        grouped: dict[tuple[int, int | None], list[tuple[Payment, Booking]]] = defaultdict(list)
        for payment, booking in _collect_cash_payments_for_day(db, owner_id, parking_ids, current):
            employee_id = _infer_employee_for_booking(db, int(booking.id), int(booking.parking_id))
            grouped[(int(booking.parking_id), employee_id)].append((payment, booking))
        for (parking_id, employee_id), rows in grouped.items():
            slip = CashReconciliationSlip(
                owner_id=owner_id,
                parking_id=parking_id,
                employee_id=employee_id,
                slip_code=_next_slip_code(db, owner_id, current),
                reconciliation_date=current,
                total_collected=sum(_payment_gross(payment) for payment, _booking in rows),
                deposited_amount=Decimal("0"),
                variance=Decimal("0") - sum(_payment_gross(payment) for payment, _booking in rows),
                status=SLIP_STATUS_PENDING,
            )
            db.add(slip)
            db.flush()
            for payment, booking in rows:
                db.add(
                    CashReconciliationItem(
                        slip_id=slip.id,
                        payment_id=payment.id,
                        booking_id=booking.id,
                        amount=_payment_gross(payment),
                    )
                )
            created.append(_serialize_slip(slip))
        current = date.fromordinal(current.toordinal() + 1)

    db.commit()
    return {"created": len(created), "slips": created}
