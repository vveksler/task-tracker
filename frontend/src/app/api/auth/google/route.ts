import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_MAX_AGE = 10 * 60; // 10 minutes

function appOrigin(req: NextRequest): string {
  // Prefer the live request host (works on Railway without rebuild).
  // NEXT_PUBLIC_* is baked at Docker build time and often stays localhost.
  return (
    process.env['APP_URL'] ??
    process.env['NEXT_PUBLIC_APP_URL'] ??
    req.nextUrl.origin
  );
}

export async function GET(req: NextRequest) {
  const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
  const origin = appOrigin(req);
  const callbackUrl =
    process.env['GOOGLE_CALLBACK_URL'] ??
    `${origin}/api/auth/google/callback`;

  if (!clientId) {
    return NextResponse.redirect(
      new URL('/auth/login?error=google_not_configured', origin),
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
    // Compose/minikube use http://localhost — Secure cookies would be dropped.
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE,
  });

  return response;
}
