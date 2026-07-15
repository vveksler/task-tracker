/**
 * TaskModal tests — verifies edit/delete UI based on user role:
 * - ADMIN: can edit fields, save changes, delete task
 * - MEMBER: fields disabled, no save/delete buttons
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '@/types/api';

const mockApiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockUpdateTask = jest.fn();
const mockRemoveTask = jest.fn();
jest.mock('@/stores/board-store', () => ({
  useBoardStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updateTask: mockUpdateTask, removeTask: mockRemoveTask }),
}));

let mockIsAdmin = true;
const mockWorkspace = {
  id: 'ws-1',
  name: 'Test WS',
  ownerId: 'owner-1',
  createdAt: '2026-01-01',
  members: [
    { userId: 'user-1', role: 'ADMIN' as const, joinedAt: '2026-01-01', user: { id: 'user-1', email: 'admin@test.com', name: 'Admin User' } },
    { userId: 'user-2', role: 'MEMBER' as const, joinedAt: '2026-01-01', user: { id: 'user-2', email: 'member@test.com', name: 'Member User' } },
  ],
};
jest.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({ isAdmin: mockIsAdmin, workspace: mockWorkspace }),
}));

import { TaskModal } from './task-modal';

const task: Task = {
  id: 'task-1',
  title: 'Test Task',
  description: 'A test description',
  status: 'TODO',
  order: 1,
  projectId: 'proj-1',
  assigneeId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('TaskModal', () => {
  const onClose = jest.fn();

  beforeEach(() => {
    mockApiFetch.mockReset();
    mockUpdateTask.mockReset();
    mockRemoveTask.mockReset();
    onClose.mockReset();
    mockIsAdmin = true;
  });

  // ── Admin user scenarios ──

  describe('ADMIN user', () => {
    beforeEach(() => { mockIsAdmin = true; });

    it('should render editable fields for admin', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const titleInput = screen.getByDisplayValue('Test Task') as HTMLInputElement;
      expect(titleInput.disabled).toBe(false);

      const descInput = screen.getByDisplayValue('A test description') as HTMLTextAreaElement;
      expect(descInput.disabled).toBe(false);

      const statusSelect = screen.getByDisplayValue('To Do') as HTMLSelectElement;
      expect(statusSelect.disabled).toBe(false);
    });

    it('should show Save and Delete buttons for admin', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      expect(screen.getByText('Save')).toBeTruthy();
      expect(screen.getByText('Delete task')).toBeTruthy();
    });

    it('should disable Save when nothing changed', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const saveBtn = screen.getByText('Save') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);
    });

    it('should enable Save after editing title', async () => {
      const user = userEvent.setup();
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const titleInput = screen.getByDisplayValue('Test Task');
      await user.clear(titleInput);
      await user.type(titleInput, 'Updated Title');

      const saveBtn = screen.getByText('Save') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });

    it('should call PATCH API and update store on save', async () => {
      const user = userEvent.setup();
      const updatedTask = { ...task, title: 'New Title' };
      mockApiFetch.mockResolvedValue(updatedTask);

      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const titleInput = screen.getByDisplayValue('Test Task');
      await user.clear(titleInput);
      await user.type(titleInput, 'New Title');
      await user.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-1/tasks/task-1',
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('"title":"New Title"'),
          }),
        );
      });

      expect(mockUpdateTask).toHaveBeenCalledWith(updatedTask);
      expect(onClose).toHaveBeenCalled();
    });

    it('should call DELETE API and remove from store on delete', async () => {
      window.confirm = jest.fn().mockReturnValue(true);
      mockApiFetch.mockResolvedValue(undefined);

      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      fireEvent.click(screen.getByText('Delete task'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-1/tasks/task-1',
          { method: 'DELETE' },
        );
      });

      expect(mockRemoveTask).toHaveBeenCalledWith('task-1');
      expect(onClose).toHaveBeenCalled();
    });

    it('should NOT delete when confirm is cancelled', () => {
      window.confirm = jest.fn().mockReturnValue(false);

      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      fireEvent.click(screen.getByText('Delete task'));

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(mockRemoveTask).not.toHaveBeenCalled();
    });

    it('should allow changing task status', async () => {
      const user = userEvent.setup();
      const updatedTask = { ...task, status: 'DONE' as const };
      mockApiFetch.mockResolvedValue(updatedTask);

      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const statusSelect = screen.getByDisplayValue('To Do');
      await user.selectOptions(statusSelect, 'DONE');
      await user.click(screen.getByText('Save'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/workspaces/ws-1/tasks/task-1',
          expect.objectContaining({
            body: expect.stringContaining('"status":"DONE"'),
          }),
        );
      });
    });
  });

  // ── Regular member (non-admin) scenarios ──
  // Members can edit task fields (title, description, status, assignee)
  // but cannot delete tasks — only admins can delete.

  describe('MEMBER user (non-admin)', () => {
    beforeEach(() => { mockIsAdmin = false; });

    it('should render editable fields for member', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const titleInput = screen.getByDisplayValue('Test Task') as HTMLInputElement;
      expect(titleInput.disabled).toBe(false);

      const descInput = screen.getByDisplayValue('A test description') as HTMLTextAreaElement;
      expect(descInput.disabled).toBe(false);

      const statusSelect = screen.getByDisplayValue('To Do') as HTMLSelectElement;
      expect(statusSelect.disabled).toBe(false);
    });

    it('should show Save button but NOT Delete for member', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      expect(screen.getByText('Save')).toBeTruthy();
      expect(screen.queryByText('Delete task')).toBeNull();
    });

    it('should still show Cancel button for member', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('should still display task data', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      expect(screen.getByDisplayValue('Test Task')).toBeTruthy();
      expect(screen.getByDisplayValue('A test description')).toBeTruthy();
      expect(screen.getByText('Task details')).toBeTruthy();
    });

    it('should show assignee picker with workspace members', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      expect(screen.getByText('Assignee')).toBeTruthy();
      expect(screen.getByText('Unassigned')).toBeTruthy();
    });
  });

  // ── Shared behavior ──

  describe('shared behavior', () => {
    it('should close on Escape key', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('should close on backdrop click', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      const backdrop = screen.getByText('Task details').closest('.fixed');
      if (backdrop) {
        fireEvent.click(backdrop);
      }
      expect(onClose).toHaveBeenCalled();
    });

    it('should close on ✕ button click', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      fireEvent.click(screen.getByText('✕'));

      expect(onClose).toHaveBeenCalled();
    });

    it('should show creation date', () => {
      render(<TaskModal task={task} workspaceId="ws-1" onClose={onClose} />);

      expect(screen.getByText(/Created/)).toBeTruthy();
    });
  });
});
