/**
 * Postgres pool. Same database Nest uses — pgvector extension required.
 * Port of Python db.py Railway SSL / sslmode handling for node-postgres.
 */

import { Pool, type PoolConfig } from 'pg';
import { getConfig } from './config.js';

export type ConnectPrep = {
  connectionString: string;
  ssl: PoolConfig['ssl'] | undefined;
};

/**
 * Prepare DSN + SSL for Railway / local Postgres.
 * node-postgres honors connectionString; we strip sslmode and set ssl explicitly
 * (rejectUnauthorized: false ≈ CERT_NONE for managed endpoints).
 */
export function dsnAndConnectKwargs(databaseUrl: string): ConnectPrep {
  const parsed = new URL(databaseUrl);
  const host = (parsed.hostname || '').toLowerCase();

  const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase();
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('ssl');

  const isRailwayPrivate = host.endsWith('.railway.internal');
  const isRailwayPublic =
    host.endsWith('.rlwy.net') ||
    (host.endsWith('.railway.app') && !isRailwayPrivate);
  const wantsSsl =
    (sslmode !== undefined &&
      ['require', 'verify-ca', 'verify-full', 'prefer'].includes(sslmode)) ||
    isRailwayPublic;

  let ssl: PoolConfig['ssl'] | undefined;
  if (wantsSsl) {
    ssl = {
      rejectUnauthorized: false,
    };
  }

  const connectionString = parsed
    .toString()
    .replace(/^postgres:/, 'postgresql:');

  return { connectionString, ssl };
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const { databaseUrl } = getConfig();
  const { connectionString, ssl } = dsnAndConnectKwargs(databaseUrl);
  pool = new Pool({
    connectionString,
    ssl,
    max: 5,
    min: 1,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Best-effort connect for startup logging; does not throw. */
export async function tryConnectPool(): Promise<boolean> {
  try {
    const p = getPool();
    await p.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('Postgres pool not ready yet', err);
    return false;
  }
}
