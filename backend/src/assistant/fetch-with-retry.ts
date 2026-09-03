/**
 * Retry a fetch on network failure (ECONNREFUSED, fetch failed, reset).
 *
 * Used for the in-cluster AI assistant: first hop can fail while the
 * process is still binding the port (compose) or private IPv6 is settling
 * (Railway). HTTP error statuses are NOT retried — those are real responses.
 *
 * Alternative: a single fetch with a long timeout. That hangs the user on a
 * truly down service; bounded retries fail faster and recover the race.
 */

export const DEFAULT_RETRY_DELAYS_MS = [300, 800, 2000] as const;

export type FetchWithRetryOptions = {
  /** Total tries including the first. Default 1 + delays.length. */
  attempts?: number;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
};

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'AbortError')
  );
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const delaysMs = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const attempts = options.attempts ?? delaysMs.length + 1;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (isAbortError(err) || i === attempts - 1) {
        throw err;
      }
      const delay = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
      await sleep(delay);
    }
  }

  throw lastError;
}
