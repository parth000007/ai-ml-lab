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
    """Return a mapping of duration (ms) to exported CSV file paths.

    Returned paths are relative to the exports directory. Exported filenames
    include Unix millisecond timestamps for the window boundaries to keep them
    sortable alongside the session data.
    """
    data = get_session(session_id)
    if not data:
        return {}

    validated_durations = _validate_durations(durations_ms)
    validated_data = _validate_records(data)
    sorted_data = sorted(validated_data, key=lambda record: record["timestamp"])
    if not sorted_data:
        return {}
    start_timestamp = int(sorted_data[0]["timestamp"])
    export_root = EXPORT_DIR / session_id
    export_root.mkdir(parents=True, exist_ok=True)

    results: dict[int, list[str]] = {}
    for duration_ms in validated_durations:
        time_windows: dict[int, list[dict[str, Any]]] = {}
        for record in sorted_data:
            timestamp = int(record["timestamp"])
            window_index = int((timestamp - start_timestamp) // duration_ms)
            time_windows.setdefault(window_index, []).append(record)

        file_paths: list[str] = []
        for window_index in sorted(time_windows):
            records = time_windows[window_index]
            first_timestamp = records[0]["timestamp"]
            last_timestamp = records[-1]["timestamp"]
            filename = (
                f"{session_id}_{duration_ms}ms_{first_timestamp}_{last_timestamp}.csv"
            )
            file_path = export_root / filename
            _write_records(file_path, records)
            file_paths.append(file_path.relative_to(EXPORT_DIR).as_posix())

        results[duration_ms] = file_paths

    return results


def _validate_durations(durations_ms: list[int]) -> list[int]:
    if not durations_ms:
        raise ValueError("durations_ms cannot be empty")
    try:
        validated = [int(duration) for duration in durations_ms]
    except (TypeError, ValueError) as exc:
        raise ValueError("durations_ms must contain only integer values") from exc
    if any(duration <= 0 for duration in validated):
        raise ValueError("durations_ms must contain only positive, non-zero values")
    return validated


def _validate_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    validated: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        timestamp = record.get("timestamp")
        if timestamp is None:
            raise ValueError(f"Record {index} is missing a timestamp")
        try:
            timestamp = int(timestamp)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Record {index} has an invalid timestamp: {timestamp}"
            ) from exc
        validated_record = dict(record)
        validated_record["timestamp"] = timestamp
        validated.append(validated_record)
    return validated


def _write_records(file_path: Path, records: list[dict[str, Any]]) -> None:
    """Write records to CSV, emitting empty strings for missing values."""
    with file_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=EXPORT_FIELDS)
        writer.writeheader()
        for record in records:
            row: dict[str, Any] = {}
            for field in EXPORT_FIELDS:
                value = record.get(field)
                row[field] = "" if value is None else value
            writer.writerow(row)
