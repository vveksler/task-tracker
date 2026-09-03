/**
 * AssistantChat Apply wiring — proposals call existing Nest task/project APIs.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { AssistantProposal } from '@/types/api';

const mockApiFetch = jest.fn();
const mockApiFetchStream = jest.fn();
const mockPush = jest.fn();
let mockProposals: AssistantProposal[] = [];
let mockParams: { projectId?: string } = {};
/** When set, SSE waits after the first token before emitting actions. */
let mockStreamGate: Promise<void> | null = null;

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
    if (mockStreamGate) {
      await mockStreamGate;
    }
    yield { kind: 'actions', proposals: mockProposals };
  },
}));

import { AssistantChat } from '@/components/assistant/assistant-chat';
import { AssistantProvider, useAssistant } from '@/lib/assistant-context';

function BoardScopeSetter({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { setBoardScope } = useAssistant();
  useEffect(() => {
    setBoardScope({ projectId, projectName });
    return () => setBoardScope(null);
  }, [setBoardScope, projectId, projectName]);
  return null;
}

describe('AssistantChat proposals', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
    window.localStorage.clear();
    mockApiFetch.mockReset();
    mockApiFetchStream.mockReset();
    mockPush.mockReset();
    mockParams = {};
    mockStreamGate = null;
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

  it('shows a loader until action cards arrive', async () => {
    let release!: () => void;
    mockStreamGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'Move SSL',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText(/Preparing confirmations/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Apply' }),
    ).not.toBeInTheDocument();

    release();

    expect(
      await screen.findByRole('button', { name: 'Apply' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByText(/Preparing confirmations/i),
      ).not.toBeInTheDocument();
    });
  });

  it('shows bulk-oriented empty-state examples on page variant', () => {
    render(<AssistantChat workspaceId="ws-1" variant="page" />);

    expect(
      screen.getByRole('heading', { name: 'AI Assistant' }),
    ).toBeInTheDocument();
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

  it('prefers boardScope projectId over stale route params', async () => {
    mockParams = { projectId: 'proj-stale-route' };
    const user = userEvent.setup();
    render(
      <AssistantProvider>
        <BoardScopeSetter
          projectId="proj-open-board"
          projectName="Infrastructure"
        />
        <AssistantChat workspaceId="ws-1" />
      </AssistantProvider>,
    );

    expect(await screen.findByText(/Scoped to/)).toBeInTheDocument();
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'delete all tasks in the current project',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(mockApiFetchStream).toHaveBeenCalledWith(
        '/workspaces/ws-1/assistant/ask',
        expect.objectContaining({
          body: JSON.stringify({
            question: 'delete all tasks in the current project',
            currentProjectId: 'proj-open-board',
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

  it('recreates then bulk-deletes for move_tasks_to_project', async () => {
    mockProposals = [
      {
        type: 'move_tasks_to_project',
        summary: 'Move Infra tasks to Auth',
        sourceProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        targetProjectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    ];
    mockApiFetch.mockImplementation(
      (url: string, init?: { method?: string }) => {
        if (
          typeof url === 'string' &&
          url.includes(
            '/tasks?projectId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ) &&
          !init?.method
        ) {
          return Promise.resolve([
            {
              title: 'Postgres backup',
              description: 'Weekly drill',
              status: 'DONE',
              assigneeId: null,
            },
            {
              title: 'Redis TTL',
              description: null,
              status: 'TODO',
              assigneeId: 'user-1',
            },
          ]);
        }
        return Promise.resolve({ id: 'created' });
      },
    );

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'move all tasks to Auth',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks?projectId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            title: 'Postgres backup',
            description: 'Weekly drill',
            status: 'DONE',
          }),
        }),
      );
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            title: 'Redis TTL',
            status: 'TODO',
            assigneeId: 'user-1',
          }),
        }),
      );
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks/bulk-delete',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          }),
        },
      );
    });

    expect(
      await screen.findByText('Applied — Moved 2 task(s)'),
    ).toBeInTheDocument();
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
        projectId: '22222222-2222-4222-8222-222222222222',
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
          projectId: '22222222-2222-4222-8222-222222222222',
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

  it('binds create_task projectId after create_project Apply', async () => {
    mockProposals = [
      {
        type: 'create_project',
        summary: "Create new project 'My test project'",
        name: 'My test project',
      },
      {
        type: 'create_task',
        summary: "Add task 'Setup project structure'",
        projectId: 'My test project',
        projectName: 'My test project',
        title: 'Setup project structure',
      },
    ];
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith('/projects') && !path.includes('dedupe')) {
        return {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'My test project',
          workspaceId: 'ws-1',
          createdAt: '2026-07-31T00:00:00.000Z',
        };
      }
      return {};
    });

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'create project and tasks',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const applyButtons = await screen.findAllByRole('button', {
      name: 'Apply',
    });
    await user.click(applyButtons[0]!);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/workspaces/ws-1/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'My test project' }),
      });
    });

    // Remaining Apply is the create_task card (now bound to real UUID).
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/workspaces/ws-1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId: '11111111-1111-4111-8111-111111111111',
          title: 'Setup project structure',
        }),
      });
    });
  });

  it('binds move target after create_project and moves status-filtered tasks', async () => {
    mockProposals = [
      {
        type: 'create_project',
        summary: 'Create Payments2',
        name: 'Payments2',
      },
      {
        type: 'move_tasks_to_project',
        summary: 'Move DONE tasks to Payments2',
        sourceProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        targetProjectName: 'Payments2',
        statusIn: ['DONE'],
      },
    ];
    mockApiFetch.mockImplementation(
      (url: string, init?: { method?: string }) => {
        if (
          typeof url === 'string' &&
          url.endsWith('/projects') &&
          init?.method === 'POST'
        ) {
          return Promise.resolve({
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Payments2',
            workspaceId: 'ws-1',
            createdAt: '2026-08-12T00:00:00.000Z',
          });
        }
        if (
          typeof url === 'string' &&
          url.includes(
            '/tasks?projectId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ) &&
          !init?.method
        ) {
          return Promise.resolve([
            {
              title: 'Done task',
              description: 'keep',
              status: 'DONE',
              assigneeId: null,
            },
            {
              title: 'Open task',
              description: null,
              status: 'TODO',
              assigneeId: null,
            },
          ]);
        }
        return Promise.resolve({ id: 'created' });
      },
    );

    const user = userEvent.setup();
    render(<AssistantChat workspaceId="ws-1" />);

    await user.type(
      screen.getByPlaceholderText(/ask about tasks/i),
      'create Payments2 and move DONE',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText(/Apply “create project 'Payments2'” first/),
    ).toBeInTheDocument();

    const applyButtons = await screen.findAllByRole('button', {
      name: 'Apply',
    });
    expect(applyButtons[1]).toBeDisabled();

    await user.click(applyButtons[0]!);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/workspaces/ws-1/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Payments2' }),
      });
    });

    const moveApply = await screen.findByRole('button', { name: 'Apply' });
    expect(moveApply).not.toBeDisabled();
    await user.click(moveApply);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            projectId: '22222222-2222-4222-8222-222222222222',
            title: 'Done task',
            description: 'keep',
            status: 'DONE',
          }),
        }),
      );
      expect(mockApiFetch).not.toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks',
        expect.objectContaining({
          body: expect.stringContaining('Open task'),
        }),
      );
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-1/tasks/bulk-delete',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: {
              projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              statusIn: ['DONE'],
            },
          }),
        },
      );
    });

    expect(
      await screen.findByText('Applied — Moved 1 task(s)'),
    ).toBeInTheDocument();
  });
});
