/**
 * Auth middleware tests.
 *
 * The middleware performs full token rotation on each request. The backend's
 * grace period handles the race condition where parallel requests (layout +
 * page) both present the same token — the first rotates it, the second
 * finds the revoked token within the grace window and follows the
 * replacedByHash chain to get a fresh access token.
 *
 * Key scenarios tested:
 * - Full rotation: new refresh token is set as cookie
 * - Grace period: parallel request gets access token (empty refreshToken)
 * - Access token is passed to Server Components via x-access-token header
 * - Missing/invalid cookie → redirect to login
 * - Backend failure → redirect to login with cookie cleared
 */

import { middleware } from './middleware';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
  process.env['NODE_ENV'] = 'test';
});

afterEach(() => {
  global.fetch = originalFetch;
});

const mockFetch = () => global.fetch as jest.Mock;

function makeRequest(
  url: string,
  cookies: Record<string, string> = {},
): Parameters<typeof middleware>[0] {
  return {
    url,
    cookies: {
      get: (name: string) => {
        const value = cookies[name];
        return value ? { name, value } : undefined;
      },
    },
    headers: new Headers(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    _headers: Map<string, string>;
    _cookies: Map<string, { value: string; options?: Record<string, unknown> }>;
    _requestHeaders?: Headers;
    _redirectUrl?: string;

    constructor(body?: unknown, init?: { status?: number; headers?: Headers }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this._headers = new Map();
      this._cookies = new Map();
    }

    get cookies() {
      const self = this;
      return {
        set(name: string, value: string, options?: Record<string, unknown>) {
          self._cookies.set(name, { value, options });
        },
        delete(name: string) {
          self._cookies.set(name, { value: '', options: { maxAge: 0 } });
        },
        get(name: string) {
          return self._cookies.get(name);
        },
      };
    }

    get headers() {
      const self = this;
      return {
        get(name: string) {
          return self._headers.get(name) ?? null;
        },
      };
    }

    static next(opts?: { request?: { headers?: Headers } }) {
      const res = new MockNextResponse();
      res._requestHeaders = opts?.request?.headers;
      return res;
    }

    static redirect(url: URL) {
      const res = new MockNextResponse(null, { status: 307 });
      res._redirectUrl = url.toString();
      return res;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }

  return {
    NextResponse: MockNextResponse,
    NextRequest: class {},
  };
});

describe('auth middleware', () => {
  const BASE = 'http://localhost:3000';

  describe('when no refresh_token cookie exists', () => {
    it('should redirect to /auth/login', async () => {
      const req = makeRequest(`${BASE}/workspaces`);
      const res = await middleware(req);

      expect((res as any)._redirectUrl).toBe(`${BASE}/auth/login`);
      expect(mockFetch()).not.toHaveBeenCalled();
    });
  });

  describe('when refresh_token cookie exists and backend rotates', () => {
    const backendResponse = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: { id: '1', email: 'a@b.com', name: 'Alice' },
    };

    beforeEach(() => {
      mockFetch().mockReturnValue(jsonResponse(backendResponse));
    });

    it('should call backend with the refresh token (full rotation)', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'my-refresh-token',
      });
      await middleware(req);

      const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ refreshToken: 'my-refresh-token' });
    });

    it('should set the new refresh_token cookie after rotation', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'my-refresh-token',
      });
      const res = await middleware(req);

      const cookie = (res as any)._cookies.get('refresh_token');
      expect(cookie).toBeDefined();
      expect(cookie.value).toBe('new-refresh-token');
    });

    it('should pass the access token via x-access-token request header', async () => {
      const req = makeRequest(`${BASE}/workspaces/abc`, {
        refresh_token: 'my-refresh-token',
      });
      const res = await middleware(req);

      const requestHeaders = (res as any)._requestHeaders as Headers;
      expect(requestHeaders).toBeDefined();
      expect(requestHeaders.get('x-access-token')).toBe('new-access-token');
    });

    it('should NOT redirect — allows the page to render', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'my-refresh-token',
      });
      const res = await middleware(req);

      expect((res as any)._redirectUrl).toBeUndefined();
    });
  });

  describe('when backend returns a grace period response (empty refreshToken)', () => {
    const gracePeriodResponse = {
      accessToken: 'grace-access-token',
      refreshToken: '',
      user: { id: '1', email: 'a@b.com', name: 'Alice' },
    };

    beforeEach(() => {
      mockFetch().mockReturnValue(jsonResponse(gracePeriodResponse));
    });

    it('should NOT overwrite the cookie (empty refreshToken = grace period)', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'old-token',
      });
      const res = await middleware(req);

      expect((res as any)._cookies.size).toBe(0);
    });

    it('should still pass the access token via x-access-token header', async () => {
      const req = makeRequest(`${BASE}/workspaces/abc`, {
        refresh_token: 'old-token',
      });
      const res = await middleware(req);

      const requestHeaders = (res as any)._requestHeaders as Headers;
      expect(requestHeaders.get('x-access-token')).toBe('grace-access-token');
    });
  });

  describe('when backend rejects the refresh token (revoked/expired)', () => {
    beforeEach(() => {
      mockFetch().mockReturnValue(
        jsonResponse({ message: 'Token revoked' }, 401),
      );
    });

    it('should redirect to /auth/login', async () => {
      const req = makeRequest(`${BASE}/workspaces/123/projects`, {
        refresh_token: 'revoked-token',
      });
      const res = await middleware(req);

      expect((res as any)._redirectUrl).toBe(`${BASE}/auth/login`);
    });

    it('should clear the invalid refresh_token cookie', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'revoked-token',
      });
      const res = await middleware(req);

      const cookie = (res as any)._cookies.get('refresh_token');
      expect(cookie).toBeDefined();
      expect(cookie.options?.maxAge).toBe(0);
    });
  });

  describe('when backend is unreachable', () => {
    it('should redirect to /auth/login', async () => {
      mockFetch().mockRejectedValue(new Error('ECONNREFUSED'));

      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'some-token',
      });
      const res = await middleware(req);

      expect((res as any)._redirectUrl).toBe(`${BASE}/auth/login`);
    });
  });

  describe('parallel RSC requests (grace period handles the race)', () => {
    it('first request rotates, second gets grace period response — both succeed', async () => {
      // First request: normal rotation
      // Second request: grace period (token was just rotated by first)
      mockFetch()
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: 'access-token-1',
            refreshToken: 'new-token',
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: 'access-token-2',
            refreshToken: '', // grace period — no new token
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        );

      const req1 = makeRequest(`${BASE}/workspaces/abc`, {
        refresh_token: 'same-token',
      });
      const req2 = makeRequest(`${BASE}/workspaces/abc`, {
        refresh_token: 'same-token',
      });

      const [res1, res2] = await Promise.all([
        middleware(req1),
        middleware(req2),
      ]);

      // Both succeed (no redirect)
      expect((res1 as any)._redirectUrl).toBeUndefined();
      expect((res2 as any)._redirectUrl).toBeUndefined();

      // Both pass access tokens
      expect((res1 as any)._requestHeaders.get('x-access-token')).toBe('access-token-1');
      expect((res2 as any)._requestHeaders.get('x-access-token')).toBe('access-token-2');

      // First request updates cookie, second does not
      expect((res1 as any)._cookies.get('refresh_token')?.value).toBe('new-token');
      expect((res2 as any)._cookies.size).toBe(0);
    });
  });
});
