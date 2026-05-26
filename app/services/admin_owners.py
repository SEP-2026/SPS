from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Booking, District, OwnerBankAccount, OwnerParking, ParkingLot, ParkingSlot, Payment, User
from app.services.revenue_settings import get_commission_rate_percent, split_revenue
from app.utils.timezone import isoformat_vn, vn_now, vn_today


def _parse_date(value: str | None, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return fallback


def _growth_percent(current: float, previous: float) -> float:
    if previous <= 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 1)


def _owner_parking_maps(db: Session) -> tuple[dict[int, list[int]], dict[int, ParkingLot]]:
    parking_by_owner: dict[int, list[int]] = defaultdict(list)
    lots_by_id: dict[int, ParkingLot] = {}
    for lot in db.query(ParkingLot).all():
        lots_by_id[int(lot.id)] = lot
    for row in db.query(OwnerParking.owner_id, OwnerParking.parking_id).all():
        parking_by_owner[int(row.owner_id)].append(int(row.parking_id))
    return parking_by_owner, lots_by_id


def _district_maps(db: Session) -> tuple[dict[int, str], dict[int, int | None]]:
    districts = {int(item.id): item.name for item in db.query(District).all()}
    lot_district: dict[int, int | None] = {}
    for lot in db.query(ParkingLot).all():
        lot_district[int(lot.id)] = int(lot.district_id) if lot.district_id else None
    return districts, lot_district


