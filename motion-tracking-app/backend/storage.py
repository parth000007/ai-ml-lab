"""
storage.py
In-memory session data store for the motion tracking backend.

Stores up to MAX_RECORDS sensor readings per session.
Each record is a dict matching the SensorReading schema.
"""
from __future__ import annotations

from collections import deque
import csv
from pathlib import Path
from typing import Any

MAX_RECORDS = 5000  # keep last N readings in memory
EXPORT_DIR = Path(__file__).resolve().parent / "exports"
EXPORT_FIELDS = ("timestamp", "ax", "ay", "az", "alpha", "beta", "gamma")

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


def export_session(session_id: str, durations_ms: list[int]) -> dict[int, list[str]]:
    """Export session readings into CSV files split by duration (ms)."""
    data = get_session(session_id)
    if not data:
        return {}

    _validate_durations(durations_ms)
    sorted_data = sorted(data, key=lambda record: record.get("timestamp", 0))
    start_timestamp = int(sorted_data[0].get("timestamp", 0))
    export_root = EXPORT_DIR / session_id
    export_root.mkdir(parents=True, exist_ok=True)

    results: dict[int, list[str]] = {}
    for duration_ms in durations_ms:
        windows: dict[int, list[dict[str, Any]]] = {}
        for record in sorted_data:
            timestamp = int(record.get("timestamp", start_timestamp))
            window_index = int((timestamp - start_timestamp) // duration_ms)
            windows.setdefault(window_index, []).append(record)

        file_paths: list[str] = []
        for window_index in sorted(windows):
            records = windows[window_index]
            window_start = int(records[0].get("timestamp", start_timestamp))
            window_end = int(records[-1].get("timestamp", window_start))
            filename = (
                f"{session_id}_{duration_ms}ms_{window_index + 1}_"
                f"{window_start}_{window_end}.csv"
            )
            file_path = export_root / filename
            _write_records(file_path, records)
            file_paths.append(str(file_path))

        results[duration_ms] = file_paths

    return results


def _validate_durations(durations_ms: list[int]) -> None:
    if not durations_ms or any(duration <= 0 for duration in durations_ms):
        raise ValueError("durations_ms must contain positive values")


def _write_records(file_path: Path, records: list[dict[str, Any]]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with file_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=EXPORT_FIELDS)
        writer.writeheader()
        for record in records:
            writer.writerow({field: record.get(field, 0) for field in EXPORT_FIELDS})
