import json
import os
import unicodedata
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


class GeocodingError(Exception):
    pass


def _normalize_text(value: str) -> str:
    plain = unicodedata.normalize("NFD", value)
    plain = "".join(ch for ch in plain if unicodedata.category(ch) != "Mn")
    return plain.lower().strip()


def _local_geocode_fallback(address: str) -> tuple[float, float] | None:
    normalized = _normalize_text(address)
    candidates = {
        "phan van hon": (10.8249, 106.6188),
        "nguyen van sang": (10.7910, 106.6255),
        "tan ky tan quy": (10.7932, 106.6250),
        "luy ban bich": (10.7818, 106.6364),
        "au co": (10.7864, 106.6402),
        "truong chinh": (10.8031, 106.6287),
        "tan phu": (10.7910, 106.6255),
    }
    for key, point in candidates.items():
        if key in normalized:
            return point
    return None


def geocode_address(address: str) -> tuple[float, float]:
    normalized = (address or "").strip()
    if not normalized:
        raise GeocodingError("Địa chỉ geocoding không hợp lệ")

    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    encoded_address = quote_plus(normalized)

    if api_key:
        geocode_url = (
            "https://maps.googleapis.com/maps/api/geocode/json"
            f"?address={encoded_address}&key={api_key}"
        )
        try:
            with urlopen(geocode_url, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
            results = payload.get("results", [])
            status = payload.get("status")
            if status == "OK" and results:
                location = results[0]["geometry"]["location"]
                return float(location["lat"]), float(location["lng"])
        except Exception:
            pass

    nominatim_url = (
        "https://nominatim.openstreetmap.org/search"
        f"?q={encoded_address}&format=json&limit=1&countrycodes=vn"
    )
    try:
        req = Request(nominatim_url, headers={"User-Agent": "smart-parking-app/1.0"})
        with urlopen(req, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise GeocodingError("Không gọi được dịch vụ geocoding") from exc

    if payload:
        return float(payload[0]["lat"]), float(payload[0]["lon"])

    local_point = _local_geocode_fallback(normalized)
    if local_point:
        return local_point

    raise GeocodingError("Không tìm thấy tọa độ cho địa chỉ đã nhập")
