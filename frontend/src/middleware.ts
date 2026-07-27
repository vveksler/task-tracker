import { NextRequest, NextResponse } from "next/server";
import {
  BACKEND_URL,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from "./app/api/auth/cookie-config";
import { buildCspHeader, createCspNonce } from "./lib/csp";

/**
 * Auth middleware for protected routes + CSP for all matched document routes.
 *
 * Why middleware instead of doing refresh inside serverFetch:
 * Server Components cannot call cookies().set() — only Route Handlers,
 * Server Actions, and Middleware can. Since /auth/refresh rotates the
 * refresh token (old revoked, new issued), we MUST persist the new token
 * in the cookie. Middleware is the right place: it runs before the page
 * renders and can modify both request headers and response cookies.
 *
 * Why CSP lives here (not only in next.config):
 * A strong script-src uses a per-request nonce. next.config headers() are
 * static at build time, so they cannot emit a fresh nonce. Middleware can.
 * We set CSP on both the request (so Next SSR can stamp nonces on scripts)
 * and the response (so the browser receives the policy on the HTML document).
 *
 * Grace period: the backend implements a 30-second grace window for
 * recently-rotated tokens. If parallel requests (middleware + RSC) both
 * present the same token, the first rotates it normally; the second
 * finds the revoked token, sees it was rotated recently, follows the
 * replacedByHash chain, and returns a fresh access token without
 * re-rotating. This eliminates the race condition that previously
 * required rotate=false.
 *
 * Flow (protected /workspaces):
 * 1. Build CSP nonce + header
 * 2. Read refresh_token cookie
 * 3. Exchange it for a fresh access token + rotated refresh token
 * 4. Set the new refresh_token cookie on the response (if rotated)
 * 5. Pass the access token to Server Components via x-access-token header
 * 6. Attach Content-Security-Policy on the way out
 */

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
}

function isProtectedPath(pathname: string): boolean {
  return pathname === "/workspaces" || pathname.startsWith("/workspaces/");
}

/** Put CSP on the browser-facing response (document). */
function setResponseCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function nextWithCsp(
  request: NextRequest,
  csp: string,
  nonce: string,
  extraRequestHeaders?: Record<string, string>,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  // Must be set *before* next(): Next SSR reads CSP/nonce from the request.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  if (extraRequestHeaders) {
    for (const [key, value] of Object.entries(extraRequestHeaders)) {
      requestHeaders.set(key, value);
    }
  }
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  return setResponseCsp(response, csp);
}

function redirectWithCsp(url: URL, csp: string): NextResponse {
  return setResponseCsp(NextResponse.redirect(url), csp);
}

export async function middleware(request: NextRequest) {
  const nonce = createCspNonce();
  const csp = buildCspHeader(nonce);

  // Public pages (login/register/home): CSP only, no auth gate.
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return nextWithCsp(request, csp, nonce);
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshToken) {
    const response = redirectWithCsp(
      new URL("/auth/login", request.url),
      csp,
    );
    return response;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      const response = redirectWithCsp(
        new URL("/auth/login", request.url),
        csp,
      );
      response.cookies.delete(REFRESH_COOKIE_NAME);
      return response;
    }

    const data = (await res.json()) as RefreshResponse;

    const response = nextWithCsp(request, csp, nonce, {
      "x-access-token": data.accessToken,
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
    return redirectWithCsp(new URL("/auth/login", request.url), csp);
  }
}

/**
 * Run on page navigations *and* Link prefetches; skip Next internals / static.
 * Auth still only applies inside isProtectedPath(); everything else gets CSP.
 *
 * Do NOT exclude next-router-prefetch / Purpose: prefetch. Server Components
 * read x-access-token from middleware. If prefetch skips middleware, layouts
 * like /workspaces/[id] call serverFetch without a token, cache
 * redirect('/auth/login'), and the first Link click after sign-in follows
 * that stale redirect. Backend refresh grace period covers parallel rotations.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
