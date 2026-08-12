/** Shared abort detection for LLM calls that must not swallow client disconnect. */
export function isAbortError(
  err: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === 'AbortError';
}
