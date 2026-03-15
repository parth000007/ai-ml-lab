"""
storage.py
In-memory session data store for the motion tracking backend.

Stores up to MAX_RECORDS sensor readings per session.
Each record is a dict matching the SensorReading schema.
"""
from __future__ import annotations

from collections import deque
from typing import Any

MAX_RECORDS = 5000  # keep last N readings in memory

# session_id → deque of reading dicts
_store: dict[str, deque[dict[str, Any]]] = {}


def get_or_create_session(session_id: str) -> deque[dict[str, Any]]:
    """Return the deque for session_id, creating it if necessary."""
    if session_id not in _store:
        _store[session_id] = deque(maxlen=MAX_RECORDS)
    return _store[session_id]


def append(session_id: str, record: dict[str, Any]) -> None:
    """Append a reading to the given session's store."""
    get_or_create_session(session_id).append(record)


def get_session(session_id: str) -> list[dict[str, Any]]:
    """Return all stored readings for a session as a list."""
    return list(_store.get(session_id, []))


def list_sessions() -> list[str]:
    """Return all known session IDs."""
    return list(_store.keys())


def clear_session(session_id: str) -> None:
    """Remove all data for a session."""
    _store.pop(session_id, None)
