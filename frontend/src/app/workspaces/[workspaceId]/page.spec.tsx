/**
 * WorkspaceDetailContent tests — verifies edit/delete UI for workspaces
 * and projects based on user role (ADMIN vs MEMBER).
 *
 * Tests target the Client Component (WorkspaceDetailContent) directly,
 * since the page itself is a Server Component that just passes props.
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
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
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

import { WorkspaceDetailContent } from '@/components/workspaces/workspace-detail-content';

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

const getWorkspaceHeaderButtons = () => {
  const heading = screen.getByText('Test Workspace');
  const headerRow = heading.closest('.flex.items-center.gap-3') as HTMLElement;
  return headerRow ? within(headerRow) : null;
};

const renderContent = () =>
  render(
    <WorkspaceDetailContent workspaceId="ws-1" initialProjects={projects} />,
  );

describe('WorkspaceDetailContent', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockPush.mockReset();
    mockWorkspaceCtx.refetch.mockReset();
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

    it('should show Edit and Delete buttons for workspace header', () => {
      renderContent();

      const header = getWorkspaceHeaderButtons()!;
      expect(header.getByText('Edit')).toBeTruthy();
      expect(header.getByText('Delete')).toBeTruthy();
    });

    it('should allow inline editing of workspace name', async () => {
      const user = userEvent.setup();
      mockApiFetch.mockResolvedValueOnce({ ...workspace, name: 'Renamed WS' });

      renderContent();

      const header = getWorkspaceHeaderButtons()!;
      await user.click(header.getByText('Edit'));

      const nameInput = screen.getByDisplayValue('Test Workspace');
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
      mockApiFetch.mockResolvedValueOnce(undefined);

      renderContent();

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

    it('should NOT delete workspace when confirm is cancelled', () => {
      window.confirm = jest.fn().mockReturnValue(false);

      renderContent();

      const header = getWorkspaceHeaderButtons()!;
      fireEvent.click(header.getByText('Delete'));

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('should show edit/delete controls on project cards', () => {
      renderContent();

      const allEdits = screen.getAllByText('Edit');
      expect(allEdits.length).toBe(3);
    });

    it('should delete a project and remove it from list', async () => {
      window.confirm = jest.fn().mockReturnValue(true);
      mockApiFetch.mockResolvedValueOnce(undefined);

      renderContent();

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

    it('should show Edit but NOT Delete for workspace header', () => {
      renderContent();

      const header = getWorkspaceHeaderButtons()!;
      expect(header.getByText('Edit')).toBeTruthy();
      expect(header.queryByText('Delete')).toBeNull();
    });

    it('should still show project edit/delete for admin', () => {
      renderContent();

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

    it('should NOT show Edit or Delete for workspace header', () => {
      renderContent();

      const heading = screen.getByText('Test Workspace');
      const headerRow = heading.closest('.flex.items-center.gap-3') as HTMLElement;
      const buttons = headerRow?.querySelectorAll('button');
      expect(buttons?.length ?? 0).toBe(0);
    });

    it('should NOT show edit/delete on project cards', () => {
      renderContent();

      const alphaCard = screen.getByText('Project Alpha').closest('.group') as HTMLElement;
      const hiddenBtns = alphaCard?.querySelectorAll('button');
      expect(hiddenBtns?.length ?? 0).toBe(0);
    });

    it('should still show projects list', () => {
      renderContent();

      expect(screen.getByText('Project Alpha')).toBeTruthy();
      expect(screen.getByText('Project Beta')).toBeTruthy();
    });

    it('should still show New project button', () => {
      renderContent();

      expect(screen.getByText('New project')).toBeTruthy();
    });
  });
});
