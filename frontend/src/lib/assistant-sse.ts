/**
 * Parse Nest/Python SSE streams for the AI assistant.
 * Events look like: `data: <token>\n\n`, optional
 * `data: __ACTIONS__{...}\n\n`, and end with `data: [DONE]\n\n`.
 */

import type { AssistantProposal, AssistantSseEvent } from '@/types/api';

export const ACTIONS_PREFIX = '__ACTIONS__';

type ByteSource =
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

async function* toByteChunks(
  source: ByteSource,
): AsyncGenerator<Uint8Array, void, unknown> {
  if (Symbol.asyncIterator in source) {
    yield* source as AsyncIterable<Uint8Array>;
    return;
  }

  const reader = (source as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function dataPayload(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  // SSE allows one optional space after the colon — strip only that,
  // so leading whitespace inside the model token is preserved.
  const raw = line.slice('data:'.length);
  return raw.startsWith(' ') ? raw.slice(1) : raw;
}

export function parseActionsPayload(data: string): AssistantProposal[] {
  if (!data.startsWith(ACTIONS_PREFIX)) return [];
  try {
    const parsed = JSON.parse(data.slice(ACTIONS_PREFIX.length)) as {
      proposals?: unknown;
    };
    if (!Array.isArray(parsed.proposals)) return [];
    return parsed.proposals.filter(isAssistantProposal);
  } catch {
    return [];
  }
}

function isAssistantProposal(value: unknown): value is AssistantProposal {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v['summary'] !== 'string') return false;

  if (v['type'] === 'update_task') {
    return (
      typeof v['taskId'] === 'string' &&
      !!v['patch'] &&
      typeof v['patch'] === 'object'
    );
  }
  if (v['type'] === 'create_task') {
    return typeof v['projectId'] === 'string' && typeof v['title'] === 'string';
  }
  if (v['type'] === 'create_project') {
    return typeof v['name'] === 'string';
  }
  if (v['type'] === 'bulk_update_tasks') {
    return (
      !!v['filter'] &&
      typeof v['filter'] === 'object' &&
      !!v['patch'] &&
      typeof v['patch'] === 'object'
    );
  }
  if (v['type'] === 'bulk_delete_tasks') {
    return !!v['filter'] && typeof v['filter'] === 'object';
  }
  if (v['type'] === 'dedupe_projects') {
    return v['keep'] === 'oldest' || v['keep'] === 'newest';
  }
  if (v['type'] === 'delete_project' || v['type'] === 'navigate_to_project') {
    return typeof v['projectId'] === 'string';
  }
  return false;
}

export async function* parseAssistantSse(
  source: ByteSource,
): AsyncGenerator<AssistantSseEvent, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = '';

  const handleData = function* (
    data: string,
  ): Generator<AssistantSseEvent, boolean, unknown> {
    if (data === '[DONE]') return true;
    if (data.startsWith(ACTIONS_PREFIX)) {
      yield { kind: 'actions', proposals: parseActionsPayload(data) };
      return false;
    }
    if (data.length > 0) yield { kind: 'token', text: data };
    return false;
  };

  for await (const value of toByteChunks(source)) {
    buffer += decoder.decode(value, { stream: true });

    // SSE events are delimited by a blank line.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      // Spec: multiple `data:` lines in one event are joined with \n.
      // Critical when the model streams a newline inside a token — the
      // server emits one `data:` per line; joining restores the newline.
      const dataLines: string[] = [];
      for (const rawLine of event.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        const data = dataPayload(line);
        if (data !== null) dataLines.push(data);
      }
      if (dataLines.length === 0) {
        boundary = buffer.indexOf('\n\n');
        continue;
      }

      const done = yield* handleData(dataLines.join('\n'));
      if (done) return;

      boundary = buffer.indexOf('\n\n');
    }
  }

  // Flush a trailing event without a final blank line, if any.
  if (buffer.trim()) {
    const dataLines: string[] = [];
    for (const rawLine of buffer.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const data = dataPayload(line);
      if (data !== null) dataLines.push(data);
    }
    if (dataLines.length > 0) {
      const done = yield* handleData(dataLines.join('\n'));
      if (done) return;
    }
  }
}
