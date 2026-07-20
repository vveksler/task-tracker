import { NextRequest, NextResponse } from "next/server";
import {
  BACKEND_URL,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from "./app/api/auth/cookie-config";

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
 * Grace period: the backend implements a 30-second grace window for
 * recently-rotated tokens. If parallel requests (middleware + RSC) both
 * present the same token, the first rotates it normally; the second
 * finds the revoked token, sees it was rotated recently, follows the
 * replacedByHash chain, and returns a fresh access token without
 * re-rotating. This eliminates the race condition that previously
 * required rotate=false.
 *
 * Flow:
 * 1. Read refresh_token cookie
 * 2. Exchange it for a fresh access token + rotated refresh token
 * 3. Set the new refresh_token cookie on the response (if rotated)
 * 4. Pass the access token to Server Components via x-access-token header
 */

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

export async function middleware(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshToken) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  try {
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      const response = NextResponse.redirect(
        new URL("/auth/login", request.url),
      );
      response.cookies.delete(REFRESH_COOKIE_NAME);
      return response;
    }

    const data = (await res.json()) as RefreshResponse;

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-access-token", data.accessToken);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    // If backend rotated the token, persist the new refresh token.
    // Grace period responses return empty refreshToken — don't overwrite.
    if (data.refreshToken) {
      response.cookies.set(
        REFRESH_COOKIE_NAME,
        data.refreshToken,
        refreshCookieOptions(),
      );
    }

    return response;
  } catch {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}

export const config = {
  matcher: ["/workspaces/:path*"],
};
