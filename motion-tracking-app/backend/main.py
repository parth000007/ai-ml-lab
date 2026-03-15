"""
main.py
FastAPI backend for the body motion tracking app.

Endpoints
---------
POST /sensor-data          — store a single sensor reading
GET  /session-data/{sid}   — retrieve all readings for a session
GET  /sessions             — list all session IDs
DELETE /session-data/{sid} — clear a session

WebSocket /ws              — stream sensor data in real time;
                             the client sends JSON, the server echoes
                             an ack with the motion_intensity back.

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

import math
import uuid
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import storage

app = FastAPI(title="Body Motion Tracking API", version="1.0.0")

# Allow the frontend (served from any origin during dev) to reach the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ──────────────────────────────────────────────────────────────────

class SensorReading(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int  = Field(..., description="Unix ms timestamp")
    ax: float = Field(..., description="Acceleration X (m/s²)")
    ay: float = Field(..., description="Acceleration Y (m/s²)")
    az: float = Field(..., description="Acceleration Z (m/s²)")
    alpha: float = Field(0.0, description="Orientation alpha (°)")
    beta:  float = Field(0.0, description="Orientation beta (°)")
    gamma: float = Field(0.0, description="Orientation gamma (°)")
    motion_intensity: float = Field(0.0, description="Computed intensity (m/s²)")


class ExportRequest(BaseModel):
    durations_ms: list[int] = Field(
        ..., description="List of time window durations (ms) to export"
    )


# ── REST Endpoints ────────────────────────────────────────────────────────────

@app.post("/sensor-data", status_code=201)
async def post_sensor_data(reading: SensorReading) -> dict[str, Any]:
    """Store a single sensor reading."""
    record = reading.model_dump()
    storage.append(reading.session_id, record)
    return {"status": "ok", "session_id": reading.session_id}


@app.get("/session-data/{session_id}")
async def get_session_data(session_id: str) -> dict[str, Any]:
    """Return all stored readings for a session."""
    data = storage.get_session(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found or empty")
    return {"session_id": session_id, "count": len(data), "data": data}


@app.get("/sessions")
async def list_sessions() -> dict[str, Any]:
    """List all active session IDs."""
    return {"sessions": storage.list_sessions()}


@app.delete("/session-data/{session_id}", status_code=200)
async def delete_session(session_id: str) -> dict[str, str]:
    """Delete all data for a session."""
    storage.clear_session(session_id)
    return {"status": "deleted", "session_id": session_id}


@app.post("/session-data/{session_id}/export")
async def export_session_data(
    session_id: str,
    request: ExportRequest,
) -> dict[str, Any]:
    """Export session readings into CSV files for each duration window."""
    if not storage.get_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found or empty")

    try:
        exports = storage.export_session(session_id, request.durations_ms)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"session_id": session_id, "exports": exports}


# ── WebSocket Endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """
    Accept a WebSocket connection from the frontend.
    The client sends JSON objects matching SensorReading (session_id optional).
    The server stores each reading and echoes back an acknowledgement.
    """
    await ws.accept()
    session_id: str | None = None

    try:
        while True:
            payload: dict[str, Any] = await ws.receive_json()

            # Assign or reuse session ID
            session_id = payload.get("session_id") or session_id or str(uuid.uuid4())
            payload["session_id"] = session_id

            # Compute intensity server-side if not provided
            if "motion_intensity" not in payload or payload["motion_intensity"] == 0:
                ax = float(payload.get("ax", 0))
                ay = float(payload.get("ay", 0))
                az = float(payload.get("az", 0))
                payload["motion_intensity"] = math.sqrt(ax**2 + ay**2 + az**2)

            storage.append(session_id, payload)

            await ws.send_json({
                "status": "ok",
                "session_id": session_id,
                "motion_intensity": payload["motion_intensity"],
            })

    except WebSocketDisconnect:
        pass  # client disconnected — normal
