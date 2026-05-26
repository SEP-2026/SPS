from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import District, OwnerParking, PartnerContract, ParkingLot, User
from app.services.admin_owners import _district_maps, _owner_parking_maps, _resolve_district_name
from app.services.revenue_settings import get_commission_rate_percent
from app.utils.timezone import isoformat_vn, vn_now, vn_today


DEFAULT_TERMS = [
    "Hoa hồng nền tảng theo doanh thu thực tế",
    "Thanh toán định kỳ theo chu kỳ đã ký",
    "Hỗ trợ kỹ thuật 24/7",
]
DEFAULT_ATTACHMENTS = [
    {"name": "Hợp đồng hợp tác ký kết.pdf", "type": "pdf", "sizeKb": 1240},
    {"name": "Phụ lục điều khoản.pdf", "type": "pdf", "sizeKb": 680},
    {"name": "Giấy phép kinh doanh.pdf", "type": "pdf", "sizeKb": 842},
]


def _next_contract_code(db: Session) -> str:
    year = vn_now().year
    prefix = f"HD-{year}-"
    count = db.query(func.count(PartnerContract.id)).filter(PartnerContract.contract_code.like(f"{prefix}%")).scalar() or 0
    return f"{prefix}{int(count) + 1:05d}"


def _contract_status(expires_at, current_status: str) -> str:
    if current_status in {"terminated", "renewal_pending"}:
        return current_status
    today = vn_today()
    exp_day = expires_at.date() if hasattr(expires_at, "date") else expires_at
    if exp_day < today:
        return "expired"
    if (exp_day - today).days <= 30:
        return "expiring"
    return "active"


def _parse_json_list(raw: str | None, fallback: list) -> list:
    if not raw:
        return fallback
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else fallback
    except json.JSONDecodeError:
        return fallback


def _serialize_contract_inner(
    row: PartnerContract,
    owner: User | None,
    districts: dict[int, str],
    lots_by_id: dict[int, ParkingLot],
    parking_by_owner: dict[int, list[int]],
    lot_district: dict[int, int | None],
) -> dict[str, Any]:
    owner_id = int(row.owner_id)
    parking_ids = parking_by_owner.get(owner_id, [])
    district_name, _ = _resolve_district_name(
        owner, parking_ids, districts, lot_district, lots_by_id,
    ) if owner else (districts.get(int(row.district_id or 0), "Khác"), row.district_id)

    if row.district_id and int(row.district_id) in districts:
        district_name = districts[int(row.district_id)]

    lot_names = [lots_by_id[pid].name for pid in parking_ids if pid in lots_by_id]
    status = _contract_status(row.expires_at, row.status)
    return {
        "id": int(row.id),
        "contractCode": row.contract_code,
        "ownerId": owner_id,
        "partnerName": owner.name if owner else "—",
        "businessName": lot_names[0] if lot_names else (owner.name if owner else "—"),
        "companyType": "Công ty TNHH",
        "district": district_name,
        "districtId": int(row.district_id) if row.district_id else None,
        "signedAt": isoformat_vn(row.signed_at),
        "expiresAt": isoformat_vn(row.expires_at),
        "contractValue": float(row.contract_value or 0),
        "commissionRate": float(row.commission_rate or 0),
        "paymentMethod": row.payment_method,
        "paymentCycle": row.payment_cycle,
        "terms": _parse_json_list(row.terms_json, DEFAULT_TERMS),
        "attachments": _parse_json_list(row.attachments_json, DEFAULT_ATTACHMENTS),
        "parkingLots": lot_names,
        "status": status,
        "taxId": f"0{owner_id:09d}"[:10] if owner else "",
        "representative": owner.name if owner else "",
        "email": owner.email if owner else "",
        "phone": owner.phone if owner else "",
        "address": lots_by_id[parking_ids[0]].address if parking_ids and parking_ids[0] in lots_by_id else "",
    }


def ensure_contract_for_owner(db: Session, owner_id: int) -> PartnerContract:
    existing = db.query(PartnerContract).filter(PartnerContract.owner_id == owner_id).order_by(PartnerContract.id.desc()).first()
    if existing:
        return existing

    owner = db.query(User).filter(User.id == owner_id, User.role == "owner").first()
    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    districts, lot_district, _ = _district_maps(db)
    parking_ids = parking_by_owner.get(owner_id, [])
    _, district_id = _resolve_district_name(owner, parking_ids, districts, lot_district, lots_by_id) if owner else ("Khác", None)

    now = vn_now()
    contract = PartnerContract(
        contract_code=_next_contract_code(db),
        owner_id=owner_id,
        district_id=district_id,
        signed_at=now,
        expires_at=now + timedelta(days=365),
        contract_value=500_000_000,
        commission_rate=get_commission_rate_percent(),
        terms_json=json.dumps(DEFAULT_TERMS, ensure_ascii=False),
        attachments_json=json.dumps(DEFAULT_ATTACHMENTS, ensure_ascii=False),
        status="active",
    )
    db.add(contract)
    db.flush()
    return contract


