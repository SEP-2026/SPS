from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Booking, District, OwnerParking, ParkingLot, ParkingPrice, ParkingSlot, Payment, User
from app.services.admin_owners import _district_maps, _payment_gross, _payments_in_range, _sum_revenue_for_payments
from app.services.revenue_settings import split_revenue
from app.utils.timezone import isoformat_vn, vn_now, vn_today


def _growth_percent(current: float, previous: float) -> float:
    if previous <= 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 1)


def _month_bounds(reference: date) -> tuple[date, date, date, date]:
    first_this = reference.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    first_prev = last_prev.replace(day=1)
    return first_this, reference, first_prev, last_prev


def _lot_status(lot: ParkingLot) -> str:
    if lot.is_active == 1:
        return "active"
    return "locked"


def _lot_status_label(status: str) -> str:
    if status == "active":
        return "Hoạt động"
    if status == "locked":
        return "Ngừng hoạt động"
    return "Tạm ngưng"


def _slot_counts(db: Session) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = defaultdict(lambda: {"total": 0, "occupied": 0})
    for row in db.query(ParkingSlot.parking_id, ParkingSlot.status, func.count(ParkingSlot.id)).group_by(
        ParkingSlot.parking_id, ParkingSlot.status
    ).all():
        lot_id = int(row[0] or 0)
        if not lot_id:
            continue
        total = int(row[2])
        counts[lot_id]["total"] += total
        if row[1] in {"reserved", "occupied", "in_use"}:
            counts[lot_id]["occupied"] += total
    return counts


