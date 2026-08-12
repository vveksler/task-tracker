/**
 * AI Assistant microservice — RAG-based Q&A over workspace tasks.
 * Called internally by the NestJS backend only (never exposed directly).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { closePool, tryConnectPool } from './db.js';
import { createApp } from './routes.js';

function loadDotEnvIfPresent(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfPresent();
const config = loadConfig();
const app = createApp();

// Do not block process start on DB — Railway healthcheck hits /health/live.
void tryConnectPool();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`ai-assistant listening on http://0.0.0.0:${info.port}`);
  },
);

async function shutdown(): Promise<void> {
  await closePool();
  server.close();
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});
