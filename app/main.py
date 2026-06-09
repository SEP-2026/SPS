import logging
import os
import asyncio

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from starlette.websockets import WebSocketDisconnect

from app.init_db import init_db
from app.realtime import realtime_hub
from app.database import SessionLocal
from app.routes import admin, auth, booking, employee, gate, owner, owner_finance, payment, review, vehicle, wallet
from app.security.gateway import SecurityGatewayMiddleware
from app.services.auto_checkout_service import auto_checkout_expired_bookings

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SecurityGatewayMiddleware)

logger = logging.getLogger(__name__)
AUTO_CHECKOUT_INTERVAL_SECONDS = max(10, int(os.getenv("AUTO_CHECKOUT_INTERVAL_SECONDS", "30")))

os.makedirs("qrcodes", exist_ok=True)
app.mount("/qrcodes", StaticFiles(directory="qrcodes"), name="qrcodes")

app.include_router(booking.router)
app.include_router(gate.router)
app.include_router(payment.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(owner.router)
app.include_router(owner_finance.router)
app.include_router(vehicle.router)
app.include_router(wallet.router)
app.include_router(employee.router)
app.include_router(employee.owner_employee_router)
app.include_router(review.router)


@app.middleware("http")
async def broadcast_data_changes(request: Request, call_next):
    response = await call_next(request)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and 200 <= response.status_code < 400:
        await realtime_hub.notify_change(
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
        )
    return response


@app.on_event("startup")
def startup_init_db():
    try:
        init_db()
    except Exception:
        logger.exception("Database migration at startup failed; continuing with existing schema.")


async def _auto_checkout_worker():
    while True:
        db = SessionLocal()
        try:
            processed = auto_checkout_expired_bookings(db)
            if processed > 0:
                logger.info("Auto checkout completed for %s booking(s).", processed)
                await realtime_hub.notify_change(
                    method="SYSTEM",
                    path="/system/auto-checkout",
                    status_code=200,
                )
        except Exception:
            logger.exception("Auto checkout worker failed.")
        finally:
            db.close()
        await asyncio.sleep(AUTO_CHECKOUT_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup_auto_checkout_worker():
    app.state.auto_checkout_task = asyncio.create_task(_auto_checkout_worker())


@app.on_event("shutdown")
async def shutdown_auto_checkout_worker():
    task = getattr(app.state, "auto_checkout_task", None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


@app.get("/")
def root():
    return {"message": "API + CSDL đã sẵn sàng"}


@app.get("/ws-health")
def ws_health():
    return {"ok": True}


@app.websocket("/ws/updates")
async def ws_updates(websocket: WebSocket):
    await realtime_hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await realtime_hub.disconnect(websocket)
    except Exception:
        await realtime_hub.disconnect(websocket)
