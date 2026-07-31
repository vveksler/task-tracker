'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ApiError, apiFetch, apiFetchStream } from '@/lib/api-client';
import { parseAssistantSse } from '@/lib/assistant-sse';
import { useOptionalAssistant } from '@/lib/assistant-context';
import { Button } from '@/components/ui/button';
import { AssistantMessageText } from '@/components/assistant/assistant-message-text';
import { useAuth } from '@/lib/auth-context';
import {
  clearAssistantChat,
  loadAssistantChat,
  saveAssistantChat,
} from '@/lib/assistant-chat-storage';
import type { AssistantProposal, Project } from '@/types/api';

type ProposalStatus = 'pending' | 'applying' | 'applied' | 'error' | 'dismissed';

interface ProposalCard {
  key: string;
  proposal: AssistantProposal;
  status: ProposalStatus;
  error?: string;
  resultNote?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals?: ProposalCard[];
}

interface AssistantChatProps {
  workspaceId: string;
  /** page = full route chrome; panel = slide-over body (compact header + close). */
  variant?: 'page' | 'panel';
  onClose?: () => void;
  onApplied?: (proposal: AssistantProposal) => void;
}

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
}

function formatProposalType(type: AssistantProposal['type']): string {
  return type.replace(/_/g, ' ');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * After create_project Apply, bind pending create_task cards that still
 * reference the new project by name / placeholder (not a real UUID).
 */
function bindCreateTaskToProject(
  proposal: Extract<AssistantProposal, { type: 'create_task' }>,
  created: { id: string; name: string },
  createProjectCountInMessage: number,
): Extract<AssistantProposal, { type: 'create_task' }> {
  const pid = proposal.projectId?.trim() ?? '';
  const pname = proposal.projectName?.trim() ?? '';
  const nameMatch =
    (pname && pname.toLowerCase() === created.name.toLowerCase()) ||
    (pid && pid.toLowerCase() === created.name.toLowerCase());

  if (isUuid(pid) && pid !== created.id) {
    return proposal; // clearly another existing project
  }
  if (isUuid(pid) && pid === created.id) {
    return { ...proposal, projectId: created.id, projectName: created.name };
  }
  if (nameMatch || !isUuid(pid)) {
    // Placeholder / name / missing id — bind when this is the only new project
    // in the batch, or when the name explicitly matches.
    if (nameMatch || createProjectCountInMessage <= 1) {
      return {
        ...proposal,
        projectId: created.id,
        projectName: created.name,
      };
    }
  }
  return proposal;
}

export const AssistantChat: React.FC<AssistantChatProps> = ({
  workspaceId,
  variant = 'page',
  onClose,
  onApplied,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ projectId?: string }>();
  // Prefer route param; fall back to pathname so the slide-over chat still
  // scopes to the board even if params are incomplete.
  const currentProjectId = (() => {
    if (typeof params?.projectId === 'string' && params.projectId) {
      return params.projectId;
    }
    const match = pathname?.match(/\/projects\/([^/?#]+)/);
    return match?.[1];
  })();
  const assistantCtx = useOptionalAssistant();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Load per-user / per-workspace thread after mount (SSR-safe).
  useEffect(() => {
    if (!user?.id) {
      setMessages([]);
      setHydrated(true);
      return;
    }
    setMessages(loadAssistantChat(user.id, workspaceId));
    setHydrated(true);
  }, [user?.id, workspaceId]);

  // Persist when idle (not mid-stream) so reloads keep context.
  useEffect(() => {
    if (!hydrated || !user?.id || isStreaming) return;
    saveAssistantChat(user.id, workspaceId, messages);
  }, [messages, hydrated, user?.id, workspaceId, isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const clearHistory = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
    setError(null);
    if (user?.id) clearAssistantChat(user.id, workspaceId);
  }, [isStreaming, user?.id, workspaceId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const applyProposal = useCallback(
    async (messageId: string, cardKey: string, proposal: AssistantProposal) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                proposals: m.proposals?.map((p) =>
                  p.key === cardKey
                    ? { ...p, status: 'applying', error: undefined }
                    : p,
                ),
              },
        ),
      );

      try {
        let resultNote: string | undefined;
        let createdProject: { id: string; name: string } | null = null;

        if (proposal.type === 'update_task') {
          await apiFetch(`/workspaces/${workspaceId}/tasks/${proposal.taskId}`, {
            method: 'PATCH',
            body: JSON.stringify(proposal.patch),
          });
        } else if (proposal.type === 'create_task') {
          if (!isUuid(proposal.projectId)) {
            throw new Error(
              proposal.projectName
                ? `Apply the “create project '${proposal.projectName}'” card first`
                : 'Apply the create project card first (projectId is not a UUID yet)',
            );
          }
          await apiFetch(`/workspaces/${workspaceId}/tasks`, {
            method: 'POST',
            body: JSON.stringify({
              projectId: proposal.projectId,
              title: proposal.title,
              description: proposal.description,
              status: proposal.status,
              ...(proposal.assigneeId
                ? { assigneeId: proposal.assigneeId }
                : {}),
            }),
          });
        } else if (proposal.type === 'create_project') {
          const created = await apiFetch<Project>(
            `/workspaces/${workspaceId}/projects`,
            {
              method: 'POST',
              body: JSON.stringify({ name: proposal.name }),
            },
          );
          createdProject = { id: created.id, name: created.name };
          resultNote = `Created “${created.name}”`;
        } else if (proposal.type === 'bulk_update_tasks') {
          const result = await apiFetch<{
            updatedCount: number;
            taskIds: string[];
          }>(`/workspaces/${workspaceId}/tasks/bulk-update`, {
            method: 'POST',
            body: JSON.stringify({
              filter: proposal.filter,
              patch: proposal.patch,
            }),
          });
          resultNote = `Updated ${result.updatedCount} task(s)`;
        } else if (proposal.type === 'bulk_delete_tasks') {
          const result = await apiFetch<{
            deletedCount: number;
            taskIds: string[];
          }>(`/workspaces/${workspaceId}/tasks/bulk-delete`, {
            method: 'POST',
            body: JSON.stringify({ filter: proposal.filter }),
          });
          resultNote = `Deleted ${result.deletedCount} task(s)`;
        } else if (proposal.type === 'dedupe_projects') {
          const result = await apiFetch<{
            removedCount: number;
            removedProjectIds: string[];
            keptProjectIds: string[];
          }>(`/workspaces/${workspaceId}/projects/dedupe`, {
            method: 'POST',
            body: JSON.stringify({
              name: proposal.name,
              keep: proposal.keep,
            }),
          });
          resultNote = `Removed ${result.removedCount} duplicate project(s)`;
        } else if (proposal.type === 'delete_project') {
          await apiFetch(
            `/workspaces/${workspaceId}/projects/${proposal.projectId}`,
            { method: 'DELETE' },
          );
          resultNote = 'Project deleted';
        } else if (proposal.type === 'navigate_to_project') {
          router.push(
            `/workspaces/${workspaceId}/projects/${proposal.projectId}`,
          );
          resultNote = 'Opened project';
        } else {
          const _exhaustive: never = proposal;
          throw new Error(`Unknown proposal type: ${JSON.stringify(_exhaustive)}`);
        }

        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;

            const createProjectCount =
              m.proposals?.filter((p) => p.proposal.type === 'create_project')
                .length ?? 0;

            return {
              ...m,
              proposals: m.proposals?.map((p) => {
                let nextProposal = p.proposal;
                // Wire pending create_task / navigate cards to the new project id.
                if (createdProject && p.status === 'pending') {
                  if (nextProposal.type === 'create_task') {
                    nextProposal = bindCreateTaskToProject(
                      nextProposal,
                      createdProject,
                      createProjectCount,
                    );
                  } else if (
                    nextProposal.type === 'navigate_to_project' &&
                    !isUuid(nextProposal.projectId)
                  ) {
                    nextProposal = {
                      ...nextProposal,
                      projectId: createdProject.id,
                    };
                  }
                }

                if (p.key === cardKey) {
                  return {
                    ...p,
                    proposal: nextProposal,
                    status: 'applied' as const,
                    resultNote,
                  };
                }
                if (nextProposal !== p.proposal) {
                  return { ...p, proposal: nextProposal };
                }
                return p;
              }),
            };
          }),
        );

        onApplied?.(proposal);
        assistantCtx?.notifyApplied(proposal);
      } catch (err) {
        let message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to apply change';
        if (
          err instanceof ApiError &&
          err.status === 403 &&
          (proposal.type === 'dedupe_projects' ||
            proposal.type === 'delete_project')
        ) {
          message = 'Admin only — you need ADMIN role for this action';
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id !== messageId
              ? m
              : {
                  ...m,
                  proposals: m.proposals?.map((p) =>
                    p.key === cardKey
                      ? { ...p, status: 'error', error: message }
                      : p,
                  ),
                },
          ),
        );
      }
    },
    [workspaceId, onApplied, assistantCtx, router],
  );

  const dismissProposal = useCallback((messageId: string, cardKey: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id !== messageId
          ? m
          : {
              ...m,
              proposals: m.proposals?.map((p) =>
                p.key === cardKey ? { ...p, status: 'dismissed' } : p,
              ),
            },
      ),
    );
  }, []);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    setError(null);
    setInput('');

    // Prior turns only (current question is sent separately).
    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .slice(-12)
      .map((m) => ({
        role: m.role,
        content: m.content.slice(0, 2000),
      }));

    const userMsg: ChatMessage = {
      id: nextId('user'),
      role: 'user',
      content: question,
    };
    const assistantId = nextId('assistant');
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      proposals: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await apiFetchStream(
        `/workspaces/${workspaceId}/assistant/ask`,
        {
          method: 'POST',
          body: JSON.stringify({
            question,
            ...(currentProjectId ? { currentProjectId } : {}),
            ...(history.length > 0 ? { history } : {}),
          }),
          signal: controller.signal,
        },
      );

      if (!res.body) {
        throw new ApiError(502, 'AI assistant returned an empty stream');
      }

      for await (const event of parseAssistantSse(res.body)) {
        if (event.kind === 'token') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + event.text }
                : m,
            ),
          );
        } else {
          const cards: ProposalCard[] = event.proposals.map((proposal, i) => ({
            key: `${assistantId}-p-${i}`,
            proposal,
            status: 'pending',
          }));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, proposals: cards } : m,
            ),
          );
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // User hit Stop — keep whatever tokens we already showed.
        return;
      }

      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to get an answer';
      setError(message);

      // Drop an empty assistant placeholder so the UI stays clean.
      setMessages((prev) =>
        prev.filter((m) => !(m.id === assistantId && m.content === '')),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsStreaming(false);
    }
  }, [input, isStreaming, workspaceId, currentProjectId, messages]);

  const chatBody = (
    <div
      className={
        variant === 'panel'
          ? 'flex min-h-0 flex-1 flex-col bg-white'
          : 'flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white shadow-sm'
      }
    >
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-2 text-sm text-gray-500">
            <p>Ask questions or request changes. Nothing is saved until you Apply.</p>
            <ul className="list-inside list-disc space-y-1 text-xs text-gray-400">
              <li>&ldquo;What tasks are still in review?&rdquo;</li>
              <li>&ldquo;Move all auth tasks to In Progress&rdquo;</li>
              <li>&ldquo;Delete all tasks in project Auth &amp; Security&rdquo;</li>
              <li>&ldquo;Open project Payments&rdquo;</li>
            </ul>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === 'user'
                ? 'assistant-msg-user rounded-lg bg-brand-50 px-3 py-2 text-sm text-gray-900'
                : 'assistant-msg-assistant rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800'
            }
          >
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </p>
            {msg.role === 'assistant' ? (
              <AssistantMessageText
                text={msg.content}
                placeholder={isStreaming ? '…' : ''}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">
                {msg.content}
              </p>
            )}

            {msg.role === 'assistant' &&
              msg.proposals &&
              msg.proposals.filter((p) => p.status !== 'dismissed').length >
                0 && (
                <ul className="mt-3 space-y-2">
                  {msg.proposals
                    .filter((p) => p.status !== 'dismissed')
                    .map((card) => (
                      <li
                        key={card.key}
                        className="rounded-md border border-gray-200 bg-white px-3 py-2"
                      >
                        <p className="text-sm text-gray-800">
                          {card.proposal.summary}
                        </p>
                        <p className="mt-0.5 text-xs capitalize text-gray-500">
                          {formatProposalType(card.proposal.type)}
                        </p>
                        {card.status === 'error' && card.error && (
                          <p className="mt-1 text-xs text-red-600" role="alert">
                            {card.error}
                          </p>
                        )}
                        {card.status === 'applied' ? (
                          <p className="mt-2 text-xs font-medium text-green-700">
                            {card.resultNote
                              ? `Applied — ${card.resultNote}`
                              : 'Applied'}
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              isLoading={card.status === 'applying'}
                              disabled={card.status === 'applying'}
                              onClick={() =>
                                void applyProposal(
                                  msg.id,
                                  card.key,
                                  card.proposal,
                                )
                              }
                              className="min-w-[4.5rem] flex-1 sm:flex-none"
                            >
                              {card.proposal.type === 'navigate_to_project'
                                ? 'Go'
                                : 'Apply'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={card.status === 'applying'}
                              onClick={() =>
                                dismissProposal(msg.id, card.key)
                              }
                              className="min-w-[4.5rem] flex-1 sm:flex-none"
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="border-t border-gray-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={variant === 'panel' ? 2 : 3}
          placeholder="Ask about tasks, or request a change…"
          disabled={isStreaming}
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 sm:text-sm"
        />

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : (
            <span className="assistant-composer-hint text-xs text-gray-400">
              Enter to send · Shift+Enter for newline
            </span>
          )}

          <div className="flex shrink-0 gap-2 self-end sm:self-auto">
            {isStreaming ? (
              <Button type="button" variant="secondary" size="sm" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim()}>
                Send
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );

  if (variant === 'panel') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">
              AI Assistant
            </h2>
            <p className="truncate text-xs text-gray-500">
              Suggest + confirm — Apply to save
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                disabled={isStreaming}
                className="rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
              >
                Clear
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close AI Assistant"
                className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>
        {chatBody}
      </div>
    );
  }

  return (
    <div className="assistant-page-shell flex h-[calc(100vh-8rem)] flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <Link
            href={`/workspaces/${workspaceId}`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; Workspace
          </Link>
          <h1 className="mt-2 text-xl font-bold text-gray-900 sm:text-2xl">
            AI Assistant
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Ask questions or request changes — bulk updates, task edits, and
            project cleanup. Suggested edits appear as cards; nothing is saved
            until you click Apply.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isStreaming}
            onClick={clearHistory}
            className="self-start"
          >
            Clear chat
          </Button>
        )}
      </div>
      {chatBody}
    </div>
  );
};

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}
