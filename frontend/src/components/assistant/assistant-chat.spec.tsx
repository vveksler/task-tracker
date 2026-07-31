/**
 * AssistantChat Apply wiring — proposals call existing Nest task/project APIs.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssistantProposal } from '@/types/api';

const mockApiFetch = jest.fn();
const mockApiFetchStream = jest.fn();
const mockPush = jest.fn();
let mockProposals: AssistantProposal[] = [];
let mockParams: { projectId?: string } = {};

jest.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  apiFetchStream: (...args: unknown[]) => mockApiFetchStream(...args),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => mockParams,
  usePathname: () =>
    mockParams.projectId
      ? `/workspaces/ws-1/projects/${mockParams.projectId}`
      : '/workspaces/ws-1',
}));

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@test.com', name: 'Vadim' },
    isLoading: false,
  }),
}));

jest.mock('@/lib/assistant-sse', () => ({
  parseAssistantSse: async function* () {
    yield { kind: 'token', text: 'Here is a suggestion.' };
    yield { kind: 'actions', proposals: mockProposals };
  },
}));

import { AssistantChat } from '@/components/assistant/assistant-chat';

describe('AssistantChat proposals', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
    window.localStorage.clear();
    mockApiFetch.mockReset();
    mockApiFetchStream.mockReset();
    mockPush.mockReset();
    mockParams = {};
    mockApiFetch.mockResolvedValue({});
    mockApiFetchStream.mockResolvedValue({ body: {} });
    mockProposals = [
      {
        type: 'update_task',
        summary: 'Move SSL to In Progress',
        taskId: 'task-ssl',
        patch: { status: 'IN_PROGRESS' },
      },
    ];
  });

  it('shows bulk-oriented empty-state examples on page variant', () => {
    render(<AssistantChat workspaceId="ws-1" variant="page" />);

    expect(screen.getByRole('heading', { name: 'AI Assistant' })).toBeInTheDocument();
    expect(
      screen.getByText(/Move all auth tasks to In Progress/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Delete all tasks in project/i),
    ).toBeInTheDocument();
  });

  it('sends currentProjectId when on a project board route', async () => {
    mockParams = { projectId: 'proj-current' };
    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'delete all tasks here',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(mockApiFetchStream).toHaveBeenCalledWith(
        '/workspaces/ws-1/assistant/ask',
        expect.objectContaining({
          body: JSON.stringify({
            question: 'delete all tasks here',
            currentProjectId: 'proj-current',
          }),
        }),
      );
    });
  });

  it('calls PATCH task API when Apply is clicked', async () => {
    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'Move SSL to in progress',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('Move SSL to In Progress'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks/task-ssl',
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'IN_PROGRESS' }),
        },
      );
    });

    expect(await screen.findByText('Applied')).toBeInTheDocument();
  });

  it('calls onApplied after a successful Apply', async () => {
    const onApplied = jest.fn();
    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" onApplied={onApplied} />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'Move SSL',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update_task', taskId: 'task-ssl' }),
      );
    });
  });

  it('calls bulk-update API for bulk_update_tasks proposals', async () => {
    mockProposals = [
      {
        type: 'bulk_update_tasks',
        summary: 'Move auth tasks to In Progress',
        filter: {
          titleContains: 'auth',
          descriptionContains: 'auth',
        },
        patch: { status: 'IN_PROGRESS' },
      },
    ];
    mockApiFetch.mockResolvedValue({
      updatedCount: 3,
      taskIds: ['a', 'b', 'c'],
    });

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'move all auth to in progress',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('Move auth tasks to In Progress'),
    ).toBeInTheDocument();
    expect(screen.getByText('bulk update tasks')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks/bulk-update',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: {
              titleContains: 'auth',
              descriptionContains: 'auth',
            },
            patch: { status: 'IN_PROGRESS' },
          }),
        },
      );
    });

    expect(
      await screen.findByText('Applied — Updated 3 task(s)'),
    ).toBeInTheDocument();
  });

  it('calls bulk-delete API for bulk_delete_tasks proposals', async () => {
    mockProposals = [
      {
        type: 'bulk_delete_tasks',
        summary: 'Delete all tasks in Auth',
        filter: { projectName: 'Auth & Security' },
      },
    ];
    mockApiFetch.mockResolvedValue({
      deletedCount: 4,
      taskIds: ['a', 'b', 'c', 'd'],
    });

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'delete all tasks in Auth',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks/bulk-delete',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { projectName: 'Auth & Security' },
          }),
        },
      );
    });

    expect(
      await screen.findByText('Applied — Deleted 4 task(s)'),
    ).toBeInTheDocument();
  });

  it('navigates on Go for navigate_to_project', async () => {
    mockProposals = [
      {
        type: 'navigate_to_project',
        summary: 'Open Payments',
        projectId: 'proj-pay',
      },
    ];

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'open Payments',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await user.click(await screen.findByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/workspaces/ws-1/projects/proj-pay',
      );
    });
  });

  it('sends prior chat history with ask', async () => {
    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'assign Vadim to all tasks',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(mockApiFetchStream).toHaveBeenCalled();
    });

    mockApiFetchStream.mockClear();
    mockApiFetchStream.mockResolvedValue({ body: {} });

    await user.type(screen.getByPlaceholderText(/ask about tasks/i), 'yes');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(mockApiFetchStream).toHaveBeenCalledWith(
        '/workspaces/ws-1/assistant/ask',
        expect.objectContaining({
          body: expect.stringContaining('"history"'),
        }),
      );
    });

    const body = JSON.parse(
      (mockApiFetchStream.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { question: string; history: { role: string; content: string }[] };
    expect(body.question).toBe('yes');
    expect(body.history.some((h) => h.content.includes('assign Vadim'))).toBe(
      true,
    );
  });

  it('calls create task API with assigneeId when present', async () => {
    mockProposals = [
      {
        type: 'create_task',
        summary: 'Create walk dog for Vadim',
        projectId: 'proj-auth',
        title: 'Выгулять собаку Пичи',
        status: 'IN_PROGRESS',
        assigneeId: 'user-vadim',
      },
    ];

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'create task assigned to Vadim',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/workspaces/ws-1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'proj-auth',
          title: 'Выгулять собаку Пичи',
          status: 'IN_PROGRESS',
          assigneeId: 'user-vadim',
        }),
      });
    });
  });

  it('calls dedupe API for dedupe_projects proposals', async () => {
    mockProposals = [
      {
        type: 'dedupe_projects',
        summary: 'Remove duplicate Auth projects',
        keep: 'oldest',
      },
    ];
    mockApiFetch.mockResolvedValue({
      removedCount: 2,
      removedProjectIds: ['p2', 'p3'],
      keptProjectIds: ['p1'],
    });

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'delete duplicate projects',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('Remove duplicate Auth projects'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/projects/dedupe',
        {
          method: 'POST',
          body: JSON.stringify({
            keep: 'oldest',
          }),
        },
      );
    });

    expect(
      await screen.findByText('Applied — Removed 2 duplicate project(s)'),
    ).toBeInTheDocument();
  });
});
