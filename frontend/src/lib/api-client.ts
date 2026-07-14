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

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

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
 * 2. On 401, attempts a silent token refresh and retries once
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

  let res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  // Silent refresh on 401
  if (res.status === 401 && accessToken) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${accessToken}`);
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(
      res.status,
      (body as { message?: string }).message ?? res.statusText,
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ── Auth helpers ──

export async function apiLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  accessToken = data.accessToken;
  return data;
}

export async function apiRegister(
  email: string,
  password: string,
  name: string,
): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  accessToken = data.accessToken;
  return data;
}

export async function apiLogout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    accessToken = null;
  }
}

export async function apiRefreshToken(): Promise<AuthResponse | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) return null;

    const data = (await res.json()) as AuthResponse;
    accessToken = data.accessToken;
    return data;
  } catch {
    return null;
  }
}
