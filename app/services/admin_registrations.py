from __future__ import annotations

import json
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import District, OwnerParking, PartnerRegistration, ParkingLot, ParkingSlot, PartnerContract, User
from app.services.admin_owners import _owner_display_status, _owner_parking_maps, _resolve_district_name, _district_maps
from app.services.revenue_settings import get_commission_rate_percent
from app.utils.timezone import isoformat_vn, vn_now

DEFAULT_SERVICES = ["Giữ xe máy", "Giữ xe ô tô", "Camera", "PCCC"]
DEFAULT_DOCUMENTS = [
    {"name": "Giấy phép kinh doanh.pdf", "type": "pdf", "sizeKb": 842},
    {"name": "Giấy chứng nhận quyền sử dụng đất.pdf", "type": "pdf", "sizeKb": 1256},
    {"name": "Hình ảnh bãi xe.zip", "type": "zip", "sizeKb": 4820},
]


def _next_registration_code(db: Session) -> str:
    today = vn_now().strftime("%Y%m%d")
    prefix = f"REG-{today}-"
    count = db.query(func.count(PartnerRegistration.id)).filter(
        PartnerRegistration.registration_code.like(f"{prefix}%")
    ).scalar() or 0
    return f"{prefix}{int(count) + 1:03d}"


def _parse_json_list(raw: str | None, fallback: list) -> list:
    if not raw:
        return fallback
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else fallback
    except json.JSONDecodeError:
        return fallback


def _serialize_registration(row: PartnerRegistration, districts: dict[int, str]) -> dict[str, Any]:
    district_name = districts.get(int(row.district_id)) if row.district_id else "Khác"
    documents = _parse_json_list(row.documents_json, DEFAULT_DOCUMENTS)
    services = _parse_json_list(row.services, DEFAULT_SERVICES)
    return {
        "id": int(row.id),
        "registrationCode": row.registration_code,
        "businessName": row.business_name,
        "contactName": row.contact_name,
        "email": row.email,
        "phone": row.phone or "",
        "address": row.address or "",
        "district": district_name,
        "districtId": int(row.district_id) if row.district_id else None,
        "parkingLotCount": int(row.parking_lot_count or 0),
        "slotCount": int(row.slot_count or 0),
        "lotTypes": row.lot_types or "Trong nhà, Ngoài trời",
        "totalAreaSqm": float(row.total_area_sqm or 0),
        "operatingHours": row.operating_hours or "24/7",
        "services": services,
        "documentCount": len(documents),
        "documents": documents,
        "adminNotes": row.admin_notes or "",
        "status": row.status,
        "ownerId": int(row.owner_id) if row.owner_id else None,
        "rejectionReason": row.rejection_reason,
        "createdAt": isoformat_vn(row.created_at),
        "reviewedAt": isoformat_vn(row.reviewed_at) if row.reviewed_at else None,
    }


def sync_registrations_from_owners(db: Session) -> int:
    """Tạo hồ sơ đăng ký từ owner đang chờ duyệt nếu chưa có."""
    parking_by_owner, lots_by_id = _owner_parking_maps(db)
    districts, lot_district, _ = _district_maps(db)
    created = 0

    owners = db.query(User).filter(User.role == "owner").all()
    for owner in owners:
        owner_id = int(owner.id)
        if db.query(PartnerRegistration.id).filter(
            PartnerRegistration.owner_id == owner_id,
            PartnerRegistration.status.in_(["pending", "approved"]),
        ).first():
            continue

        parking_ids = parking_by_owner.get(owner_id, [])
        display_status = _owner_display_status(owner, parking_ids, lots_by_id)
        if display_status != "pending" and owner.is_active == 1:
            continue

        district_name, district_id = _resolve_district_name(
            owner, parking_ids, districts, lot_district, lots_by_id,
        )
        slot_count = 0
        if parking_ids:
            slot_count = (
                db.query(func.count(ParkingSlot.id))
                .filter(ParkingSlot.parking_id.in_(parking_ids))
                .scalar()
                or 0
            )

        lot_label = lots_by_id[parking_ids[0]].name if parking_ids and parking_ids[0] in lots_by_id else owner.name
        row = PartnerRegistration(
            registration_code=_next_registration_code(db),
            business_name=lot_label,
            contact_name=owner.name,
            email=owner.email,
            phone=owner.phone,
            address=(lots_by_id[parking_ids[0]].address if parking_ids and parking_ids[0] in lots_by_id else "") or district_name,
            district_id=district_id,
            parking_lot_count=len(parking_ids) or 1,
            slot_count=int(slot_count or 0),
            lot_types="Trong nhà, Ngoài trời",
            total_area_sqm=float(max(slot_count, 1) * 8),
            services=json.dumps(DEFAULT_SERVICES, ensure_ascii=False),
            documents_json=json.dumps(DEFAULT_DOCUMENTS, ensure_ascii=False),
            status="pending",
            owner_id=owner_id,
            created_at=owner.created_at or vn_now(),
            updated_at=vn_now(),
        )
        db.add(row)
        created += 1

    if created:
        db.commit()
    return created


