from __future__ import annotations

import json
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

VIETQR_BANKS_URL = "https://api.vietqr.io/v2/banks"
VIETQR_LOOKUP_URL = "https://api.vietqr.io/v2/lookup"
_CACHE_TTL_SECONDS = 60 * 60 * 24
_banks_cache: dict[str, Any] = {"items": None, "fetched_at": 0.0}


class VietQRError(Exception):
    pass


def _request_json(url: str, *, method: str = "GET", payload: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
    body = None
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")
        raise VietQRError(f"VietQR trả về lỗi HTTP {error.code}: {detail or error.reason}") from error
    except URLError as error:
        raise VietQRError("Không kết nối được tới VietQR. Vui lòng thử lại sau.") from error

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise VietQRError("Phản hồi VietQR không hợp lệ.") from error
    if not isinstance(data, dict):
        raise VietQRError("Phản hồi VietQR không hợp lệ.")
    return data


def _serialize_bank(bank: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": bank.get("id"),
        "name": bank.get("name") or "",
        "code": bank.get("code") or "",
        "bin": str(bank.get("bin") or ""),
        "shortName": bank.get("shortName") or bank.get("short_name") or bank.get("code") or "",
        "logo": bank.get("logo") or "",
        "lookupSupported": bool(bank.get("lookupSupported")),
        "transferSupported": bool(bank.get("transferSupported")),
    }


def get_banks(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    now = time.time()
    cached_items = _banks_cache.get("items")
    if cached_items and not force_refresh and now - float(_banks_cache.get("fetched_at") or 0) < _CACHE_TTL_SECONDS:
        return cached_items

    payload = _request_json(VIETQR_BANKS_URL)
    if payload.get("code") != "00":
        raise VietQRError(payload.get("desc") or "Không tải được danh sách ngân hàng.")

    banks = [_serialize_bank(item) for item in (payload.get("data") or []) if isinstance(item, dict)]
    banks.sort(key=lambda item: (item.get("shortName") or "").lower())
    _banks_cache["items"] = banks
    _banks_cache["fetched_at"] = now
    return banks


def lookup_account_holder(*, bank_bin: str, account_number: str) -> dict[str, Any]:
    normalized_bin = "".join(ch for ch in str(bank_bin or "") if ch.isdigit())
    normalized_account = "".join(ch for ch in str(account_number or "") if ch.isdigit())
    if len(normalized_bin) < 6:
        raise VietQRError("Mã BIN ngân hàng không hợp lệ.")
    if len(normalized_account) < 6:
        raise VietQRError("Số tài khoản phải có ít nhất 6 chữ số.")

    client_id = os.getenv("VIETQR_CLIENT_ID", "").strip()
    api_key = os.getenv("VIETQR_API_KEY", "").strip()
    if not client_id or not api_key:
        raise VietQRError(
            "Chưa cấu hình VietQR API Key trên máy chủ. Vui lòng nhập tên chủ tài khoản thủ công."
        )

    payload = _request_json(
        VIETQR_LOOKUP_URL,
        method="POST",
        payload={"bin": normalized_bin, "accountNumber": normalized_account},
        headers={
            "x-client-id": client_id,
            "x-api-key": api_key,
        },
    )
    if payload.get("code") != "00":
        raise VietQRError(payload.get("desc") or "Không tra cứu được chủ tài khoản.")

    account_name = ((payload.get("data") or {}).get("accountName") or "").strip()
    if not account_name:
        raise VietQRError("Không tìm thấy tên chủ tài khoản.")

    return {
        "accountName": account_name,
        "bankBin": normalized_bin,
        "accountNumber": normalized_account,
    }
