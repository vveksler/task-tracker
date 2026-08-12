/**
 * API client tests — covers token management, silent refresh via BFF,
 * BFF auth routing, and error handling.
 */

import {
  apiFetch,
  ApiError,
  setAccessToken,
  getAccessToken,
  isAccessTokenFresh,
  apiLogin,
  apiRegister,
  apiLogout,
  apiRefreshToken,
} from './api-client';

const originalFetch = global.fetch;

beforeEach(() => {
  setAccessToken(null);
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const mockFetch = () => global.fetch as jest.Mock;

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);

/** Unsigned JWT with the given exp (unix seconds) — only for client freshness checks. */
function jwtWithExp(exp: number): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('isAccessTokenFresh', () => {
  it('returns true for a token that expires in the future', () => {
    expect(
      isAccessTokenFresh(jwtWithExp(Math.floor(Date.now() / 1000) + 3600)),
    ).toBe(true);
  });

  it('returns false for an expired token', () => {
    expect(
      isAccessTokenFresh(jwtWithExp(Math.floor(Date.now() / 1000) - 60)),
    ).toBe(false);
  });
});

describe('apiFetch', () => {
  it('should attach Bearer token from memory', async () => {
    setAccessToken(jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
    mockFetch().mockReturnValue(jsonResponse({ data: 1 }));

    await apiFetch('/test');

    const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toMatch(/^Bearer /);
  });

  it('should NOT attach Authorization header when refresh fails and no token', async () => {
    mockFetch()
      .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
      .mockReturnValueOnce(jsonResponse({ data: 1 }));

    await apiFetch('/test');

    const [, init] = mockFetch().mock.calls[1] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('should set Content-Type for JSON string body', async () => {
    setAccessToken(jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
    mockFetch().mockReturnValue(jsonResponse({ ok: true }));

    await apiFetch('/test', {
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' }),
    });

    const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('should throw ApiError with status and message for non-2xx', async () => {
    mockFetch()
      .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
      .mockReturnValueOnce(jsonResponse({ message: 'Not found' }, 404));

    await expect(apiFetch('/missing')).rejects.toMatchObject({
      status: 404,
      message: 'Not found',
    });
  });

  it('should return undefined for 204 No Content', async () => {
    mockFetch()
      .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
      .mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.reject(new Error('no body')),
        } as unknown as Response),
      );

    const result = await apiFetch('/delete');
    expect(result).toBeUndefined();
  });

  it('should NOT send credentials: include to backend (BFF handles cookies)', async () => {
    setAccessToken(jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
    mockFetch().mockReturnValue(jsonResponse({ data: 1 }));

    await apiFetch('/workspaces');

    const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBeUndefined();
  });

  describe('proactive refresh before request', () => {
    it('should refresh expired memory token before calling the API (no 401 round-trip)', async () => {
      setAccessToken(jwtWithExp(Math.floor(Date.now() / 1000) - 60));

      mockFetch()
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: jwtWithExp(Math.floor(Date.now() / 1000) + 3600),
            refreshToken: 'r',
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(jsonResponse({ data: 'ok' }));

      const result = await apiFetch('/protected');

      expect(result).toEqual({ data: 'ok' });
      expect(mockFetch()).toHaveBeenCalledTimes(2);
      expect(mockFetch().mock.calls[0]![0]).toBe('/api/auth/refresh');
      const [, apiInit] = mockFetch().mock.calls[1] as [string, RequestInit];
      expect(new Headers(apiInit.headers).get('Authorization')).toMatch(
        /^Bearer /,
      );
    });
  });

  describe('silent refresh on 401 via BFF', () => {
    it('should call BFF /api/auth/refresh (not backend directly) on 401', async () => {
      setAccessToken(jwtWithExp(Math.floor(Date.now() / 1000) + 3600));

      mockFetch()
        .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: jwtWithExp(Math.floor(Date.now() / 1000) + 3600),
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(jsonResponse({ data: 'ok' }));

      await apiFetch('/protected');

      const [refreshUrl, refreshInit] = mockFetch().mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(refreshUrl).toBe('/api/auth/refresh');
      expect(refreshInit.method).toBe('POST');
    });

    it('should retry the original request with the new token after BFF refresh', async () => {
      setAccessToken(jwtWithExp(Math.floor(Date.now() / 1000) + 3600));

      const newToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
      mockFetch()
        .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: newToken,
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(jsonResponse({ data: 'ok' }));

      const result = await apiFetch('/protected');

      expect(result).toEqual({ data: 'ok' });
      expect(getAccessToken()).toBe(newToken);

      const [, retryInit] = mockFetch().mock.calls[2] as [string, RequestInit];
      const retryHeaders = new Headers(retryInit.headers);
      expect(retryHeaders.get('Authorization')).toBe(`Bearer ${newToken}`);
    });

    it('should not loop refresh forever when session is missing', async () => {
      setAccessToken(null);

      mockFetch().mockReturnValue(
        jsonResponse({ message: 'Unauthorized' }, 401),
      );

      await expect(apiFetch('/protected')).rejects.toThrow(ApiError);
      expect(mockFetch().mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('BFF auth helpers', () => {
  describe('apiLogin', () => {
    it('should POST to /api/auth/login (BFF), not backend /auth/login', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'login-token',
          user: { id: '1', email: 'a@b.com', name: 'A' },
        }),
      );

      await apiLogin('a@b.com', 'password');

      const [url] = mockFetch().mock.calls[0] as [string];
      expect(url).toBe('/api/auth/login');
    });

    it('should store the access token from the BFF response', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'login-token',
          user: { id: '1', email: 'a@b.com', name: 'A' },
        }),
      );

      const data = await apiLogin('a@b.com', 'password');

      expect(getAccessToken()).toBe('login-token');
      expect(data.user.email).toBe('a@b.com');
    });

    it('should NOT receive refreshToken (BFF strips it, sets as cookie)', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'token',
          user: { id: '1', email: 'a@b.com', name: 'A' },
        }),
      );

      const data = await apiLogin('a@b.com', 'password');

      expect(data).not.toHaveProperty('refreshToken');
    });

    it('should throw ApiError on login failure', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({ message: 'Invalid credentials' }, 401),
      );

      await expect(apiLogin('a@b.com', 'wrong')).rejects.toThrow(ApiError);
      await expect(apiLogin('a@b.com', 'wrong')).rejects.toMatchObject({
        status: 401,
        message: 'Invalid credentials',
      });
    });
  });

  describe('apiRegister', () => {
    it('should POST to /api/auth/register (BFF) and return the message', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          message:
            'Check your email for a confirmation link to finish signing up.',
        }),
      );

      const result = await apiRegister('b@c.com', 'password', 'B');

      const [url] = mockFetch().mock.calls[0] as [string];
      expect(url).toBe('/api/auth/register');
      expect(result.message).toMatch(/confirmation link/i);
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('apiLogout', () => {
    it('should POST to /api/auth/logout (BFF) with Bearer token', async () => {
      setAccessToken('my-token');
      mockFetch().mockReturnValue(jsonResponse({ message: 'Logged out' }));

      await apiLogout();

      const [url, init] = mockFetch().mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/auth/logout');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer my-token',
      );
    });

    it('should clear the access token from memory even if fetch fails', async () => {
      setAccessToken('my-token');
      mockFetch().mockRejectedValue(new Error('network error'));

      await expect(apiLogout()).rejects.toThrow('network error');
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('apiRefreshToken', () => {
    it('should POST to /api/auth/refresh (BFF)', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'fresh-token',
          user: { id: '1', email: 'a@b.com', name: 'A' },
        }),
      );

      const result = await apiRefreshToken();

      const [url] = mockFetch().mock.calls[0] as [string];
      expect(url).toBe('/api/auth/refresh');
      expect(result?.accessToken).toBe('fresh-token');
      expect(getAccessToken()).toBe('fresh-token');
    });

    it('should return null and NOT update token when refresh fails', async () => {
      setAccessToken(null);
      mockFetch().mockReturnValue(
        jsonResponse({ message: 'No refresh token' }, 401),
      );

      const result = await apiRefreshToken();

      expect(result).toBeNull();
      expect(getAccessToken()).toBeNull();
    });
  });
});

describe('token management', () => {
  it('should store and retrieve access token in memory', () => {
    expect(getAccessToken()).toBeNull();

    setAccessToken('my-token');
    expect(getAccessToken()).toBe('my-token');

    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
