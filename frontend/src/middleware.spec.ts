/**
 * Auth middleware tests.
 *
 * These tests cover the exact bug that caused the auth redirect loop:
 * serverFetch called /auth/refresh which rotated the token, but Server
 * Components can't call cookies().set() — so the new token was lost.
 * Middleware solves this by running before the page render and being
 * able to set response cookies.
 *
 * Key scenarios tested:
 * - Rotated refresh token is persisted in the response cookie
 * - Access token is passed to Server Components via x-access-token header
 * - Missing/invalid cookie → redirect to login
 * - Backend failure → redirect to login with cookie cleared
 */

import { middleware } from './middleware';

// ── NextRequest / NextResponse stubs ──

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

// Minimal mock for NextResponse since Jest doesn't have the real Next.js runtime
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
      refreshToken: 'rotated-refresh-token',
      user: { id: '1', email: 'a@b.com', name: 'Alice' },
    };

    beforeEach(() => {
      mockFetch().mockReturnValue(jsonResponse(backendResponse));
    });

    it('should call backend /auth/refresh with the token in the body', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'old-refresh-token',
      });
      await middleware(req);

      expect(mockFetch()).toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refreshToken: 'old-refresh-token' }),
        }),
      );
    });

    it('should persist the ROTATED refresh token in the response cookie', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'old-refresh-token',
      });
      const res = await middleware(req);

      const cookie = (res as any)._cookies.get('refresh_token');
      expect(cookie).toBeDefined();
      expect(cookie.value).toBe('rotated-refresh-token');
      expect(cookie.options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    });

    it('should pass the access token via x-access-token request header', async () => {
      const req = makeRequest(`${BASE}/workspaces/abc`, {
        refresh_token: 'old-refresh-token',
      });
      const res = await middleware(req);

      const requestHeaders = (res as any)._requestHeaders as Headers;
      expect(requestHeaders).toBeDefined();
      expect(requestHeaders.get('x-access-token')).toBe('new-access-token');
    });

    it('should NOT redirect — allows the page to render', async () => {
      const req = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'old-refresh-token',
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

  describe('token rotation persistence (the original bug)', () => {
    it('consecutive navigations should use the rotated token, not the original', async () => {
      // Simulates the exact bug: two navigations in sequence.
      // First nav: old-token → backend rotates to token-v2
      // Second nav: should use token-v2, NOT old-token

      mockFetch()
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: 'access-1',
            refreshToken: 'token-v2',
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: 'access-2',
            refreshToken: 'token-v3',
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        );

      // First navigation — middleware receives old cookie
      const req1 = makeRequest(`${BASE}/workspaces`, {
        refresh_token: 'old-token',
      });
      const res1 = await middleware(req1);

      // Middleware set the rotated token in the response cookie
      const rotatedCookie = (res1 as any)._cookies.get('refresh_token');
      expect(rotatedCookie.value).toBe('token-v2');

      // Second navigation — browser would send the rotated cookie
      const req2 = makeRequest(`${BASE}/workspaces/abc`, {
        refresh_token: rotatedCookie.value,
      });
      const res2 = await middleware(req2);

      // Verify the second call used the rotated token
      const secondCall = mockFetch().mock.calls[1];
      expect(JSON.parse(secondCall[1].body)).toEqual({
        refreshToken: 'token-v2',
      });

      // And the response has the next rotation
      const nextCookie = (res2 as any)._cookies.get('refresh_token');
      expect(nextCookie.value).toBe('token-v3');
    });
  });
});
