from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import District, ParkingLot, ParkingSlot, User
from app.services.admin_owners import _district_maps, _payment_gross, _payments_in_range, _sum_revenue_for_payments
from app.services.admin_parking_lots import _growth_percent, _lot_status, _month_bounds, _monthly_revenue_for_lots, _slot_counts
from app.services.revenue_settings import split_revenue
from app.utils.timezone import isoformat_vn, vn_now, vn_today


def _district_display_status(lots: list[ParkingLot]) -> str:
    if not lots:
        return "pending"
    active_count = sum(1 for lot in lots if lot.is_active == 1)
    if active_count == len(lots):
        return "active"
    if active_count == 0:
        return "locked"
    return "paused"


def _district_status_label(status: str) -> str:
    if status == "active":
        return "Hoạt động"
    if status == "paused":
        return "Tạm ngưng"
    if status == "locked":
        return "Ngừng hoạt động"
    return "Chờ thiết lập"


def _lots_by_district(db: Session) -> dict[int, list[ParkingLot]]:
    grouped: dict[int, list[ParkingLot]] = defaultdict(list)
    unassigned: list[ParkingLot] = []
    for lot in db.query(ParkingLot).order_by(ParkingLot.id.asc()).all():
        if lot.district_id:
            grouped[int(lot.district_id)].append(lot)
        else:
            unassigned.append(lot)
    if unassigned:
        grouped[-1] = unassigned
    return grouped


def _district_manager(db: Session, district_id: int) -> User | None:
    return (
        db.query(User)
        .filter(User.role == "owner", User.managed_district_id == district_id)
        .order_by(User.id.asc())
        .first()
    )


