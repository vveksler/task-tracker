import { describe, expect, it } from 'vitest';
import { dsnAndConnectKwargs } from './db.js';

describe('dsnAndConnectKwargs', () => {
  it('local dsn has no ssl', () => {
    const { connectionString, ssl } = dsnAndConnectKwargs(
      'postgresql://tracker:tracker@localhost:5432/task_tracker',
    );
    expect(connectionString).toContain('localhost');
    expect(ssl).toBeUndefined();
  });

  it('railway internal plain without sslmode', () => {
    const { connectionString, ssl } = dsnAndConnectKwargs(
      'postgresql://postgres:secret@postgres.railway.internal:5432/railway',
    );
    expect(connectionString).toContain('railway.internal');
    expect(ssl).toBeUndefined();
  });

  it('sslmode=require enables ssl even on internal', () => {
    const { connectionString, ssl } = dsnAndConnectKwargs(
      'postgresql://postgres:secret@postgres.railway.internal:5432/railway?sslmode=require',
    );
    expect(connectionString).not.toContain('sslmode');
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it('railway public proxy enables ssl', () => {
    const { ssl } = dsnAndConnectKwargs(
      'postgresql://postgres:secret@maglev.proxy.rlwy.net:12345/railway',
    );
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });
});
