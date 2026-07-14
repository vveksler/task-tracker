import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, REFRESH_COOKIE_NAME } from '../cookie-config';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const refreshCookie = cookieStore.get(REFRESH_COOKIE_NAME);

  if (refreshCookie?.value) {
    const authHeader = req.headers.get('Authorization') ?? '';

    await fetch(`${BACKEND_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({ refreshToken: refreshCookie.value }),
    }).catch(() => {
      // Backend logout is best-effort — cookie is cleared regardless
    });
  }

  cookieStore.delete(REFRESH_COOKIE_NAME);

  return NextResponse.json({ message: 'Logged out' });
}
