"""Unit tests for Railway-friendly asyncpg DSN/SSL handling."""

import ssl

from app.db import _dsn_and_connect_kwargs


def test_local_dsn_no_ssl():
    dsn, kwargs = _dsn_and_connect_kwargs(
        "postgresql://tracker:tracker@localhost:5432/task_tracker"
    )
    assert "localhost" in dsn
    assert "ssl" not in kwargs


def test_railway_internal_plain_without_sslmode():
    dsn, kwargs = _dsn_and_connect_kwargs(
        "postgresql://postgres:secret@postgres.railway.internal:5432/railway"
    )
    assert "railway.internal" in dsn
    assert "ssl" not in kwargs


def test_sslmode_require_enables_ssl_even_on_internal():
    dsn, kwargs = _dsn_and_connect_kwargs(
        "postgresql://postgres:secret@postgres.railway.internal:5432/railway"
        "?sslmode=require"
    )
    assert "sslmode" not in dsn
    assert "ssl" in kwargs
    assert kwargs["ssl"].verify_mode == ssl.CERT_NONE


def test_railway_public_proxy_enables_ssl():
    _dsn, kwargs = _dsn_and_connect_kwargs(
        "postgresql://postgres:secret@maglev.proxy.rlwy.net:12345/railway"
    )
    assert "ssl" in kwargs