def sync_contracts_from_owners(db: Session) -> int:
    created = 0
    owners = db.query(User).filter(User.role == "owner", User.is_active == 1).all()
    for owner in owners:
        if not db.query(PartnerContract.id).filter(PartnerContract.owner_id == owner.id).first():
            ensure_contract_for_owner(db, int(owner.id))
            created += 1
    if created:
        db.commit()
    return created


def build_contract_management(
    db: Session,
    *,
    search: str | None = None,
    status: str | None = None,
    district_id: int | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    sync_contracts_from_owners(db)
    districts = {int(item.id): item.name for item in db.query(District).all()}
    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    _, lot_district, _ = _district_maps(db)
    owners = {int(u.id): u for u in db.query(User).filter(User.role == "owner").all()}

    rows = db.query(PartnerContract).order_by(PartnerContract.signed_at.desc()).all()
    items_raw = []
    for row in rows:
        owner = owners.get(int(row.owner_id))
        computed_status = _contract_status(row.expires_at, row.status)
        if row.status != computed_status and row.status not in {"terminated", "renewal_pending"}:
            row.status = computed_status
        serialized = _serialize_contract_inner(row, owner, districts, lots_by_id, parking_by_owner, lot_district)
        items_raw.append(serialized)

    db.commit()

    if status and status != "all":
        items_raw = [item for item in items_raw if item["status"] == status]
    if district_id is not None:
        items_raw = [item for item in items_raw if item.get("districtId") == district_id]
    if search and search.strip():
        token = search.strip().lower()
        items_raw = [
            item for item in items_raw
            if token in f"{item['contractCode']} {item['partnerName']} {item['businessName']} {item['district']}".lower()
        ]

    counts = {"active": 0, "expiring": 0, "expired": 0, "renewal_pending": 0}
    for item in items_raw:
        key = item["status"]
        if key in counts:
            counts[key] += 1

    total = len(items_raw)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_size
    items = items_raw[start : start + safe_size]

    return {
        "summary": {
            "total": total,
            "active": counts["active"],
            "expiring": counts["expiring"],
            "expired": counts["expired"],
            "renewalPending": counts["renewal_pending"],
        },
        "districts": [{"id": did, "name": name} for did, name in sorted(districts.items(), key=lambda item: item[1])],
        "items": items,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_size,
            "total": total,
            "totalPages": max(1, (total + safe_size - 1) // safe_size),
        },
        "generatedAt": isoformat_vn(vn_now(), fallback_now=True),
    }


def get_contract_detail(db: Session, contract_id: int) -> dict[str, Any] | None:
    districts = {int(item.id): item.name for item in db.query(District).all()}
    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    _, lot_district, _ = _district_maps(db)
    row = db.query(PartnerContract).filter(PartnerContract.id == contract_id).first()
    if not row:
        return None
    owner = db.query(User).filter(User.id == row.owner_id).first()
    return _serialize_contract_inner(row, owner, districts, lots_by_id, parking_by_owner, lot_district)


def renew_contract(db: Session, contract_id: int) -> dict[str, Any]:
    row = db.query(PartnerContract).filter(PartnerContract.id == contract_id).first()
    if not row:
        raise ValueError("Không tìm thấy hợp đồng")
    base = row.expires_at if row.expires_at > vn_now() else vn_now()
    row.expires_at = base + timedelta(days=365)
    row.status = "active"
    row.updated_at = vn_now()
    db.commit()
    return get_contract_detail(db, contract_id) or {}


def terminate_contract(db: Session, contract_id: int) -> dict[str, Any]:
    row = db.query(PartnerContract).filter(PartnerContract.id == contract_id).first()
    if not row:
        raise ValueError("Không tìm thấy hợp đồng")
    row.status = "terminated"
    row.updated_at = vn_now()
    db.commit()
    return get_contract_detail(db, contract_id) or {}


def update_contract_notes(db: Session, contract_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    row = db.query(PartnerContract).filter(PartnerContract.id == contract_id).first()
    if not row:
        raise ValueError("Không tìm thấy hợp đồng")
    if payload.get("commissionRate") is not None:
        row.commission_rate = float(payload["commissionRate"])
    if payload.get("contractValue") is not None:
        row.contract_value = float(payload["contractValue"])
    if payload.get("paymentMethod"):
        row.payment_method = payload["paymentMethod"]
    if payload.get("paymentCycle"):
        row.payment_cycle = payload["paymentCycle"]
    row.updated_at = vn_now()
    db.commit()
    return get_contract_detail(db, contract_id) or {}
