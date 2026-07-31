/**
 * Persist assistant chat threads in localStorage, keyed by user + workspace.
 * Access tokens are never stored here — only chat text/proposals.
 */

import type { AssistantProposal } from '@/types/api';

export type StoredProposalStatus =
  | 'pending'
  | 'applied'
  | 'error'
  | 'dismissed';

export interface StoredProposalCard {
  key: string;
  proposal: AssistantProposal;
  status: StoredProposalStatus;
  error?: string;
  resultNote?: string;
}

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals?: StoredProposalCard[];
}

const PREFIX = 'tt:assistant-chat';
const MAX_MESSAGES = 50;
const MAX_CONTENT_CHARS = 4000;

export function assistantChatStorageKey(
  userId: string,
  workspaceId: string,
): string {
  return `${PREFIX}:${userId}:${workspaceId}`;
}

function isRole(value: unknown): value is 'user' | 'assistant' {
  return value === 'user' || value === 'assistant';
}

function normalizeStatus(status: unknown): StoredProposalStatus {
  if (
    status === 'pending' ||
    status === 'applied' ||
    status === 'error' ||
    status === 'dismissed'
  ) {
    return status;
  }
  // "applying" mid-flight should not survive a reload.
  return 'pending';
}

function sanitizeMessage(raw: unknown): StoredChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || !isRole(m['role'])) return null;
  if (typeof m['content'] !== 'string') return null;

  const message: StoredChatMessage = {
    id: m['id'],
    role: m['role'],
    content: m['content'].slice(0, MAX_CONTENT_CHARS),
  };

  if (Array.isArray(m['proposals'])) {
    const proposals: StoredProposalCard[] = [];
    for (const p of m['proposals']) {
      if (!p || typeof p !== 'object') continue;
      const card = p as Record<string, unknown>;
      if (typeof card['key'] !== 'string') continue;
      if (!card['proposal'] || typeof card['proposal'] !== 'object') continue;
      proposals.push({
        key: card['key'],
        proposal: card['proposal'] as AssistantProposal,
        status: normalizeStatus(card['status']),
        ...(typeof card['error'] === 'string' ? { error: card['error'] } : {}),
        ...(typeof card['resultNote'] === 'string'
          ? { resultNote: card['resultNote'] }
          : {}),
      });
    }
    if (proposals.length > 0) message.proposals = proposals;
  }

  return message;
}

export function loadAssistantChat(
  userId: string,
  workspaceId: string,
): StoredChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(
      assistantChatStorageKey(userId, workspaceId),
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeMessage)
      .filter((m): m is StoredChatMessage => m !== null)
      .slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveAssistantChat(
  userId: string,
  workspaceId: string,
  messages: StoredChatMessage[],
): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = messages
      .map((m) => ({
        ...m,
        content: m.content.slice(0, MAX_CONTENT_CHARS),
        proposals: m.proposals?.map((p) => ({
          ...p,
          status: normalizeStatus(p.status),
        })),
      }))
      .slice(-MAX_MESSAGES);
    window.localStorage.setItem(
      assistantChatStorageKey(userId, workspaceId),
      JSON.stringify(trimmed),
    );
  } catch {
    // Quota / private mode — ignore; chat still works in-memory.
  }
}

export function clearAssistantChat(
  userId: string,
  workspaceId: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(
      assistantChatStorageKey(userId, workspaceId),
    );
  } catch {
    // ignore
  }
}