def _monthly_revenue_for_lots(db: Session, parking_ids: list[int], month_start: date, month_end: date) -> float:
    if not parking_ids:
        return 0.0
    payments = (
        db.query(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .filter(
            Booking.parking_id.in_(parking_ids),
            Payment.payment_status == "paid",
        )
        .all()
    )
    total = 0.0
    for payment in payments:
        moment = payment.paid_at or payment.created_at
        if not moment:
            continue
        day = moment.date()
        if month_start <= day <= month_end:
            total += split_revenue(_payment_gross(payment))["gross"]
    return round(total, 2)


def _serialize_lot_row(
    lot: ParkingLot,
    *,
    districts: dict[int, str],
    owner_by_lot: dict[int, User],
    slot_counts: dict[int, dict[str, int]],
    prices: dict[int, ParkingPrice],
    monthly_revenue: float,
    monthly_revenue_prev: float,
) -> dict[str, Any]:
    lot_id = int(lot.id)
    counts = slot_counts.get(lot_id, {"total": 0, "occupied": 0})
    total_slots = counts["total"]
    occupied = counts["occupied"]
    occupancy = int(round((occupied / total_slots) * 100)) if total_slots > 0 else 0
    owner = owner_by_lot.get(lot_id)
    price = prices.get(lot_id)
    district_name = districts.get(int(lot.district_id)) if lot.district_id else "—"
    status = _lot_status(lot)

    return {
        "id": lot_id,
        "code": f"SP{lot_id:04d}",
        "name": lot.name,
        "address": lot.address,
        "phone": lot.phone or "",
        "districtId": int(lot.district_id) if lot.district_id else None,
        "district": district_name,
        "ownerId": int(owner.id) if owner else None,
        "ownerName": owner.name if owner else "Chưa gán",
        "ownerRole": "Quản lý khu vực" if owner else "",
        "slotCount": total_slots,
        "occupancy": occupancy,
        "pricePerHour": float(price.price_per_hour) if price else 0,
        "pricePerDay": float(price.price_per_day) if price else 0,
        "status": status,
        "statusLabel": _lot_status_label(status),
        "monthlyRevenue": monthly_revenue,
        "monthlyRevenueChangePercent": _growth_percent(monthly_revenue, monthly_revenue_prev),
        "latitude": lot.latitude,
        "longitude": lot.longitude,
        "avgRating": float(lot.avg_rating or 0),
        "reviewCount": int(lot.review_count or 0),
    }


def build_parking_lot_management(
    db: Session,
    *,
    search: str | None = None,
    status: str | None = None,
    district_id: int | None = None,
    owner_id: int | None = None,
    sort: str = "newest",
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    today = vn_today()
    first_this, _, first_prev, last_prev = _month_bounds(today)

    districts, _ = _district_maps(db)
    owner_by_lot_map: dict[int, User] = {}
    for row in db.query(OwnerParking.owner_id, OwnerParking.parking_id).all():
        owner = db.query(User).filter(User.id == row.owner_id).first()
        if owner:
            owner_by_lot_map[int(row.parking_id)] = owner

    slot_counts = _slot_counts(db)
    prices = {int(p.parking_id): p for p in db.query(ParkingPrice).all()}
    lots = db.query(ParkingLot).order_by(ParkingLot.id.asc()).all()

    all_rows: list[dict[str, Any]] = []
    for lot in lots:
        lot_id = int(lot.id)
        owner = owner_by_lot_map.get(lot_id)
        if owner_id is not None and (not owner or int(owner.id) != owner_id):
            continue
        if district_id is not None and int(lot.district_id or 0) != district_id:
            continue

        rev_this = _monthly_revenue_for_lots(db, [lot_id], first_this, today)
        rev_prev = _monthly_revenue_for_lots(db, [lot_id], first_prev, last_prev)
        row = _serialize_lot_row(
            lot,
            districts=districts,
            owner_by_lot=owner_by_lot_map,
            slot_counts=slot_counts,
            prices=prices,
            monthly_revenue=rev_this,
            monthly_revenue_prev=rev_prev,
        )
        if status and status != "all" and row["status"] != status:
            continue
        if search and search.strip():
            token = search.strip().lower()
            haystack = f"{row['name']} {row['address']} {row['district']} {row['ownerName']}".lower()
            if token not in haystack:
                continue
        all_rows.append(row)

    reverse = sort != "oldest"
    all_rows.sort(key=lambda item: item["id"], reverse=reverse)

    total = len(all_rows)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start_index = (safe_page - 1) * safe_size
    items = all_rows[start_index : start_index + safe_size]

    status_counts = {"active": 0, "locked": 0, "pending": 0}
    for row in all_rows:
        key = row["status"]
        if key in status_counts:
            status_counts[key] += 1

    all_lot_ids = [int(lot.id) for lot in lots]
    total_revenue_month = _monthly_revenue_for_lots(db, all_lot_ids, first_this, today)
    total_revenue_prev = _monthly_revenue_for_lots(db, all_lot_ids, first_prev, last_prev)

    owners = db.query(User).filter(User.role == "owner").order_by(User.name.asc()).all()

    return {
        "summary": {
            "totalLots": total,
            "activeLots": status_counts["active"],
            "pausedLots": status_counts.get("pending", 0),
            "inactiveLots": status_counts["locked"],
            "totalSlots": sum(slot_counts.get(int(lot.id), {}).get("total", 0) for lot in lots),
            "trends": {
                "totalLotsChangePercent": _growth_percent(total, max(total - 1, 0)),
                "activeChangePercent": _growth_percent(status_counts["active"], max(status_counts["active"] - 1, 0)),
                "pausedChangePercent": _growth_percent(status_counts.get("pending", 0), 0),
                "inactiveChangePercent": _growth_percent(status_counts["locked"], max(status_counts["locked"] - 1, 0)),
                "revenueChangePercent": _growth_percent(total_revenue_month, total_revenue_prev),
            },
        },
        "districts": [{"id": did, "name": name} for did, name in sorted(districts.items(), key=lambda item: item[1])],
        "owners": [{"id": int(o.id), "name": o.name} for o in owners],
        "items": items,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_size,
            "total": total,
            "totalPages": max(1, (total + safe_size - 1) // safe_size),
        },
        "generatedAt": isoformat_vn(vn_now(), fallback_now=True),
    }


def build_parking_lot_detail(db: Session, lot_id: int) -> dict[str, Any]:
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        return {}

    today = vn_today()
    range_end = today
    range_start = today - timedelta(days=6)
    prev_end = range_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=6)
    first_this, _, first_prev, last_prev = _month_bounds(today)

    districts, _ = _district_maps(db)
    owner_by_lot_map: dict[int, User] = {}
    for row in db.query(OwnerParking.owner_id, OwnerParking.parking_id).filter(OwnerParking.parking_id == lot_id).all():
        owner = db.query(User).filter(User.id == row.owner_id).first()
        if owner:
            owner_by_lot_map[int(row.parking_id)] = owner

    slot_counts = _slot_counts(db)
    price = db.query(ParkingPrice).filter(ParkingPrice.parking_id == lot_id).first()
    prices = {lot_id: price} if price else {}

    rev_this = _monthly_revenue_for_lots(db, [lot_id], first_this, today)
    rev_prev = _monthly_revenue_for_lots(db, [lot_id], first_prev, last_prev)
    base = _serialize_lot_row(
        lot,
        districts=districts,
        owner_by_lot=owner_by_lot_map,
        slot_counts=slot_counts,
        prices=prices,
        monthly_revenue=rev_this,
        monthly_revenue_prev=rev_prev,
    )

    payments = _payments_in_range(db, [lot_id], prev_start, range_end)
    revenue_7d = _sum_revenue_for_payments(payments, range_start, range_end)

    daily_revenue: dict[date, float] = defaultdict(float)
    for payment in payments:
        moment = payment.paid_at or payment.created_at
        if not moment:
            continue
        day = moment.date()
        if range_start <= day <= range_end:
            daily_revenue[day] += split_revenue(_payment_gross(payment))["gross"]

    revenue_chart = []
    cursor = range_start
    while cursor <= range_end:
        revenue_chart.append({
            "label": cursor.strftime("%d/%m"),
            "revenue": round(daily_revenue.get(cursor, 0.0), 2),
        })
        cursor += timedelta(days=1)

    slots = db.query(ParkingSlot).filter(ParkingSlot.parking_id == lot_id).all()
    device_count = len(slots)

    return {
        **base,
        "hasRoof": bool(lot.has_roof),
        "revenue7d": revenue_7d,
        "revenueChart": revenue_chart,
        "deviceCount": device_count,
        "devices": [
            {
                "id": int(slot.id),
                "code": slot.code,
                "zone": slot.zone or "",
                "level": slot.level or "",
                "status": slot.status,
            }
            for slot in slots[:50]
        ],
    }
