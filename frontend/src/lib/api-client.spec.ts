/**
 * API client tests — covers token management, silent refresh via BFF,
 * BFF auth routing, and error handling.
 */

import {
  apiFetch,
  ApiError,
  setAccessToken,
  getAccessToken,
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

describe('apiFetch', () => {
  it('should attach Bearer token from memory', async () => {
    setAccessToken('test-jwt');
    mockFetch().mockReturnValue(jsonResponse({ data: 1 }));

    await apiFetch('/test');

    const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-jwt');
  });

  it('should NOT attach Authorization header when no token', async () => {
    mockFetch().mockReturnValue(jsonResponse({ data: 1 }));

    await apiFetch('/test');

    const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('should set Content-Type for JSON string body', async () => {
    setAccessToken('t');
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
    mockFetch().mockReturnValue(
      jsonResponse({ message: 'Not found' }, 404),
    );

    await expect(apiFetch('/missing')).rejects.toThrow(ApiError);
    await expect(apiFetch('/missing')).rejects.toMatchObject({
      status: 404,
      message: 'Not found',
    });
  });

  it('should return undefined for 204 No Content', async () => {
    mockFetch().mockReturnValue(
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
    setAccessToken('t');
    mockFetch().mockReturnValue(jsonResponse({ data: 1 }));

    await apiFetch('/workspaces');

    const [, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBeUndefined();
  });

  describe('silent refresh on 401 via BFF', () => {
    it('should call BFF /api/auth/refresh (not backend directly) on 401', async () => {
      setAccessToken('expired-jwt');

      mockFetch()
        .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: 'new-jwt',
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(jsonResponse({ data: 'ok' }));

      await apiFetch('/protected');

      // Second call should be to the BFF refresh route
      const [refreshUrl, refreshInit] = mockFetch().mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(refreshUrl).toBe('/api/auth/refresh');
      expect(refreshInit.method).toBe('POST');
    });

    it('should retry the original request with the new token after BFF refresh', async () => {
      setAccessToken('expired-jwt');

      mockFetch()
        .mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
        .mockReturnValueOnce(
          jsonResponse({
            accessToken: 'refreshed-jwt',
            user: { id: '1', email: 'a@b.com', name: 'A' },
          }),
        )
        .mockReturnValueOnce(jsonResponse({ data: 'ok' }));

      const result = await apiFetch('/protected');

      expect(result).toEqual({ data: 'ok' });
      expect(getAccessToken()).toBe('refreshed-jwt');

      // Third call (retry) should use the new token
      const [, retryInit] = mockFetch().mock.calls[2] as [
        string,
        RequestInit,
      ];
      const retryHeaders = new Headers(retryInit.headers);
      expect(retryHeaders.get('Authorization')).toBe('Bearer refreshed-jwt');
    });

    it('should NOT attempt refresh on 401 when no token (not logged in)', async () => {
      setAccessToken(null);

      mockFetch().mockReturnValue(
        jsonResponse({ message: 'Unauthorized' }, 401),
      );

      await expect(apiFetch('/protected')).rejects.toThrow(ApiError);
      expect(mockFetch()).toHaveBeenCalledTimes(1);
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
    it('should POST to /api/auth/register (BFF)', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'reg-token',
          user: { id: '2', email: 'b@c.com', name: 'B' },
        }),
      );

      await apiRegister('b@c.com', 'password', 'B');

      const [url] = mockFetch().mock.calls[0] as [string];
      expect(url).toBe('/api/auth/register');
    });

    it('should store the access token from the BFF response', async () => {
      mockFetch().mockReturnValue(
        jsonResponse({
          accessToken: 'reg-token',
          user: { id: '2', email: 'b@c.com', name: 'B' },
        }),
      );

      await apiRegister('b@c.com', 'password', 'B');

      expect(getAccessToken()).toBe('reg-token');
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

      // apiLogout uses try/finally — error propagates but token is cleared
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
