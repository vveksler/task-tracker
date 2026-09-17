import { describe, expect, it } from 'vitest';
import { createApp, tokensMatch } from './routes.js';

const TOKEN = 'test-internal-token-0123456789abcdef';

describe('internal route auth', () => {
  const app = createApp(TOKEN);

  it('rejects /internal/embed without a token', async () => {
    const res = await app.request('/internal/embed', {
      method: 'POST',
      body: JSON.stringify({ task_id: 't1', title: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects /internal/assistant/ask with a wrong token', async () => {
    const res = await app.request('/internal/assistant/ask', {
      method: 'POST',
      headers: { 'x-internal-token': 'wrong' },
      body: JSON.stringify({ workspace_id: 'w', question: 'q' }),
    });
    expect(res.status).toBe(401);
  });

  it('passes a valid token through to the handler', async () => {
    // Invalid body proves auth passed: the handler's own validation answers.
    const res = await app.request('/internal/embed', {
      method: 'POST',
      headers: { 'x-internal-token': TOKEN },
      body: JSON.stringify({ task_id: 't1', title: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('keeps health probes public', async () => {
    const res = await app.request('/health/live');
    expect(res.status).toBe(200);
  });
});

describe('tokensMatch', () => {
  it('compares tokens of different lengths without throwing', () => {
    expect(tokensMatch('short', TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });
});