def build_district_management(
    db: Session,
    *,
    search: str | None = None,
    status: str | None = None,
    sort: str = "newest",
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    today = vn_today()
    first_this, _, first_prev, last_prev = _month_bounds(today)

    districts = db.query(District).order_by(District.id.asc()).all()
    lots_grouped = _lots_by_district(db)
    slot_counts = _slot_counts(db)

    all_rows: list[dict[str, Any]] = []
    for district in districts:
        district_id = int(district.id)
        lots = lots_grouped.get(district_id, [])
        lot_ids = [int(lot.id) for lot in lots]
        total_slots = sum(slot_counts.get(lid, {}).get("total", 0) for lid in lot_ids)
        occupied = sum(slot_counts.get(lid, {}).get("occupied", 0) for lid in lot_ids)
        occupancy = int(round((occupied / total_slots) * 100)) if total_slots > 0 else 0

        display_status = _district_display_status(lots)
        manager = _district_manager(db, district_id)

        rev_this = _monthly_revenue_for_lots(db, lot_ids, first_this, today)
        rev_prev = _monthly_revenue_for_lots(db, lot_ids, first_prev, last_prev)

        row = {
            "id": district_id,
            "name": district.name,
            "label": district.name,
            "managerId": int(manager.id) if manager else None,
            "managerName": manager.name if manager else "Chưa gán",
            "managerEmail": manager.email if manager else "",
            "managerPhone": manager.phone if manager else "",
            "parkingLotCount": len(lots),
            "totalSlots": total_slots,
            "avgOccupancy": occupancy,
            "monthlyRevenue": rev_this,
            "monthlyRevenueChangePercent": _growth_percent(rev_this, rev_prev),
            "status": display_status,
            "statusLabel": _district_status_label(display_status),
        }

        if status and status != "all" and row["status"] != status:
            continue
        if search and search.strip():
            token = search.strip().lower()
            haystack = f"{row['name']} {row['label']} {row['managerName']} {row['managerEmail']}".lower()
            if token not in haystack:
                continue
        all_rows.append(row)

    reverse = sort != "oldest"
    all_rows.sort(key=lambda item: item["name"], reverse=reverse)

    total = len(all_rows)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start_index = (safe_page - 1) * safe_size
    items = all_rows[start_index : start_index + safe_size]

    all_lot_ids = [int(lot.id) for lot in db.query(ParkingLot.id).all()]
    total_lots = len(all_lot_ids)
    total_slots_all = int(db.query(func.count(ParkingSlot.id)).scalar() or 0)
    total_revenue = _monthly_revenue_for_lots(db, all_lot_ids, first_this, today)
    total_revenue_prev = _monthly_revenue_for_lots(db, all_lot_ids, first_prev, last_prev)

    status_counts = {"active": 0, "paused": 0, "locked": 0, "pending": 0}
    for row in all_rows:
        key = row["status"]
        if key in status_counts:
            status_counts[key] += 1

    return {
        "summary": {
            "totalAreas": len(districts),
            "totalParkingLots": total_lots,
            "totalSlots": int(total_slots_all),
            "monthlyRevenue": total_revenue,
            "trends": {
                "parkingLotsChangePercent": _growth_percent(total_lots, max(total_lots - 1, 0)),
                "totalSlotsChangePercent": _growth_percent(total_slots_all, max(int(total_slots_all) - 1, 0)),
                "revenueChangePercent": _growth_percent(total_revenue, total_revenue_prev),
            },
        },
        "items": items,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_size,
            "total": total,
            "totalPages": max(1, (total + safe_size - 1) // safe_size),
        },
        "generatedAt": isoformat_vn(vn_now(), fallback_now=True),
    }


def build_district_detail(db: Session, district_id: int) -> dict[str, Any]:
    district = db.query(District).filter(District.id == district_id).first()
    if not district:
        return {}

    today = vn_today()
    range_end = today
    range_start = today - timedelta(days=6)
    prev_end = range_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=6)
    first_this, _, first_prev, last_prev = _month_bounds(today)

    lots = db.query(ParkingLot).filter(ParkingLot.district_id == district_id).order_by(ParkingLot.name.asc()).all()
    lot_ids = [int(lot.id) for lot in lots]
    slot_counts = _slot_counts(db)
    manager = _district_manager(db, district_id)

    total_slots = sum(slot_counts.get(lid, {}).get("total", 0) for lid in lot_ids)
    occupied = sum(slot_counts.get(lid, {}).get("occupied", 0) for lid in lot_ids)
    avg_occupancy = int(round((occupied / total_slots) * 100)) if total_slots > 0 else 0

    rev_this = _monthly_revenue_for_lots(db, lot_ids, first_this, today)
    rev_prev = _monthly_revenue_for_lots(db, lot_ids, first_prev, last_prev)
    display_status = _district_display_status(lots)

    payments = _payments_in_range(db, lot_ids, prev_start, range_end)
    daily_revenue: dict[date, float] = defaultdict(float)
    daily_occupancy: dict[date, list[int]] = defaultdict(list)

    for payment in payments:
        moment = payment.paid_at or payment.created_at
        if not moment:
            continue
        day = moment.date()
        if range_start <= day <= range_end:
            daily_revenue[day] += split_revenue(_payment_gross(payment))["gross"]

    revenue_chart = []
    occupancy_chart = []
    cursor = range_start
    while cursor <= range_end:
        revenue_chart.append({
            "label": cursor.strftime("%d/%m"),
            "revenue": round(daily_revenue.get(cursor, 0.0), 2),
        })
        occupancy_chart.append({
            "label": cursor.strftime("%d/%m"),
            "occupancy": avg_occupancy,
        })
        cursor += timedelta(days=1)

    lot_rows = []
    for lot in lots:
        lid = int(lot.id)
        counts = slot_counts.get(lid, {"total": 0, "occupied": 0})
        total = counts["total"]
        occ = int(round((counts["occupied"] / total) * 100)) if total > 0 else 0
        lot_rev = _monthly_revenue_for_lots(db, [lid], first_this, today)
        lot_rev_prev = _monthly_revenue_for_lots(db, [lid], first_prev, last_prev)
        lot_rows.append({
            "id": lid,
            "name": lot.name,
            "slotCount": total,
            "occupancy": occ,
            "monthlyRevenue": lot_rev,
            "revenueChangePercent": _growth_percent(lot_rev, lot_rev_prev),
            "status": _lot_status(lot),
        })

    lot_rows.sort(key=lambda item: item["monthlyRevenue"], reverse=True)

    status_breakdown = {"active": 0, "paused": 0, "locked": 0}
    for lot in lots:
        st = _lot_status(lot)
        if st == "active":
            status_breakdown["active"] += 1
        else:
            status_breakdown["locked"] += 1

    return {
        "id": int(district.id),
        "name": district.name,
        "label": district.name,
        "status": display_status,
        "statusLabel": _district_status_label(display_status),
        "manager": {
            "id": int(manager.id) if manager else None,
            "name": manager.name if manager else "Chưa gán",
            "email": manager.email if manager else "",
            "phone": manager.phone if manager else "",
        },
        "stats": {
            "parkingLotCount": len(lots),
            "totalSlots": total_slots,
            "monthlyRevenue": rev_this,
            "monthlyRevenueChangePercent": _growth_percent(rev_this, rev_prev),
            "avgOccupancy": avg_occupancy,
        },
        "charts": {
            "revenue7d": revenue_chart,
            "occupancy7d": occupancy_chart,
        },
        "topParkingLots": lot_rows[:10],
        "statusBreakdown": status_breakdown,
        "parkingLots": lot_rows,
    }
