'use client';

import type { AuthResponse } from '@/types/api';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

// Access token lives in memory — never in localStorage/sessionStorage
let accessToken: string | null = null;

/** Single-flight refresh so AuthProvider boot + apiFetch don't double-hit. */
let refreshInFlight: Promise<AuthResponse | null> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// Callback invoked when a 401 persists after refresh — lets AuthProvider
// clear user state without api-client depending on React.
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(cb: (() => void) | null): void {
  onSessionExpired = cb;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Read JWT `exp` without verifying the signature (client-side gate only).
 * Refresh ~30s before expiry to avoid the 401 → refresh → retry round-trip.
 */
export function isAccessTokenFresh(token: string, skewMs = 30_000): boolean {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return false;
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const json = atob(padded + '='.repeat(padLen));
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > Date.now() + skewMs;
  } catch {
    return false;
  }
}

async function refreshSession(): Promise<AuthResponse | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!res.ok) return null;
      const data = (await res.json()) as AuthResponse;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Ensure memory has a non-expired access token (refresh via BFF if needed).
 * Returns false when the refresh cookie is missing/invalid.
 */
async function ensureAccessToken(): Promise<boolean> {
  if (accessToken && isAccessTokenFresh(accessToken)) return true;
  const data = await refreshSession();
  return data !== null;
}

function buildAuthHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (
    init?.body &&
    typeof init.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

/**
 * Typed fetch wrapper that:
 * 1. Refreshes the access token proactively when missing/expired
 * 2. Attaches the Bearer token
 * 3. On 401, refreshes once more and retries
 * 4. Throws ApiError with status for non-2xx responses
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  await ensureAccessToken();

  let headers = buildAuthHeaders(init);
  let res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      headers = buildAuthHeaders(init);
      res = await fetch(`${API_URL}${path}`, { ...init, headers });
    } else {
      accessToken = null;
      onSessionExpired?.();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(
      res.status,
      (body as { message?: string }).message ?? res.statusText,
    );
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

/**
 * Same auth/refresh behaviour as apiFetch, but returns the raw Response
 * for streaming bodies (SSE). Does not consume or parse the body on success.
 */
export async function apiFetchStream(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  await ensureAccessToken();

  let headers = buildAuthHeaders(init);
  let res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      headers = buildAuthHeaders(init);
      res = await fetch(`${API_URL}${path}`, { ...init, headers });
    } else {
      accessToken = null;
      onSessionExpired?.();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(
      res.status,
      (body as { message?: string }).message ?? res.statusText,
    );
  }

  return res;
}

// ── Auth helpers — all go through the BFF (same-origin /api/auth/*) ──

export async function apiLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(
      res.status,
      (body as { message?: string }).message ?? res.statusText,
    );
  }

  const data = (await res.json()) as AuthResponse;
  accessToken = data.accessToken;
  return data;
}

export async function apiRegister(
  email: string,
  password: string,
  name: string,
): Promise<{ message: string }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(
      res.status,
      (body as { message?: string }).message ?? res.statusText,
    );
  }

  return (await res.json()) as { message: string };
}

export async function apiLogout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  } finally {
    accessToken = null;
  }
}

export async function apiRefreshToken(): Promise<AuthResponse | null> {
  return refreshSession();
}
