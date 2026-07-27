import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  BACKEND_URL,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  type BackendAuthResponse,
} from '../../cookie-config';

const OAUTH_STATE_COOKIE = 'oauth_state';
const APP_ORIGIN = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';

function loginErrorRedirect(code: string) {
  return NextResponse.redirect(new URL(`/auth/login?error=${code}`, APP_ORIGIN));
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
    return loginErrorRedirect('google');
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginErrorRedirect('google');
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!backendRes.ok) {
      return loginErrorRedirect('google');
    }

    const data = (await backendRes.json()) as BackendAuthResponse;
    const response = NextResponse.redirect(new URL('/workspaces', APP_ORIGIN));
    response.cookies.set(
      REFRESH_COOKIE_NAME,
      data.refreshToken,
      refreshCookieOptions(),
    );
    return response;
  } catch {
    return loginErrorRedirect('google');
  }
}
