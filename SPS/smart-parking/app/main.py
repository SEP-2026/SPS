import asyncio
import logging
import os

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from starlette.websockets import WebSocketDisconnect
from app.database import engine
from app.routes import admin, auth, booking, employee, gate, owner, owner_finance, payment, review, vehicle, wallet
from app.realtime import realtime_hub

app = FastAPI()

logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://localhost(:[0-9]+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("qrcodes", exist_ok=True)
app.mount("/qrcodes", StaticFiles(directory="qrcodes"), name="qrcodes")

app.include_router(booking.router)
app.include_router(payment.router)
app.include_router(auth.router)
app.include_router(vehicle.router)
app.include_router(wallet.router)
app.include_router(owner.router)
app.include_router(employee.router)
app.include_router(employee.owner_router)
app.include_router(review.router)
app.include_router(gate.router)
app.include_router(owner_finance.router)
app.include_router(admin.router)


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
