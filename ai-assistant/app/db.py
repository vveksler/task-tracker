"""
Postgres connection pool. Same database the NestJS backend already uses —
no new infrastructure, just the pgvector extension enabled on it.
"""

from __future__ import annotations

import logging
import ssl
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import asyncpg
from app.config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


def _dsn_and_connect_kwargs(database_url: str) -> tuple[str, dict[str, Any]]:
    """
    Prepare DSN + asyncpg kwargs for Railway / local Postgres.

    asyncpg does not accept libpq's sslmode the same way as Prisma/psycopg.
    For Railway hosts we enable TLS with CERT_NONE (encrypt, don't verify),
    matching typical managed-Postgres "sslmode=require" behaviour.
    """
    parsed = urlparse(database_url)
    host = (parsed.hostname or "").lower()
    pairs = parse_qsl(parsed.query, keep_blank_values=True)

    sslmodes = [v.lower() for k, v in pairs if k.lower() == "sslmode"]
    rest = [(k, v) for k, v in pairs if k.lower() not in ("sslmode", "ssl")]
    clean = urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            urlencode(rest),
            parsed.fragment,
        )
    )

    # Private Railway DNS usually speaks plain Postgres; the public TCP proxy
    # (*.rlwy.net / *.railway.app) needs TLS. Also honor explicit sslmode=.
    is_railway_private = host.endswith(".railway.internal")
    is_railway_public = host.endswith(".rlwy.net") or (
        host.endswith(".railway.app") and not is_railway_private
    )
    wants_ssl = any(
        m in ("require", "verify-ca", "verify-full", "prefer") for m in sslmodes
    ) or is_railway_public

    kwargs: dict[str, Any] = {}
    if wants_ssl:
        ctx = ssl.create_default_context()
        # Railway / many managed PG endpoints need encryption without
        # full CA verification on the client.
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kwargs["ssl"] = ctx

    return clean, kwargs


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        dsn, kwargs = _dsn_and_connect_kwargs(settings.database_url)
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=1,
            max_size=5,
            **kwargs,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def try_connect_pool() -> bool:
    """Best-effort connect for startup logging; does not raise."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception:
        logger.exception("Postgres pool not ready yet")
        return False
