import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side authenticated fetch for Server Components.
 *
 * The access token is provided by the auth middleware via the
 * x-access-token request header. Middleware also handles cookie
 * rotation, so serverFetch doesn't touch cookies at all.
 *
 * getAccessToken is wrapped in React cache() so that multiple
 * serverFetch calls within the same render tree share one read.
 */

const BACKEND_URL =
  process.env['BACKEND_INTERNAL_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001';

const getAccessToken = cache(async (): Promise<string | null> => {
  const h = await headers();
  return h.get('x-access-token');
});

/**
 * Fetch data from the backend API using server-side authentication.
 * Returns null if the user is not authenticated.
 */
export async function serverFetch<T>(path: string): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 401) return null;
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      (body as { message?: string }).message ?? `API error ${res.status}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Same as serverFetch but redirects to login when auth fails.
 */
export async function serverFetchOrRedirect<T>(path: string): Promise<T> {
  const result = await serverFetch<T>(path);
  if (result === null) redirect('/auth/login');
  return result;
}
