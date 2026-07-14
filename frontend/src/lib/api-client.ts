'use client';

import type { AuthResponse } from '@/types/api';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

// Access token lives in memory — never in localStorage/sessionStorage
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
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
 * Silent token refresh via the BFF /api/auth/refresh route.
 * The Next.js Route Handler reads the httpOnly cookie on its own domain,
 * exchanges it with the backend, and returns a fresh access token.
 */
async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST' });

    if (!res.ok) return false;

    const data = (await res.json()) as AuthResponse;
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

/**
 * Typed fetch wrapper that:
 * 1. Attaches the Bearer token
 * 2. On 401, attempts a silent token refresh via BFF and retries once
 * 3. Throws ApiError with status for non-2xx responses
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
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

  let res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401 && accessToken) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${accessToken}`);
      res = await fetch(`${API_URL}${path}`, { ...init, headers });
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
): Promise<AuthResponse> {
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

  const data = (await res.json()) as AuthResponse;
  accessToken = data.accessToken;
  return data;
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
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST' });

    if (!res.ok) return null;

    const data = (await res.json()) as AuthResponse;
    accessToken = data.accessToken;
    return data;
  } catch {
    return null;
  }
}
