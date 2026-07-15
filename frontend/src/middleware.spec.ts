/**
 * Auth middleware tests.
 *
 * The middleware validates the refresh token with rotate=false so that
 * parallel RSC requests (layout + page) don't revoke each other's tokens.
 * Token rotation only happens on explicit client-side BFF refresh.
 *
 * Key scenarios tested:
 * - rotate: false is sent to the backend (no token rotation)
 * - Access token is passed to Server Components via x-access-token header
 * - Cookie is NOT rewritten (no rotation = no new cookie needed)
 * - Missing/invalid cookie → redirect to login
 * - Backend failure → redirect to login with cookie cleared
 * - Parallel requests don't interfere with each other
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

  describe('when refresh_token cookie exists and backend returns success', () => {
    const backendResponse = {
      accessToken: 'new-access-token',
      refreshToken: 'same-refresh-token',
      user: { id: '1', email: 'a@b.com', name: 'Alice' },
    };

    beforeEach(() => {
      mockFetch().mockReturnValue(jsonResponse(backendResponse));
    });

    it('should call backend with rotate: false to prevent parallel request conflicts', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'my-refresh-token',
      });
      await middleware(req);

      const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        refreshToken: 'my-refresh-token',
        rotate: false,
      });
    });

    it('should NOT set a new cookie (no rotation = cookie unchanged)', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'my-refresh-token',
      });
      const res = await middleware(req);

      expect((res as any)._cookies.size).toBe(0);
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

  describe('parallel RSC requests (the race condition fix)', () => {
    it('multiple simultaneous requests with the same token all succeed', async () => {
      // With rotate: false, both requests validate the same token
      // without revoking it — no race condition.
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'access-token',
          refreshToken: 'same-token',
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

      // Both pass the access token
      expect((res1 as any)._requestHeaders.get('x-access-token')).toBe('access-token');
      expect((res2 as any)._requestHeaders.get('x-access-token')).toBe('access-token');

      // Both sent rotate: false
      for (const call of mockFetch().mock.calls) {
        const body = JSON.parse(call[1].body as string);
        expect(body.rotate).toBe(false);
      }
    });
  });
});
