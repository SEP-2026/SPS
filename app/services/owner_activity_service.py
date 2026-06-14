from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import OwnerActivity, ParkingSlot

OWNER_ACTION_LABELS: dict[str, str] = {
    "parking_created": "Tạo bãi đỗ",
    "parking_updated": "Cập nhật bãi đỗ",
    "slot_created": "Thêm chỗ đỗ",
    "slot_updated": "Cập nhật chỗ đỗ",
    "slot_deleted": "Xóa chỗ đỗ",
    "settings_updated": "Cập nhật cài đặt",
    "account_updated": "Cập nhật tài khoản",
    "booking_config_updated": "Cập nhật cấu hình đặt chỗ",
    "customer_created": "Tạo khách hàng",
    "customer_updated": "Cập nhật khách hàng",
    "review_replied": "Phản hồi đánh giá",
    "booking_status_updated": "Cập nhật trạng thái booking",
}


def log_owner_activity(
    owner_id: int,
    action: str,
    detail: str,
    db: Session,
    *,
    parking_id: int | None = None,
) -> OwnerActivity:
    row = OwnerActivity(
        owner_id=owner_id,
        parking_id=parking_id,
        action=action,
        detail=(detail or "")[:500],
    )
    db.add(row)
    return row


def _serialize_owner_activity_row(
    log: OwnerActivity,
    *,
    parking_names: dict[int, str],
    owner_name: str,
) -> dict:
    parking_id = int(log.parking_id) if log.parking_id else None
    return {
        "id": f"owner-{log.id}",
        "time": (log.created_at or datetime.utcnow()).isoformat(),
        "type": "owner",
        "action": OWNER_ACTION_LABELS.get(log.action, log.action),
        "object": parking_names.get(parking_id, "Hệ thống") if parking_id else "Hệ thống",
        "parkingLotName": parking_names.get(parking_id, "Hệ thống") if parking_id else "Hệ thống",
        "actor": owner_name,
        "device": "Owner console",
        "ip": "",
        "detail": log.detail or "",
        "status": "success",
        "result": "success",
    }


def build_owner_management_activity_rows(
    owner_id: int,
    owner_name: str,
    parking_ids: list[int],
    parking_names: dict[int, str],
    db: Session,
    *,
    limit: int = 500,
) -> list[dict]:
    rows: list[dict] = []
    owner_logs = (
        db.query(OwnerActivity)
        .filter(OwnerActivity.owner_id == owner_id)
        .order_by(OwnerActivity.created_at.desc(), OwnerActivity.id.desc())
        .limit(limit)
        .all()
    )
    for log in owner_logs:
        rows.append(
            _serialize_owner_activity_row(
                log,
                parking_names=parking_names,
                owner_name=owner_name,
            )
        )

    logged_parking_creates = {
        int(log.parking_id)
        for log in owner_logs
        if log.action == "parking_created" and log.parking_id is not None
    }
    if parking_ids:
        earliest_by_parking = dict(
            db.query(ParkingSlot.parking_id, func.min(ParkingSlot.created_at))
            .filter(ParkingSlot.parking_id.in_(parking_ids))
            .group_by(ParkingSlot.parking_id)
            .all()
        )
        for parking_id in parking_ids:
            if parking_id in logged_parking_creates:
                continue
            created_at = earliest_by_parking.get(parking_id)
            if not created_at:
                continue
            lot_name = parking_names.get(parking_id, f"Bãi #{parking_id}")
            rows.append({
                "id": f"owner-backfill-parking-{parking_id}",
                "time": created_at.isoformat(),
                "type": "owner",
                "action": OWNER_ACTION_LABELS["parking_created"],
                "object": lot_name,
                "parkingLotName": lot_name,
                "actor": owner_name,
                "device": "Owner console",
                "ip": "",
                "detail": f"Khởi tạo bãi «{lot_name}» (dữ liệu lịch sử)",
                "status": "success",
                "result": "success",
            })

    return rows
