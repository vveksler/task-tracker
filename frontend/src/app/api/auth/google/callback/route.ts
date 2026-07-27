import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  BACKEND_URL,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  type BackendAuthResponse,
} from '../../cookie-config';

const OAUTH_STATE_COOKIE = 'oauth_state';

function appOrigin(req: NextRequest): string {
  return (
    process.env['APP_URL'] ??
    process.env['NEXT_PUBLIC_APP_URL'] ??
    req.nextUrl.origin
  );
}

function loginErrorRedirect(req: NextRequest, code: string) {
  return NextResponse.redirect(
    new URL(`/auth/login?error=${code}`, appOrigin(req)),
  );
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (oauthError) {
    return loginErrorRedirect(req, 'google');
  }

  // Direct hits without a Google code/state always fail — start at /api/auth/google.
  if (!code || !state || !expectedState || state !== expectedState) {
    return loginErrorRedirect(req, 'google');
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!backendRes.ok) {
      return loginErrorRedirect(req, 'google');
    }

    const data = (await backendRes.json()) as BackendAuthResponse;
    const response = NextResponse.redirect(
      new URL('/workspaces', appOrigin(req)),
    );
    response.cookies.set(
      REFRESH_COOKIE_NAME,
      data.refreshToken,
      refreshCookieOptions(),
    );
    return response;
  } catch {
    return loginErrorRedirect(req, 'google');
  }
}
