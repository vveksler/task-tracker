import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth middleware for protected routes.
 *
 * Why middleware instead of doing refresh inside serverFetch:
 * Server Components cannot call cookies().set() — only Route Handlers,
 * Server Actions, and Middleware can. Since /auth/refresh rotates the
 * refresh token (old revoked, new issued), we MUST persist the new token
 * in the cookie. Middleware is the right place: it runs before the page
 * renders and can modify both request headers and response cookies.
 *
 * Flow:
 * 1. Read refresh_token cookie
 * 2. Exchange it for a fresh access token + rotated refresh token
 * 3. Set the new refresh_token cookie on the response
 * 4. Pass the access token to Server Components via x-access-token header
 */

const BACKEND_URL =
  process.env['BACKEND_INTERNAL_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001';

const REFRESH_COOKIE = 'refresh_token';

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

export async function middleware(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  try {
    // rotate: false — middleware may fire multiple parallel RSC requests
    // per navigation; rotating on each would revoke the token before the
    // second request arrives. Rotation still happens on client-side BFF refresh.
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, rotate: false }),
    });

    if (!res.ok) {
      const response = NextResponse.redirect(
        new URL('/auth/login', request.url),
      );
      response.cookies.delete(REFRESH_COOKIE);
      return response;
    }

    const data = (await res.json()) as RefreshResponse;

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-access-token', data.accessToken);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  } catch {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }
}

export const config = {
  matcher: ['/workspaces/:path*'],
};
