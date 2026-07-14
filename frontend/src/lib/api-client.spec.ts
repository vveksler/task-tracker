/**
 * API client tests — covers token management, silent refresh,
 * and error handling.
 */

import { apiFetch, ApiError, setAccessToken, getAccessToken } from './api-client';

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

  describe('silent refresh on 401', () => {
    it('should attempt refresh and retry on 401 when token exists', async () => {
      setAccessToken('expired-jwt');

      mockFetch()
        // First call: 401
        .mockReturnValueOnce(
          jsonResponse({ message: 'Unauthorized' }, 401),
        )
        // Refresh call: success
        .mockReturnValueOnce(
          jsonResponse({ accessToken: 'new-jwt', user: { id: '1', email: 'a@b.com', name: 'A' } }),
        )
        // Retry call: success
        .mockReturnValueOnce(jsonResponse({ data: 'ok' }));

      const result = await apiFetch('/protected');

      expect(result).toEqual({ data: 'ok' });
      expect(getAccessToken()).toBe('new-jwt');
      expect(mockFetch()).toHaveBeenCalledTimes(3);
    });

    it('should NOT attempt refresh on 401 when no token (not logged in)', async () => {
      setAccessToken(null);

      mockFetch().mockReturnValue(
        jsonResponse({ message: 'Unauthorized' }, 401),
      );

      await expect(apiFetch('/protected')).rejects.toThrow(ApiError);
      // Only one call — no refresh attempt
      expect(mockFetch()).toHaveBeenCalledTimes(1);
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
