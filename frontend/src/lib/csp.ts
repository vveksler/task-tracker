/**
 * Content-Security-Policy (CSP) builder for the Next.js frontend.
 *
 * CSP is a browser-enforced allowlist of what a document may load/execute
 * (scripts, styles, XHR/fetch, WebSockets, frames, …). It mitigates XSS: even if
 * an attacker injects a <script>, the browser refuses to run it unless it matches
 * the policy.
 *
 * Set on the HTML *document* response (first load / full refresh). The browser
 * then applies that policy to everything the page does afterward (including soft
 * navigations and fetch/WebSocket). Do NOT rely on CSP on Nest JSON responses —
 * those are not documents; CORS + auth matter there instead.
 *
 * Middleware generates a fresh nonce per request and puts it in
 * Content-Security-Policy. next.config headers() cannot do nonces (they must
 * change every request). Next.js reads the CSP from the *request* headers
 * during SSR and stamps the nonce onto its own inline scripts.
 *
 * Trade-off vs static CSP in next.config:
 * - Static: simple, but needs script-src 'unsafe-inline' (weaker against XSS).
 * - Nonce (chosen): stricter script-src; costs dynamic rendering (no fully
 *   static HTML cache for pages that use the nonce).
 */

const isDev = process.env.NODE_ENV === 'development';

/** Extract origin (scheme + host + port) from a URL string. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** http(s)://host → ws(s)://host for Socket.io websocket upgrades. */
function wsOriginOf(url: string | undefined): string | null {
  const origin = originOf(url);
  if (!origin) return null;
  return origin.replace(/^http/i, 'ws');
}

/**
 * Browser-facing API / WS origins from NEXT_PUBLIC_* (not BACKEND_INTERNAL_URL —
 * that is server-only Docker DNS and never appears in the browser).
 */
function connectSrcExtra(): string[] {
  const api = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
  const ws = process.env['NEXT_PUBLIC_WS_URL'] ?? api;

  const origins = new Set<string>();
  const apiOrigin = originOf(api);
  const wsHttpOrigin = originOf(ws);
  const wsOrigin = wsOriginOf(ws);

  if (apiOrigin) origins.add(apiOrigin);
  if (wsHttpOrigin) origins.add(wsHttpOrigin); // Socket.io long-polling is HTTP
  if (wsOrigin) origins.add(wsOrigin);

  return [...origins];
}

/**
 * Whether CSP should force HTTPS upgrades for subresources.
 * Driven by the configured browser API scheme — not NODE_ENV alone —
 * because Compose/minikube run production builds over plain HTTP.
 */
function shouldUpgradeInsecureRequests(): boolean {
  const api = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
  const ws = process.env['NEXT_PUBLIC_WS_URL'] ?? api;
  const apiOrigin = originOf(api);
  const wsOrigin = originOf(ws);

  return (
    !!apiOrigin?.startsWith('https:') && !!wsOrigin?.startsWith('https:')
  );
}

/**
 * Build the CSP header value for one request.
 * @param nonce - base64 random value; must match what Next stamps on scripts
 */
export function buildCspHeader(nonce: string): string {
  const connectSrc = ["'self'", ...connectSrcExtra()].join(' ');

  // Directives listed with comments for readability.
  const directives = [
    // Fallback for any resource type not listed below.
    "default-src 'self'",

    // Scripts: only our origin + tags carrying this request's nonce.
    // 'strict-dynamic' lets nonce-trusted scripts load further scripts.
    // 'unsafe-eval' is required by Next/webpack HMR in development only.
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,

    // Tailwind / React often use style attributes; 'unsafe-inline' for styles
    // is a common pragmatic choice (XSS via CSS is a much smaller risk than JS).
    "style-src 'self' 'unsafe-inline'",

    // next/font self-hosts; data:/blob: cover avatars / canvas if added later.
    "img-src 'self' data: blob:",
    "font-src 'self'",

    // fetch, XHR, EventSource, WebSocket — must include Nest API + Socket.io.
    `connect-src ${connectSrc}`,

    // Disallow plugins / embedding us in foreign iframes (clickjacking).
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  // Forces HTTP→HTTPS for subresources. Only safe when the browser-facing API
  // is already HTTPS: Docker Compose / minikube run NODE_ENV=production with
  // http:// NEXT_PUBLIC_* URLs (COOKIE_SECURE=false), and this directive would
  // rewrite those fetches/WebSockets to https:// / wss:// and break the board.
  if (shouldUpgradeInsecureRequests()) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ').replace(/\s{2,}/g, ' ').trim();
}

/** Cryptographically random nonce for one HTML response. */
export function createCspNonce(): string {
  // getRandomValues works in Edge middleware and in Jest (jsdom); randomUUID
  // is missing in some test environments. Nonce need not be a UUID.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}
