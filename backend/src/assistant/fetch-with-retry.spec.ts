import { fetchWithRetry } from './fetch-with-retry';

describe('fetchWithRetry', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns on the first success', async () => {
    const res = { ok: true } as Response;
    global.fetch = jest.fn().mockResolvedValue(res);

    await expect(
      fetchWithRetry('http://ai/ask', { method: 'POST' }),
    ).resolves.toBe(res);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries network failures then succeeds', async () => {
    const res = { ok: true } as Response;
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(res);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithRetry(
        'http://ai/ask',
        { method: 'POST' },
        { delaysMs: [10, 20], sleep },
      ),
    ).resolves.toBe(res);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('throws the last network error after attempts are exhausted', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      fetchWithRetry(
        'http://ai/ask',
        { method: 'GET' },
        { attempts: 3, delaysMs: [1], sleep },
      ),
    ).rejects.toThrow('fetch failed');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry AbortError', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abort);
    const sleep = jest.fn();

    await expect(
      fetchWithRetry(
        'http://ai/ask',
        { method: 'GET' },
        { attempts: 4, delaysMs: [1], sleep },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
