from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.models import Booking, District, OwnerBalance, OwnerBankAccount, OwnerParking, OwnerWithdrawal, ParkingLot, Payment, User
from app.services import owner_finance
from app.services.revenue_settings import ADMIN_RUNTIME_SETTINGS, get_commission_rate_percent, split_revenue
from app.utils.timezone import isoformat_vn, vn_now, vn_today

WITHDRAWAL_STATUS_COMPLETED = owner_finance.WITHDRAWAL_STATUS_COMPLETED


def _parse_date(value: str | None, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return fallback


def _payment_time(payment: Payment) -> datetime | None:
    return payment.paid_at or payment.created_at


def _in_range(moment: datetime | None, start: date, end: date) -> bool:
    if not moment:
        return False
    day = moment.date() if isinstance(moment, datetime) else moment
    return start <= day <= end


def _owner_parking_maps(db: Session) -> tuple[dict[int, list[int]], dict[int, int]]:
    parking_by_owner: dict[int, list[int]] = defaultdict(list)
    owner_by_parking: dict[int, int] = {}
    rows = db.query(OwnerParking.owner_id, OwnerParking.parking_id).all()
    for owner_id, parking_id in rows:
        parking_by_owner[int(owner_id)].append(int(parking_id))
        owner_by_parking[int(parking_id)] = int(owner_id)
    return parking_by_owner, owner_by_parking


def _district_maps(db: Session) -> tuple[dict[int, str], dict[int, int | None], dict[int, str]]:
    districts = {int(item.id): item.name for item in db.query(District).all()}
    lot_district: dict[int, int | None] = {}
    lot_name: dict[int, str] = {}
    for lot in db.query(ParkingLot).all():
        lot_district[int(lot.id)] = int(lot.district_id) if lot.district_id else None
        lot_name[int(lot.id)] = lot.name or ""
    return districts, lot_district, lot_name


def _resolve_district_name(
    owner: User,
    parking_ids: list[int],
    districts: dict[int, str],
    lot_district: dict[int, int | None],
    lot_name: dict[int, str],
) -> tuple[str, int | None]:
    if owner.managed_district_id and int(owner.managed_district_id) in districts:
        return districts[int(owner.managed_district_id)], int(owner.managed_district_id)

    counts: dict[int, int] = defaultdict(int)
    for parking_id in parking_ids:
        district_id = lot_district.get(parking_id)
        if district_id:
            counts[int(district_id)] += 1

    if counts:
        top_id = max(counts.items(), key=lambda item: item[1])[0]
        return districts.get(top_id, "Khác"), top_id

    for parking_id in parking_ids:
        name = (lot_name.get(parking_id) or "").lower()
        for district_id, district_name in districts.items():
            token = district_name.lower().replace("quận", "quan").strip()
            if token and token in name:
                return district_name, district_id

    return "Khác", None


def _growth_percent(current: float, previous: float) -> float:
    if previous <= 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 1)


def _payment_status_label(paid: float, remaining: float, earned: float) -> str:
    if earned <= 0:
        return "unpaid"
    if remaining <= 0 and paid > 0:
        return "paid"
    if paid > 0:
        return "partial"
    return "unpaid"


