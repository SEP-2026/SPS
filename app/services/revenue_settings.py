ADMIN_RUNTIME_SETTINGS = {
    "commissionRate": "10",
    "supportEmail": "admin@smartparking.vn",
    "maintenanceWindow": "Chủ nhật 23:00 - 01:00",
    "alertThreshold": "85",
}


def get_commission_rate() -> float:
    return get_commission_rate_percent() / 100


def get_commission_rate_percent() -> float:
    try:
        rate = float(ADMIN_RUNTIME_SETTINGS.get("commissionRate", 10))
    except (TypeError, ValueError):
        rate = 10.0
    return min(max(rate, 0.0), 100.0)


def split_revenue(gross: float | int | None) -> dict:
    gross_amount = round(float(gross or 0), 2)
    commission = round(gross_amount * get_commission_rate(), 2)
    return {
        "gross": gross_amount,
        "commission": commission,
        "ownerPayout": round(gross_amount - commission, 2),
    }
