/**
 * WorkspaceDetailPage tests — verifies edit/delete UI for workspaces
 * and projects based on user role (ADMIN vs MEMBER).
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workspace, Project } from '@/types/api';

// ── Mocks ──

const mockApiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'ws-1' }),
  useRouter: () => ({ push: mockPush }),
}));

let mockWorkspaceCtx = {
  workspace: null as Workspace | null,
  myRole: 'ADMIN' as 'ADMIN' | 'MEMBER' | null,
  isOwner: true,
  isAdmin: true,
  isLoading: false,
  refetch: jest.fn(),
};
jest.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => mockWorkspaceCtx,
}));

import WorkspaceDetailPage from './page';

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Test Workspace',
  ownerId: 'user-admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  members: [
    {
      userId: 'user-admin',
      role: 'ADMIN',
      joinedAt: '2026-01-01T00:00:00.000Z',
      user: { id: 'user-admin', email: 'admin@test.com', name: 'Admin' },
    },
  ],
};

const projects: Project[] = [
  {
    id: 'proj-1',
    name: 'Project Alpha',
    description: 'First project',
    workspaceId: 'ws-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'proj-2',
    name: 'Project Beta',
    description: null,
    workspaceId: 'ws-1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

/**
 * Helper: find the workspace heading row and its buttons, separate
 * from the project-level edit/delete buttons.
 */
const getWorkspaceHeaderButtons = () => {
  const heading = screen.getByText('Test Workspace');
  const headerRow = heading.closest('.flex.items-center.gap-3') as HTMLElement;
  return headerRow ? within(headerRow) : null;
};

describe('WorkspaceDetailPage', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockPush.mockReset();
    mockWorkspaceCtx.refetch.mockReset();

    mockApiFetch.mockResolvedValue(projects);
  });

  // ── ADMIN + OWNER scenarios ──

  describe('ADMIN + owner user', () => {
    beforeEach(() => {
      mockWorkspaceCtx = {
        workspace,
        myRole: 'ADMIN',
        isOwner: true,
        isAdmin: true,
        isLoading: false,
        refetch: jest.fn(),
      };
    });

    it('should show Edit and Delete buttons for workspace header', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Workspace')).toBeTruthy();
      });

      const header = getWorkspaceHeaderButtons()!;
      expect(header.getByText('Edit')).toBeTruthy();
      expect(header.getByText('Delete')).toBeTruthy();
    });

    it('should allow inline editing of workspace name', async () => {
      const user = userEvent.setup();
      mockApiFetch
        .mockResolvedValueOnce(projects)
        .mockResolvedValueOnce({ ...workspace, name: 'Renamed WS' });

      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Workspace')).toBeTruthy();
      });

      const header = getWorkspaceHeaderButtons()!;
      await user.click(header.getByText('Edit'));

      const nameInput = screen.getByDisplayValue('Test Workspace');
      expect(nameInput).toBeTruthy();

      await user.clear(nameInput);
      await user.type(nameInput, 'Renamed WS');
      fireEvent.submit(nameInput.closest('form')!);

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-1',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ name: 'Renamed WS' }),
          }),
        );
      });
    });

    it('should delete workspace and redirect to /workspaces', async () => {
      window.confirm = jest.fn().mockReturnValue(true);
      mockApiFetch
        .mockResolvedValueOnce(projects)
        .mockResolvedValueOnce(undefined);

      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Workspace')).toBeTruthy();
      });

      const header = getWorkspaceHeaderButtons()!;
      fireEvent.click(header.getByText('Delete'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-1',
          { method: 'DELETE' },
        );
      });

      expect(mockPush).toHaveBeenCalledWith('/workspaces');
    });

    it('should NOT delete workspace when confirm is cancelled', async () => {
      window.confirm = jest.fn().mockReturnValue(false);

      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Workspace')).toBeTruthy();
      });

      const header = getWorkspaceHeaderButtons()!;
      fireEvent.click(header.getByText('Delete'));

      // Only the projects fetch call — no DELETE
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });

    it('should show edit/delete controls on project cards', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeTruthy();
      });

      const allEdits = screen.getAllByText('Edit');
      // workspace Edit + 2 project Edit = 3
      expect(allEdits.length).toBe(3);
    });

    it('should delete a project and remove it from list', async () => {
      window.confirm = jest.fn().mockReturnValue(true);
      mockApiFetch
        .mockResolvedValueOnce(projects)
        .mockResolvedValueOnce(undefined);

      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeTruthy();
      });

      const alphaCard = screen.getByText('Project Alpha').closest('.group') as HTMLElement;
      const deleteBtn = within(alphaCard).getByText('Delete');

      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-1/projects/proj-1',
          { method: 'DELETE' },
        );
      });

      await waitFor(() => {
        expect(screen.queryByText('Project Alpha')).toBeNull();
      });
      expect(screen.getByText('Project Beta')).toBeTruthy();
    });
  });

  // ── ADMIN but NOT owner ──

  describe('ADMIN but not owner', () => {
    beforeEach(() => {
      mockWorkspaceCtx = {
        workspace,
        myRole: 'ADMIN',
        isOwner: false,
        isAdmin: true,
        isLoading: false,
        refetch: jest.fn(),
      };
    });

    it('should show Edit but NOT Delete for workspace header', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Workspace')).toBeTruthy();
      });

      const header = getWorkspaceHeaderButtons()!;
      expect(header.getByText('Edit')).toBeTruthy();
      expect(header.queryByText('Delete')).toBeNull();
    });

    it('should still show project edit/delete for admin', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeTruthy();
      });

      const alphaCard = screen.getByText('Project Alpha').closest('.group') as HTMLElement;
      expect(within(alphaCard).getByText('Edit')).toBeTruthy();
      expect(within(alphaCard).getByText('Delete')).toBeTruthy();
    });
  });

  // ── MEMBER (non-admin) scenarios ──

  describe('MEMBER user (non-admin)', () => {
    beforeEach(() => {
      mockWorkspaceCtx = {
        workspace,
        myRole: 'MEMBER',
        isOwner: false,
        isAdmin: false,
        isLoading: false,
        refetch: jest.fn(),
      };
    });

    it('should NOT show Edit or Delete for workspace header', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Workspace')).toBeTruthy();
      });

      const heading = screen.getByText('Test Workspace');
      const headerRow = heading.closest('.flex.items-center.gap-3') as HTMLElement;
      const buttons = headerRow?.querySelectorAll('button');
      expect(buttons?.length ?? 0).toBe(0);
    });

    it('should NOT show edit/delete on project cards', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeTruthy();
      });

      const alphaCard = screen.getByText('Project Alpha').closest('.group') as HTMLElement;
      const hiddenBtns = alphaCard?.querySelectorAll('button');
      expect(hiddenBtns?.length ?? 0).toBe(0);
    });

    it('should still show projects list and allow navigation', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeTruthy();
        expect(screen.getByText('Project Beta')).toBeTruthy();
      });
    });

    it('should still show New project button', async () => {
      render(<WorkspaceDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('New project')).toBeTruthy();
      });
    });
  });

  // ── Loading state ──

  it('should show spinner while loading', () => {
    mockWorkspaceCtx = {
      workspace: null,
      myRole: null,
      isOwner: false,
      isAdmin: false,
      isLoading: true,
      refetch: jest.fn(),
    };
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    render(<WorkspaceDetailPage />);

    expect(screen.queryByText('Test Workspace')).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });
});
