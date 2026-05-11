import os
import time
from collections import defaultdict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp


class SecurityGatewayMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self.rate_limit_per_minute = int(os.getenv("GATEWAY_RATE_LIMIT_PER_MINUTE", "600"))
        self.login_rate_limit_per_minute = int(os.getenv("GATEWAY_LOGIN_RATE_LIMIT_PER_MINUTE", "30"))
        self.max_request_bytes = int(os.getenv("GATEWAY_MAX_REQUEST_BYTES", str(2 * 1024 * 1024)))
        self._request_buckets: dict[str, deque[float]] = defaultdict(deque)
        self._login_buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _get_client_ip(self, request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _is_limited(self, bucket: deque[float], now_ts: float, limit: int) -> bool:
        cutoff = now_ts - 60
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            return True
        bucket.append(now_ts)
        return False

    def _check_rate_limit(self, request: Request, client_ip: str) -> bool:
        now_ts = time.time()
        is_login_path = request.url.path == "/auth/login"

        with self._lock:
            if self._is_limited(self._request_buckets[client_ip], now_ts, self.rate_limit_per_minute):
                return True
            if is_login_path and self._is_limited(self._login_buckets[client_ip], now_ts, self.login_rate_limit_per_minute):
                return True
        return False

    def _apply_security_headers(self, response: JSONResponse, request: Request) -> JSONResponse:
        origin = request.headers.get("origin")
        allowed_origins = ["http://localhost:5173", "http://localhost:3000"]
        if origin in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"

        if os.getenv("ENABLE_HSTS", "false").lower() == "true":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > self.max_request_bytes:
            response = JSONResponse(
                status_code=413,
                content={"detail": "Request quá lớn"},
            )
            return self._apply_security_headers(response, request)

        client_ip = self._get_client_ip(request)
        if self._check_rate_limit(request, client_ip):
            response = JSONResponse(
                status_code=429,
                content={"detail": "Quá nhiều yêu cầu. Vui lòng thử lại sau."},
                headers={"Retry-After": "60"},
            )
            return self._apply_security_headers(response, request)

        try:
            response = await call_next(request)
        except Exception:
            response = JSONResponse(
                status_code=500,
                content={"detail": "Lỗi máy chủ nội bộ"},
            )

        return self._apply_security_headers(response, request)
