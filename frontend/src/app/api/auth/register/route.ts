import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  BACKEND_URL,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  type BackendAuthResponse,
} from '../cookie-config';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const backendRes = await fetch(`${BACKEND_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await backendRes.json();

  if (!backendRes.ok) {
    return NextResponse.json(data, { status: backendRes.status });
  }

  const { accessToken, refreshToken, user } = data as BackendAuthResponse;

  const cookieStore = await cookies();
  cookieStore.set(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());

  return NextResponse.json({ accessToken, user });
}