def _resolve_district_name(
    owner: User,
    parking_ids: list[int],
    districts: dict[int, str],
    lot_district: dict[int, int | None],
    lots_by_id: dict[int, ParkingLot],
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
        lot_name = (lots_by_id.get(parking_id).name if lots_by_id.get(parking_id) else "").lower()
        for district_id, district_name in districts.items():
            token = district_name.lower().replace("quận", "quan").strip()
            if token and token in lot_name:
                return district_name, district_id
    return "Khác", None


def _owner_display_status(owner: User, parking_ids: list[int], lots_by_id: dict[int, ParkingLot]) -> str:
    if owner.is_active == 0 or (owner.status or "").lower() in {"banned", "suspended"}:
        return "locked"
    if not parking_ids:
        return "pending"
    active_flags = [lots_by_id[pid].is_active for pid in parking_ids if pid in lots_by_id]
    if not active_flags:
        return "pending"
    if any(flag == 1 for flag in active_flags):
        return "active"
    return "pending"


def _payment_gross(payment: Payment) -> float:
    return float(payment.amount or 0) + float(payment.overtime_fee or 0)


def _payments_in_range(
    db: Session,
    parking_ids: list[int],
    start: date,
    end: date,
) -> list[Payment]:
    if not parking_ids:
        return []
    return (
        db.query(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .filter(
            Booking.parking_id.in_(parking_ids),
            Payment.payment_status == "paid",
        )
        .all()
    )


def _sum_revenue_for_payments(payments: list[Payment], start: date, end: date) -> float:
    total = 0.0
    for payment in payments:
        moment = payment.paid_at or payment.created_at
        if not moment:
            continue
        day = moment.date()
        if start <= day <= end:
            total += split_revenue(_payment_gross(payment))["gross"]
    return round(total, 2)


def build_owner_management(
    db: Session,
    *,
    search: str | None = None,
    status: str | None = None,
    district_id: int | None = None,
    created_sort: str = "newest",
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    today = vn_today()
    range_end = today
    range_start = today - timedelta(days=6)
    prev_end = range_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=6)

    commission_rate = get_commission_rate_percent()
    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    districts, lot_district = _district_maps(db)

    slot_counts: dict[int, int] = defaultdict(int)
    for row in db.query(ParkingSlot.parking_id, func.count(ParkingSlot.id)).group_by(ParkingSlot.parking_id).all():
        slot_counts[int(row[0])] = int(row[1])

    employee_counts: dict[int, int] = defaultdict(int)
    for row in db.query(User.owner_id, func.count(User.id)).filter(User.role == "employee", User.owner_id.isnot(None)).group_by(User.owner_id).all():
        if row[0]:
            employee_counts[int(row[0])] = int(row[1])

    owners = db.query(User).filter(User.role == "owner").order_by(User.id.asc()).all()
    all_rows: list[dict[str, Any]] = []

    for owner in owners:
        owner_id = int(owner.id)
        parking_ids = parking_by_owner.get(owner_id, [])
        district_name, resolved_district_id = _resolve_district_name(
            owner, parking_ids, districts, lot_district, lots_by_id,
        )
        display_status = _owner_display_status(owner, parking_ids, lots_by_id)
        payments = _payments_in_range(db, parking_ids, prev_start, range_end)
        revenue_7d = _sum_revenue_for_payments(payments, range_start, range_end)
        revenue_prev_7d = _sum_revenue_for_payments(payments, prev_start, prev_end)
        commission_7d = round(revenue_7d * (commission_rate / 100), 2)

        all_rows.append({
            "id": owner_id,
            "name": owner.name,
            "email": owner.email,
            "phone": owner.phone or "",
            "district": district_name,
            "districtId": resolved_district_id,
            "managedAreas": [district_name] if district_name else [],
            "parkingLotCount": len(parking_ids),
            "parkingLots": [
                {"id": pid, "name": lots_by_id[pid].name}
                for pid in parking_ids
                if pid in lots_by_id
            ],
            "revenue7d": revenue_7d,
            "revenue7dChangePercent": _growth_percent(revenue_7d, revenue_prev_7d),
            "commission7d": commission_7d,
            "commissionRate": commission_rate,
            "status": display_status,
            "accountStatus": owner.status or "active",
            "createdAt": isoformat_vn(owner.created_at),
            "isVerified": owner.is_active == 1 and display_status == "active",
            "slotCount": sum(slot_counts.get(pid, 0) for pid in parking_ids),
            "employeeCount": employee_counts.get(owner_id, 0),
        })

    if district_id is not None:
        all_rows = [row for row in all_rows if row.get("districtId") == district_id]
    if status and status != "all":
        all_rows = [row for row in all_rows if row["status"] == status]
    if search and search.strip():
        token = search.strip().lower()
        all_rows = [
            row for row in all_rows
            if token in f"{row['name']} {row['email']} {row['phone']} {row['district']}".lower()
        ]

    reverse = created_sort != "oldest"
    all_rows.sort(key=lambda row: row.get("createdAt") or "", reverse=reverse)

    total = len(all_rows)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start_index = (safe_page - 1) * safe_size
    items = all_rows[start_index : start_index + safe_size]

    status_counts = {"active": 0, "pending": 0, "locked": 0}
    for row in all_rows:
        key = row["status"]
        if key in status_counts:
            status_counts[key] += 1

    total_revenue_7d = round(sum(row["revenue7d"] for row in all_rows), 2)
    week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)
    owners_this_week = sum(1 for o in owners if o.created_at and week_ago <= o.created_at.date() <= today)
    owners_last_week = sum(
        1 for o in owners
        if o.created_at and two_weeks_ago <= o.created_at.date() < week_ago
    )

    return {
        "summary": {
            "totalOwners": len(all_rows),
            "activeOwners": status_counts["active"],
            "pendingOwners": status_counts["pending"],
            "lockedOwners": status_counts["locked"],
            "totalRevenue7d": total_revenue_7d,
            "trends": {
                "totalOwnersChangePercent": _growth_percent(len(all_rows), max(len(all_rows) - owners_this_week, 0)),
                "activeChangePercent": _growth_percent(status_counts["active"], max(status_counts["active"] - 1, 0)),
                "pendingChangePercent": _growth_percent(status_counts["pending"], max(status_counts["pending"] - 1, 0)),
                "lockedChangePercent": _growth_percent(status_counts["locked"], max(status_counts["locked"] - 1, 0)),
                "revenueChangePercent": 0.0,
                "newOwnersThisWeek": owners_this_week,
            },
        },
        "districts": [{"id": did, "name": name} for did, name in sorted(districts.items(), key=lambda item: item[1])],
        "commissionRate": commission_rate,
        "items": items,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_size,
            "total": total,
            "totalPages": max(1, (total + safe_size - 1) // safe_size),
        },
        "generatedAt": isoformat_vn(vn_now(), fallback_now=True),
    }


def build_owner_detail(db: Session, owner_id: int) -> dict[str, Any]:
    owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
    if not owner:
        return {}

    today = vn_today()
    range_end = today
    range_start = today - timedelta(days=6)
    commission_rate = get_commission_rate_percent()

    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    districts, lot_district = _district_maps(db)
    parking_ids = parking_by_owner.get(int(owner.id), [])
    district_name, district_id = _resolve_district_name(
        owner, parking_ids, districts, lot_district, lots_by_id,
    )
    display_status = _owner_display_status(owner, parking_ids, lots_by_id)

    slot_count = (
        db.query(func.count(ParkingSlot.id))
        .filter(ParkingSlot.parking_id.in_(parking_ids))
        .scalar()
        if parking_ids
        else 0
    )
    employee_count = (
        db.query(func.count(User.id))
        .filter(User.role == "employee", User.owner_id == owner.id)
        .scalar()
        or 0
    )

    payments = _payments_in_range(db, parking_ids, range_start, range_end)
    daily_chart: dict[date, float] = defaultdict(float)
    for payment in payments:
        moment = payment.paid_at or payment.created_at
        if not moment:
            continue
        day = moment.date()
        if range_start <= day <= range_end:
            daily_chart[day] += split_revenue(_payment_gross(payment))["gross"]

    chart_series = []
    cursor = range_start
    while cursor <= range_end:
        chart_series.append({
            "label": cursor.strftime("%d/%m"),
            "revenue": round(daily_chart.get(cursor, 0.0), 2),
        })
        cursor += timedelta(days=1)

    revenue_7d = round(sum(item["revenue"] for item in chart_series), 2)
    commission_7d = round(revenue_7d * (commission_rate / 100), 2)
    retention_rate = 90
    if parking_ids:
        active_lots = sum(1 for pid in parking_ids if lots_by_id.get(pid) and lots_by_id[pid].is_active == 1)
        retention_rate = int(round((active_lots / len(parking_ids)) * 100))

    bank = (
        db.query(OwnerBankAccount)
        .filter(OwnerBankAccount.owner_id == owner.id)
        .order_by(OwnerBankAccount.is_default.desc(), OwnerBankAccount.id.asc())
        .first()
    )
    payment_method = "Chưa cấu hình"
    if bank:
        payment_method = f"Chuyển khoản • {bank.bank_name}"

    parking_lots = [
        {
            "id": pid,
            "name": lots_by_id[pid].name,
            "address": lots_by_id[pid].address,
            "status": "active" if lots_by_id[pid].is_active == 1 else "locked",
            "slotCount": db.query(func.count(ParkingSlot.id)).filter(ParkingSlot.parking_id == pid).scalar() or 0,
        }
        for pid in parking_ids
        if pid in lots_by_id
    ]

    return {
        "id": int(owner.id),
        "name": owner.name,
        "email": owner.email,
        "phone": owner.phone or "",
        "address": parking_lots[0]["address"] if parking_lots else "Chưa cập nhật",
        "district": district_name,
        "districtId": district_id,
        "status": display_status,
        "isVerified": owner.is_active == 1 and display_status == "active",
        "createdAt": isoformat_vn(owner.created_at),
        "stats": {
            "parkingLotCount": len(parking_ids),
            "slotCount": int(slot_count or 0),
            "employeeCount": int(employee_count),
            "revenue7d": revenue_7d,
            "commission7d": commission_7d,
            "retentionRate": retention_rate,
        },
        "commissionRate": commission_rate,
        "paymentMethod": payment_method,
        "contractStatus": "Còn hiệu lực 12 tháng" if display_status == "active" else "Đang xem xét",
        "revenueChart": chart_series,
        "parkingLots": parking_lots,
    }
