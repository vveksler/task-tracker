/**
 * Scope intent for bulk proposal guards.
 *
 * Primary path: small Claude JSON call (language-agnostic).
 * Fallback: English regex heuristics when the call fails.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  formatConversationHistory,
  isShortConfirmation,
  type HistoryTurn,
} from './history.js';
import { extractJsonObject } from './sanitize-proposals.js';
import { isAbortError } from './abort.js';
import { createChatModel } from './llm.js';

export type ScopeIntent = {
  /** User is confirming a prior assistant plan (any language). */
  isConfirmation: boolean;
  /**
   * User wants every task in the relevant project/board scope, not a
   * single status column — e.g. "all tasks", "всё на доске", "the whole board".
   */
  wantsAllTasksInScope: boolean;
  /**
   * User limited WHICH tasks by source status — e.g. "only TODO",
   * "in-progress tasks" — not the destination "to Done".
   */
  statusLimited: boolean;
};

const ALL_TASKS_RE = /(all\s+tasks|every\s+task)/i;

const SOURCE_STATUS_LIMIT_RE = new RegExp(
  '(' +
    [
      'all\\s+todo\\b',
      'only\\s+todo\\b',
      'todo\\s+tasks',
      'all\\s+in[\\s_-]?progress',
      'in[\\s_-]?progress\\s+tasks',
    ].join('|') +
    ')',
  'i',
);

/** English-only fallback when intent LLM is unavailable. */
export function regexFallbackIntent(question: string): ScopeIntent {
  return {
    isConfirmation: isShortConfirmation(question),
    wantsAllTasksInScope: ALL_TASKS_RE.test(question),
    statusLimited: SOURCE_STATUS_LIMIT_RE.test(question),
  };
}

const INTENT_SYSTEM_PROMPT = `You classify the user's latest chat message for a task-tracker assistant.

Return ONLY valid JSON (no markdown) with this exact shape:
{"isConfirmation":boolean,"wantsAllTasksInScope":boolean,"statusLimited":boolean}

Definitions:
- isConfirmation: true if the message accepts/approves the assistant's prior plan
  (any language: yes, ok, go ahead, да, давай, сделай, etc.). False for new requests.
- wantsAllTasksInScope: true if the user wants EVERY task in the relevant project/board
  scope, without limiting to one status column. Examples: "all tasks", "the whole board",
  "все задачи", "всё на доске". False if they only named a keyword/assignee or a status.
- statusLimited: true ONLY if they limited the SOURCE set by status
  (only TODO, in-progress tasks, etc.). Destination phrases like "to Done" / "в Done"
  do NOT count as statusLimited.

Use conversation history when the latest message is a short follow-up.
If unsure, prefer false for all fields.`;

function parseScopeIntent(raw: Record<string, unknown>): ScopeIntent {
  return {
    isConfirmation: raw['isConfirmation'] === true,
    wantsAllTasksInScope: raw['wantsAllTasksInScope'] === true,
    statusLimited: raw['statusLimited'] === true,
  };
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === 'string'
          ? c
          : typeof c === 'object' && c && 'text' in c
            ? String((c as { text: unknown }).text)
            : '',
      )
      .join('');
  }
  return String(content ?? '');
}

/**
 * Classify scope intent. On failure returns null so callers can use
 * regexFallbackIntent.
 */
export async function classifyScopeIntent(args: {
  question: string;
  history: HistoryTurn[];
  signal?: AbortSignal;
}): Promise<ScopeIntent | null> {
  const historyBlock = formatConversationHistory(args.history);
  const historySection = historyBlock ? `${historyBlock}\n\n` : '';
  const userMessage =
    `${historySection}` + `Latest user message: ${args.question}`;

  try {
    const model = createChatModel(120);
    const response = await model.invoke(
      [
        new SystemMessage(INTENT_SYSTEM_PROMPT),
        new HumanMessage(userMessage),
      ],
      { signal: args.signal },
    );
    const parsed = extractJsonObject(messageText(response.content));
    if (parsed === null) return null;
    return parseScopeIntent(parsed);
  } catch (err) {
    if (isAbortError(err, args.signal)) throw err;
    return null;
  }
}

/** Intent LLM result, or English regex fallback. */
export async function resolveScopeIntent(args: {
  question: string;
  history: HistoryTurn[];
  signal?: AbortSignal;
}): Promise<ScopeIntent> {
  try {
    const classified = await classifyScopeIntent(args);
    if (classified) return classified;
  } catch (err) {
    if (isAbortError(err, args.signal)) throw err;
  }
  return regexFallbackIntent(args.question);
}