def build_admin_commissions(
    db: Session,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    district_id: int | None = None,
    payment_status: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    today = vn_today()
    range_end = _parse_date(date_to, today)
    range_start = _parse_date(date_from, range_end - timedelta(days=15))
    if range_start > range_end:
        range_start, range_end = range_end, range_start

    period_days = (range_end - range_start).days + 1
    previous_end = range_start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=period_days - 1)

    commission_rate = get_commission_rate_percent()
    parking_by_owner, owner_by_parking = _owner_parking_maps(db)
    districts, lot_district, lot_name = _district_maps(db)

    owners = db.query(User).filter(User.role == "owner").order_by(User.id.asc()).all()
    owner_rows: dict[int, dict[str, Any]] = {}
    for owner in owners:
        owner_id = int(owner.id)
        parking_ids = parking_by_owner.get(owner_id, [])
        district_name, resolved_district_id = _resolve_district_name(
            owner,
            parking_ids,
            districts,
            lot_district,
            lot_name,
        )
        lot_labels = [lot_name.get(pid, f"Bãi #{pid}") for pid in parking_ids[:3]]
        owner_rows[owner_id] = {
            "id": owner_id,
            "name": owner.name,
            "email": owner.email,
            "subtitle": f"{', '.join(lot_labels) if lot_labels else 'Chưa gán bãi'}",
            "district": district_name,
            "districtId": resolved_district_id,
            "status": "active" if (owner.is_active == 1 and (owner.status or "").lower() != "banned") else "suspended",
            "revenue": 0.0,
            "previousRevenue": 0.0,
            "commissionAmount": 0.0,
            "paidAmount": 0.0,
            "remainingAmount": 0.0,
            "commissionRate": commission_rate,
            "paymentStatus": "unpaid",
            "parkingLots": lot_labels,
        }

    payments = db.query(Payment).filter(Payment.payment_status == "paid").all()
    booking_map = {
        int(booking.id): booking
        for booking in db.query(Booking).options(joinedload(Booking.parking_lot)).all()
    }

    daily_totals: dict[date, dict[str, float]] = defaultdict(lambda: {"revenue": 0.0, "commission": 0.0})
    district_commission: dict[str, float] = defaultdict(float)

    for payment in payments:
        booking = booking_map.get(int(payment.booking_id)) if payment.booking_id else None
        if not booking or not booking.parking_id:
            continue
        parking_id = int(booking.parking_id)
        owner_id = owner_by_parking.get(parking_id)
        if not owner_id or owner_id not in owner_rows:
            continue

        gross = float(payment.amount or 0) + float(payment.overtime_fee or 0)
        split = split_revenue(gross)
        paid_at = _payment_time(payment)
        if not paid_at:
            continue

        payment_day = paid_at.date()
        if _in_range(paid_at, range_start, range_end):
            owner_rows[owner_id]["revenue"] += split["gross"]
            owner_rows[owner_id]["commissionAmount"] += split["commission"]
            daily_totals[payment_day]["revenue"] += split["gross"]
            daily_totals[payment_day]["commission"] += split["commission"]
            district_label = owner_rows[owner_id]["district"]
            district_commission[district_label] += split["commission"]

        if _in_range(paid_at, previous_start, previous_end):
            owner_rows[owner_id]["previousRevenue"] += split["gross"]

    withdrawals = (
        db.query(OwnerWithdrawal)
        .options(joinedload(OwnerWithdrawal.owner))
        .order_by(OwnerWithdrawal.created_at.desc())
        .all()
    )

    recent_payments: list[dict[str, Any]] = []
    paid_in_period_total = 0.0

    for withdrawal in withdrawals:
        owner_id = int(withdrawal.owner_id)
        net_amount = float(withdrawal.net_amount or 0)
        created = withdrawal.updated_at or withdrawal.created_at
        if owner_id in owner_rows and withdrawal.status == WITHDRAWAL_STATUS_COMPLETED:
            if created and _in_range(created, range_start, range_end):
                owner_rows[owner_id]["paidAmount"] += net_amount
                paid_in_period_total += net_amount

        if withdrawal.status == WITHDRAWAL_STATUS_COMPLETED and len(recent_payments) < 8:
            recent_payments.append(
                {
                    "id": withdrawal.id,
                    "code": withdrawal.request_code,
                    "ownerName": withdrawal.owner.name if withdrawal.owner else "Đối tác",
                    "amount": net_amount,
                    "time": isoformat_vn(created, fallback_now=True),
                    "status": "paid",
                }
            )

    remaining_total = 0.0
    active_partners = 0
    for owner_id, row in owner_rows.items():
        balance = owner_finance.sync_owner_balance(owner_id, db)
        remaining = float(balance.available_balance or 0)
        row["remainingAmount"] = remaining
        remaining_total += remaining
        if row["revenue"] > 0:
            active_partners += 1
        row["revenueChangePercent"] = _growth_percent(row["revenue"], row["previousRevenue"])
        row["paymentStatus"] = _payment_status_label(
            row["paidAmount"],
            remaining,
            row["revenue"] - row["commissionAmount"],
        )

    partners = list(owner_rows.values())
    if district_id is not None:
        partners = [item for item in partners if item.get("districtId") == district_id]
    if payment_status and payment_status != "all":
        partners = [item for item in partners if item["paymentStatus"] == payment_status]
    if search and search.strip():
        token = search.strip().lower()
        partners = [
            item
            for item in partners
            if token in f"{item['name']} {item['email']} {item['district']} {' '.join(item['parkingLots'])}".lower()
        ]

    partners.sort(key=lambda item: item["commissionAmount"], reverse=True)
    total_count = len(partners)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start_index = (safe_page - 1) * safe_size
    paginated = partners[start_index : start_index + safe_size]

    total_revenue = round(sum(item["revenue"] for item in owner_rows.values()), 2)
    total_commission = round(sum(item["commissionAmount"] for item in owner_rows.values()), 2)

    previous_revenue = 0.0
    previous_commission = 0.0
    for payment in payments:
        paid_at = _payment_time(payment)
        if not paid_at or not _in_range(paid_at, previous_start, previous_end):
            continue
        gross = float(payment.amount or 0) + float(payment.overtime_fee or 0)
        split = split_revenue(gross)
        previous_revenue += split["gross"]
        previous_commission += split["commission"]

    chart_series = []
    cursor = range_start
    while cursor <= range_end:
        bucket = daily_totals.get(cursor, {"revenue": 0.0, "commission": 0.0})
        chart_series.append(
            {
                "label": cursor.strftime("%d/%m"),
                "revenue": round(bucket["revenue"], 2),
                "commission": round(bucket["commission"], 2),
            }
        )
        cursor += timedelta(days=1)

    district_total = sum(district_commission.values()) or 1.0
    district_distribution = []
    sorted_districts = sorted(district_commission.items(), key=lambda item: item[1], reverse=True)
    top_items = sorted_districts[:5]
    other_amount = sum(amount for _, amount in sorted_districts[5:])
    for name, amount in top_items:
        district_distribution.append(
            {
                "label": name,
                "amount": round(amount, 2),
                "percent": round((amount / district_total) * 100, 1),
            }
        )
    if other_amount > 0:
        district_distribution.append(
            {
                "label": "Khác",
                "amount": round(other_amount, 2),
                "percent": round((other_amount / district_total) * 100, 1),
            }
        )

    new_partners = sum(
        1
        for owner in owners
        if owner.created_at and _in_range(owner.created_at, range_start, range_end)
    )

    return {
        "range": {
            "dateFrom": range_start.isoformat(),
            "dateTo": range_end.isoformat(),
            "label": f"{range_start.strftime('%d/%m/%Y')} - {range_end.strftime('%d/%m/%Y')}",
        },
        "summary": {
            "totalRevenue": total_revenue,
            "totalCommission": total_commission,
            "paidToPartners": round(paid_in_period_total, 2),
            "remainingToPay": round(remaining_total, 2),
            "activePartners": active_partners,
            "totalPartners": len(owner_rows),
            "commissionRate": commission_rate,
            "trends": {
                "revenueChangePercent": _growth_percent(total_revenue, previous_revenue),
                "commissionChangePercent": _growth_percent(total_commission, previous_commission),
                "paidChangePercent": 0.0,
                "remainingChangePercent": 0.0,
                "activePartnersDelta": new_partners,
            },
        },
        "charts": {
            "revenueCommission": chart_series,
            "districtDistribution": district_distribution,
        },
        "paymentOverview": {
            "remainingToPay": round(remaining_total, 2),
            "paymentCycle": "Thanh toán đối tác 2 tuần/lần",
            "expectedPaymentDate": (range_end + timedelta(days=4)).strftime("%d/%m/%Y"),
            "paymentMethod": "Chuyển khoản ngân hàng",
            "supportEmail": ADMIN_RUNTIME_SETTINGS.get("supportEmail", "admin@smartparking.vn"),
        },
        "recentPayments": recent_payments,
        "districts": [{"id": did, "name": name} for did, name in sorted(districts.items(), key=lambda item: item[1])],
        "partners": {
            "items": paginated,
            "page": safe_page,
            "pageSize": safe_size,
            "total": total_count,
            "totalPages": max(1, (total_count + safe_size - 1) // safe_size),
        },
        "generatedAt": isoformat_vn(vn_now(), fallback_now=True),
    }


def process_partner_payouts(db: Session, owner_ids: list[int] | None = None) -> dict[str, Any]:
    query = db.query(User).filter(User.role == "owner", User.is_active == 1)
    if owner_ids:
        query = query.filter(User.id.in_(owner_ids))
    owners = query.all()

    processed = []
    skipped = []
    for owner in owners:
        owner_id = int(owner.id)
        balance = owner_finance.sync_owner_balance(owner_id, db)
        available = float(balance.available_balance or 0)
        if available < float(owner_finance.MIN_WITHDRAWAL_AMOUNT):
            skipped.append({"ownerId": owner_id, "reason": "Số dư khả dụng chưa đủ ngưỡng rút"})
            continue

        account = (
            db.query(OwnerBankAccount)
            .filter(OwnerBankAccount.owner_id == owner_id)
            .order_by(OwnerBankAccount.is_default.desc(), OwnerBankAccount.id.asc())
            .first()
        )
        if not account:
            skipped.append({"ownerId": owner_id, "reason": "Chưa có tài khoản ngân hàng"})
            continue

        try:
            withdrawal = owner_finance.create_withdrawal(
                owner_id,
                {
                    "amount": available,
                    "bankAccountId": account.id,
                    "note": "Admin thanh toán hoa hồng/đối tác",
                },
                db,
            )
            completed = owner_finance.complete_withdrawal(owner_id, withdrawal["id"], db)
            processed.append(
                {
                    "ownerId": owner_id,
                    "ownerName": owner.name,
                    "amount": completed["netAmount"],
                    "requestCode": completed["requestCode"],
                }
            )
        except ValueError as exc:
            skipped.append({"ownerId": owner_id, "reason": str(exc)})

    return {
        "message": f"Đã xử lý {len(processed)} khoản thanh toán",
        "processed": processed,
        "skipped": skipped,
    }