def build_registration_management(
    db: Session,
    *,
    search: str | None = None,
    status: str | None = None,
    district_id: int | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict[str, Any]:
    sync_registrations_from_owners(db)
    districts = {int(item.id): item.name for item in db.query(District).all()}

    query = db.query(PartnerRegistration).order_by(PartnerRegistration.created_at.desc())
    rows = query.all()

    if status and status != "all":
        rows = [row for row in rows if row.status == status]
    if district_id is not None:
        rows = [row for row in rows if int(row.district_id or 0) == district_id]
    if search and search.strip():
        token = search.strip().lower()
        rows = [
            row for row in rows
            if token in f"{row.business_name} {row.contact_name} {row.email} {row.phone}".lower()
        ]

    serialized = [_serialize_registration(row, districts) for row in rows]
    total = len(serialized)
    safe_page = max(page, 1)
    safe_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_size
    items = serialized[start : start + safe_size]

    status_counts = {"pending": 0, "approved": 0, "rejected": 0}
    for row in rows:
        if row.status in status_counts:
            status_counts[row.status] += 1

    all_count = len(rows)
    approval_rate = round((status_counts["approved"] / all_count) * 100, 1) if all_count else 0.0

    return {
        "summary": {
            "total": all_count,
            "pending": status_counts["pending"],
            "approved": status_counts["approved"],
            "rejected": status_counts["rejected"],
            "approvalRate": approval_rate,
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


def get_registration_detail(db: Session, registration_id: int) -> dict[str, Any] | None:
    districts = {int(item.id): item.name for item in db.query(District).all()}
    row = db.query(PartnerRegistration).filter(PartnerRegistration.id == registration_id).first()
    if not row:
        return None
    return _serialize_registration(row, districts)


def approve_registration(db: Session, registration_id: int, admin_id: int, admin_notes: str | None = None) -> dict[str, Any]:
    row = db.query(PartnerRegistration).filter(PartnerRegistration.id == registration_id).first()
    if not row:
        raise ValueError("Không tìm thấy hồ sơ đăng ký")
    if row.status != "pending":
        raise ValueError("Hồ sơ không ở trạng thái chờ duyệt")

    owner = None
    if row.owner_id:
        owner = db.query(User).filter(User.id == row.owner_id, User.role == "owner").first()
    if not owner:
        owner = db.query(User).filter(User.email == row.email.lower(), User.role == "owner").first()

    if not owner:
        from werkzeug.security import generate_password_hash
        temp_password = secrets.token_urlsafe(8)
        owner = User(
            name=row.contact_name,
            email=row.email.lower().strip(),
            role="owner",
            phone=row.phone,
            status="active",
            is_active=1,
            password="__legacy_disabled__",
            password_hash=generate_password_hash(temp_password),
            managed_district_id=row.district_id,
        )
        db.add(owner)
        db.flush()
        row.owner_id = owner.id
    else:
        owner.status = "active"
        owner.is_active = 1
        owner.phone = row.phone or owner.phone
        if row.district_id:
            owner.managed_district_id = row.district_id

    parking_ids = [int(item.parking_id) for item in db.query(OwnerParking).filter(OwnerParking.owner_id == owner.id).all()]
    for lot in db.query(ParkingLot).filter(ParkingLot.id.in_(parking_ids)).all() if parking_ids else []:
        lot.is_active = 1

    row.status = "approved"
    row.reviewed_by = admin_id
    row.reviewed_at = vn_now()
    row.admin_notes = (admin_notes or row.admin_notes or "").strip() or None
    row.updated_at = vn_now()

    from app.services import admin_contracts
    admin_contracts.ensure_contract_for_owner(db, int(owner.id))

    db.commit()
    districts = {int(item.id): item.name for item in db.query(District).all()}
    return _serialize_registration(row, districts)


def reject_registration(
    db: Session,
    registration_id: int,
    admin_id: int,
    reason: str | None = None,
    admin_notes: str | None = None,
) -> dict[str, Any]:
    row = db.query(PartnerRegistration).filter(PartnerRegistration.id == registration_id).first()
    if not row:
        raise ValueError("Không tìm thấy hồ sơ đăng ký")
    if row.status != "pending":
        raise ValueError("Hồ sơ không ở trạng thái chờ duyệt")

    row.status = "rejected"
    row.reviewed_by = admin_id
    row.reviewed_at = vn_now()
    row.rejection_reason = (reason or "Không đạt yêu cầu").strip()
    row.admin_notes = (admin_notes or row.admin_notes or "").strip() or None
    row.updated_at = vn_now()

    if row.owner_id:
        owner = db.query(User).filter(User.id == row.owner_id).first()
        if owner:
            owner.status = "banned"
            owner.is_active = 0

    db.commit()
    districts = {int(item.id): item.name for item in db.query(District).all()}
    return _serialize_registration(row, districts)
