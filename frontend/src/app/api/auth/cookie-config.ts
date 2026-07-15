/**
 * Shared cookie configuration for the BFF auth layer.
 *
 * The refresh token cookie is set on the Next.js domain (not the backend).
 * This means Server Components can read it via cookies() from next/headers,
 * eliminating the cross-origin cookie problem in dev.
 */

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export const BACKEND_URL =
  process.env['BACKEND_INTERNAL_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001';

export interface BackendAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

export function refreshCookieOptions() {
  // COOKIE_SECURE lets us run NODE_ENV=production without TLS (e.g. minikube).
  // Defaults to true in production, false otherwise.
  const secure =
    process.env['COOKIE_SECURE'] !== undefined
      ? process.env['COOKIE_SECURE'] === 'true'
      : process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  };
}
