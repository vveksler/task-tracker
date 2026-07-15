import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  BACKEND_URL,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  type BackendAuthResponse,
} from '../cookie-config';

export async function POST() {
  const cookieStore = await cookies();
  const refreshCookie = cookieStore.get(REFRESH_COOKIE_NAME);

  if (!refreshCookie?.value) {
    return NextResponse.json(
      { message: 'No refresh token' },
      { status: 401 },
    );
  }

  const backendRes = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshCookie.value }),
  });

  const data = await backendRes.json();

  if (!backendRes.ok) {
    cookieStore.delete(REFRESH_COOKIE_NAME);
    return NextResponse.json(data, { status: backendRes.status });
  }

  const { accessToken, refreshToken, user } = data as BackendAuthResponse;

  // Only update cookie if backend rotated (non-empty refreshToken).
  // Grace period responses return empty refreshToken.
  if (refreshToken) {
    cookieStore.set(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  }

  return NextResponse.json({ accessToken, user });
}
