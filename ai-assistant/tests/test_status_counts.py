"""Unit tests for workspace catalog helpers (no DB)."""

from app.workspace_context import _status_counts


def test_status_counts():
    tasks = [
        {"status": "TODO"},
        {"status": "IN_PROGRESS"},
        {"status": "IN_PROGRESS"},
        {"status": "DONE"},
        {"status": "DONE"},
        {"status": "DONE"},
    ]
    assert _status_counts(tasks) == {
        "TODO": 1,
        "IN_PROGRESS": 2,
        "IN_REVIEW": 0,
        "DONE": 3,
    }
