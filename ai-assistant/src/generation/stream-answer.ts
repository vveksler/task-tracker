/**
 * Builds the prompt and streams the answer as Server-Sent Events.
 * LangChain ChatAnthropic for stream + proposal extraction; custom SQL RAG.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { RelevantTask } from '../retrieval.js';
import { buildWorkspaceCatalog } from '../workspace-context.js';
import {
  ACTIONS_PREFIX,
  PROPOSALS_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './prompts.js';
import {
  formatConversationHistory,
  normalizeHistory,
  type HistoryTurn,
} from './history.js';
import { resolveScopeIntent } from './intent.js';
import { isAbortError } from './abort.js';
import { createChatModel } from './llm.js';
import {
  extractJsonObject,
  sanitizeProposals,
  type Proposal,
} from './sanitize-proposals.js';
import { applyScopeGuards } from './scope-guards.js';

/** One SSE event. Embedded newlines become multiple `data:` fields. */
export function sseEvent(data: string): string {
  return (
    data
      .split('\n')
      .map((part) => `data: ${part}\n`)
      .join('') + '\n'
  );
}

/** SSE comment frame — keep-alive / open the stream. Clients ignore these. */
export function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

export function formatContext(tasks: RelevantTask[]): string {
  if (tasks.length === 0) {
    return '<task_context>\n(no relevant tasks found)\n</task_context>';
  }
  const lines = ['<task_context>'];
  for (const t of tasks) {
    lines.push(
      `- id=${t.id} projectId=${t.projectId} projectName=${t.projectName} ` +
        `[${t.status}] ${t.title}: ${t.description}`,
    );
  }
  lines.push('</task_context>');
  return lines.join('\n');
}

export async function proposeActions(args: {
  question: string;
  contextTasks: RelevantTask[];
  assistantText: string;
  workspaceId: string;
  currentProjectId?: string | null;
  history?: HistoryTurn[] | null;
  signal?: AbortSignal;
}): Promise<Proposal[]> {
  const turns = normalizeHistory(args.history);
  const contextBlock = formatContext(args.contextTasks);
  let catalog: string;
  try {
    catalog = await buildWorkspaceCatalog(
      args.workspaceId,
      args.question,
      args.currentProjectId,
    );
  } catch {
    catalog = '<workspace_catalog>\n(unavailable)\n</workspace_catalog>';
  }

  const historyBlock = formatConversationHistory(turns);
  const historySection = historyBlock ? `${historyBlock}\n\n` : '';
  const userMessage =
    `${contextBlock}\n\n` +
    `${catalog}\n\n` +
    `${historySection}` +
    `User request: ${args.question}\n\n` +
    `Assistant reply (already shown to the user):\n${args.assistantText}\n\n` +
    'Extract mutation/navigation proposals if the user asked for changes ' +
    'or confirmed a prior suggestion; otherwise return {"proposals":[]}.';

  try {
    // Intent runs in parallel with proposal extraction — language-agnostic
    // scope flags; English regex is only used if the intent call fails.
    const intentPromise = resolveScopeIntent({
      question: args.question,
      history: turns,
      signal: args.signal,
    });

    const model = createChatModel(800);
    const response = await model.invoke(
      [
        new SystemMessage(PROPOSALS_SYSTEM_PROMPT),
        new HumanMessage(userMessage),
      ],
      { signal: args.signal },
    );
    const text =
      typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c) =>
                typeof c === 'string'
                  ? c
                  : typeof c === 'object' && c && 'text' in c
                    ? String((c as { text: unknown }).text)
                    : '',
              )
              .join('')
          : String(response.content ?? '');
    const parsed = extractJsonObject(text);
    if (parsed === null) {
      // Drain parallel intent call so it is not left floating.
      await intentPromise.catch(() => undefined);
      return [];
    }

    const intent = await intentPromise;

    return applyScopeGuards(
      sanitizeProposals(parsed),
      intent,
      args.currentProjectId,
    );
  } catch (err) {
    if (isAbortError(err, args.signal)) throw err;
    // Never fail the whole ask if proposal extraction breaks.
    return [];
  }
}

export type StreamAnswerArgs = {
  question: string;
  contextTasks: RelevantTask[];
  workspaceId: string;
  currentProjectId?: string | null;
  history?: HistoryTurn[] | null;
  signal?: AbortSignal;
};

/**
 * Async generator yielding raw SSE event strings (including trailing newlines).
 */
export async function* streamAnswer(
  args: StreamAnswerArgs,
): AsyncGenerator<string, void, undefined> {
  const turns = normalizeHistory(args.history);
  const contextBlock = formatContext(args.contextTasks);
  let catalog: string;
  try {
    catalog = await buildWorkspaceCatalog(
      args.workspaceId,
      args.question,
      args.currentProjectId,
    );
  } catch {
    catalog = '<workspace_catalog>\n(unavailable)\n</workspace_catalog>';
  }

  const historyBlock = formatConversationHistory(turns);
  const historySection = historyBlock ? `${historyBlock}\n\n` : '';
  const userMessage =
    `${catalog}\n\n${contextBlock}\n\n` +
    `${historySection}` +
    `Current message: ${args.question}`;

  const assistantChunks: string[] = [];
  const model = createChatModel(1200);

  try {
    const stream = await model.stream(
      [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userMessage)],
      { signal: args.signal },
    );

    for await (const chunk of stream) {
      if (args.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const text =
        typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content
                .map((c) =>
                  typeof c === 'string'
                    ? c
                    : typeof c === 'object' && c && 'text' in c
                      ? String((c as { text: unknown }).text)
                      : '',
                )
                .join('')
            : '';
      if (!text) continue;
      assistantChunks.push(text);
      yield sseEvent(text);
    }

    const proposals = await proposeActions({
      question: args.question,
      contextTasks: args.contextTasks,
      assistantText: assistantChunks.join(''),
      workspaceId: args.workspaceId,
      currentProjectId: args.currentProjectId,
      history: turns,
      signal: args.signal,
    });
    const payload = JSON.stringify({ proposals });
    yield sseEvent(`${ACTIONS_PREFIX}${payload}`);
  } catch (err) {
    if (
      (err instanceof Error && err.name === 'AbortError') ||
      args.signal?.aborted
    ) {
      return;
    }
    throw err;
  }

  yield sseEvent('[DONE]');
}
