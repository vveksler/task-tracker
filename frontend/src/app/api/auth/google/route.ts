import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_MAX_AGE = 10 * 60; // 10 minutes

export async function GET() {
  const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
  const callbackUrl =
    process.env['GOOGLE_CALLBACK_URL'] ??
    'http://localhost:3000/api/auth/google/callback';

  if (!clientId) {
    return NextResponse.redirect(
      new URL(
        '/auth/login?error=google_not_configured',
        process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
      ),
    );
  }

  const state = randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE,
  });

  return response;
}
