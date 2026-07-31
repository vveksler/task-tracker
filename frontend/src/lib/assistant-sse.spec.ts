import { TextDecoder, TextEncoder } from 'util';
import {
  ACTIONS_PREFIX,
  parseActionsPayload,
  parseAssistantSse,
} from './assistant-sse';

Object.assign(globalThis, { TextDecoder, TextEncoder });

async function* chunkIterable(
  chunks: string[],
): AsyncGenerator<Uint8Array, void, unknown> {
  const encoder = new TextEncoder();
  for (const chunk of chunks) {
    yield encoder.encode(chunk);
  }
}

async function collect(
  gen: AsyncGenerator<{ kind: string; text?: string; proposals?: unknown[] }>,
) {
  const out: unknown[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe('parseAssistantSse', () => {
  it('yields token events and stops at [DONE]', async () => {
    await expect(
      collect(
        parseAssistantSse(
          chunkIterable([
            'data: Hello\n\n',
            'data:  world\n\n',
            'data: [DONE]\n\n',
            'data: ignored\n\n',
          ]),
        ),
      ),
    ).resolves.toEqual([
      { kind: 'token', text: 'Hello' },
      { kind: 'token', text: ' world' },
    ]);
  });

  it('parses __ACTIONS__ events before [DONE]', async () => {
    const actions = `${ACTIONS_PREFIX}{"proposals":[{"type":"create_project","summary":"New Billing","name":"Billing"}]}`;
    await expect(
      collect(
        parseAssistantSse(
          chunkIterable([
            'data: Sure.\n\n',
            `data: ${actions}\n\n`,
            'data: [DONE]\n\n',
          ]),
        ),
      ),
    ).resolves.toEqual([
      { kind: 'token', text: 'Sure.' },
      {
        kind: 'actions',
        proposals: [
          {
            type: 'create_project',
            summary: 'New Billing',
            name: 'Billing',
          },
        ],
      },
    ]);
  });

  it('reassembles tokens split across chunk boundaries', async () => {
    await expect(
      collect(
        parseAssistantSse(chunkIterable(['data: Hel', 'lo\n\nda', 'ta: !\n\n'])),
      ),
    ).resolves.toEqual([
      { kind: 'token', text: 'Hello' },
      { kind: 'token', text: '!' },
    ]);
  });

  it('keeps newlines when an event has multiple data: fields', async () => {
    // Server encodes a model chunk "сделать:\n- Пичи" as two data lines.
    await expect(
      collect(
        parseAssistantSse(
          chunkIterable([
            'data: сделать:\ndata: - Пичи\n\n',
            'data: [DONE]\n\n',
          ]),
        ),
      ),
    ).resolves.toEqual([{ kind: 'token', text: 'сделать:\n- Пичи' }]);
  });

  it('does not drop content after a raw newline inside a broken data field', async () => {
    // Legacy/broken encoding: newline inside a single data: line. The
    // continuation line is not a data: field — we cannot recover it, but
    // the properly encoded form above is what production emits now.
    await expect(
      collect(
        parseAssistantSse(
          chunkIterable([
            'data: сделать:\n- DROPPED\n\n',
            'data: [DONE]\n\n',
          ]),
        ),
      ),
    ).resolves.toEqual([{ kind: 'token', text: 'сделать:' }]);
  });
});

describe('parseActionsPayload', () => {
  it('returns empty list for invalid JSON', () => {
    expect(parseActionsPayload(`${ACTIONS_PREFIX}{not-json`)).toEqual([]);
  });

  it('returns empty list when proposals is missing', () => {
    expect(parseActionsPayload(`${ACTIONS_PREFIX}{"foo":1}`)).toEqual([]);
  });

  it('filters malformed proposals', () => {
    const payload = `${ACTIONS_PREFIX}${JSON.stringify({
      proposals: [
        { type: 'update_task', summary: 'ok', taskId: 't1', patch: { status: 'TODO' } },
        { type: 'update_task', summary: 'bad' },
        { type: 'create_task', summary: 'ok', projectId: 'p1', title: 'X' },
        {
          type: 'bulk_update_tasks',
          summary: 'bulk',
          filter: { titleContains: 'auth' },
          patch: { status: 'IN_PROGRESS' },
        },
        { type: 'dedupe_projects', summary: 'dedupe', keep: 'oldest' },
        {
          type: 'bulk_delete_tasks',
          summary: 'wipe',
          filter: { projectId: 'p1' },
        },
        {
          type: 'navigate_to_project',
          summary: 'go',
          projectId: 'p1',
        },
        {
          type: 'delete_project',
          summary: 'del',
          projectId: 'p1',
        },
        { type: 'nope', summary: 'x' },
      ],
    })}`;

    expect(parseActionsPayload(payload)).toEqual([
      {
        type: 'update_task',
        summary: 'ok',
        taskId: 't1',
        patch: { status: 'TODO' },
      },
      {
        type: 'create_task',
        summary: 'ok',
        projectId: 'p1',
        title: 'X',
      },
      {
        type: 'bulk_update_tasks',
        summary: 'bulk',
        filter: { titleContains: 'auth' },
        patch: { status: 'IN_PROGRESS' },
      },
      { type: 'dedupe_projects', summary: 'dedupe', keep: 'oldest' },
      {
        type: 'bulk_delete_tasks',
        summary: 'wipe',
        filter: { projectId: 'p1' },
      },
      { type: 'navigate_to_project', summary: 'go', projectId: 'p1' },
      { type: 'delete_project', summary: 'del', projectId: 'p1' },
    ]);
  });
});
