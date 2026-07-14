/**
 * Board store tests — covers the core Zustand store logic including
 * the Phase 5 "Hunt for": optimistic update rollback on failed reorder.
 */

import type { Task } from '@/types/api';

// Mock apiFetch before importing the store
const mockApiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { useBoardStore } from './board-store';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test task',
  description: null,
  status: 'TODO',
  order: 1,
  projectId: 'proj-1',
  assigneeId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('BoardStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useBoardStore.setState({
      tasks: [],
      isLoading: false,
      error: null,
    });
    mockApiFetch.mockReset();
  });

  describe('syncTasks', () => {
    it('should replace tasks and set isLoading to false', () => {
      useBoardStore.setState({ isLoading: true });
      const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];

      useBoardStore.getState().syncTasks(tasks);

      expect(useBoardStore.getState().tasks).toHaveLength(2);
      expect(useBoardStore.getState().isLoading).toBe(false);
    });
  });

  describe('addTask — deduplication', () => {
    it('should add a new task', () => {
      const task = makeTask({ id: 'new-1' });

      useBoardStore.getState().addTask(task);

      expect(useBoardStore.getState().tasks).toHaveLength(1);
      expect(useBoardStore.getState().tasks[0]!.id).toBe('new-1');
    });

    it('should NOT add a duplicate task (socket + REST race)', () => {
      const task = makeTask({ id: 'dup-1' });

      useBoardStore.getState().addTask(task);
      useBoardStore.getState().addTask(task);

      expect(useBoardStore.getState().tasks).toHaveLength(1);
    });
  });

  describe('updateTask', () => {
    it('should replace task by id', () => {
      useBoardStore.setState({ tasks: [makeTask({ id: 't1', title: 'Old' })] });

      useBoardStore.getState().updateTask(makeTask({ id: 't1', title: 'New' }));

      expect(useBoardStore.getState().tasks[0]!.title).toBe('New');
    });
  });

  describe('removeTask', () => {
    it('should remove task by id', () => {
      useBoardStore.setState({
        tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })],
      });

      useBoardStore.getState().removeTask('a');

      expect(useBoardStore.getState().tasks).toHaveLength(1);
      expect(useBoardStore.getState().tasks[0]!.id).toBe('b');
    });
  });

  describe('reorderTask — optimistic update', () => {
    const taskA = makeTask({ id: 'a', status: 'TODO', order: 1 });
    const taskB = makeTask({ id: 'b', status: 'TODO', order: 2 });
    const taskC = makeTask({ id: 'c', status: 'IN_PROGRESS', order: 1 });

    it('should optimistically move task to new status before API resolves', async () => {
      useBoardStore.setState({ tasks: [taskA, taskB, taskC] });
      mockApiFetch.mockResolvedValue(makeTask({ id: 'a', status: 'IN_PROGRESS' }));

      const promise = useBoardStore.getState().reorderTask(
        'ws-1', 'a', 'IN_PROGRESS', 'c', null,
      );

      // Before API resolves, task should already be moved optimistically
      const movedTask = useBoardStore.getState().tasks.find((t) => t.id === 'a');
      expect(movedTask!.status).toBe('IN_PROGRESS');

      await promise;
    });

    /**
     * HUNT FOR (Phase 5): optimistic update rollback.
     *
     * When the server rejects the reorder (e.g. backend down, conflict),
     * the card must snap back to its original column/position and the
     * user sees an error message — not a silently stuck card.
     */
    it('should rollback to snapshot and show error when API fails', async () => {
      useBoardStore.setState({ tasks: [taskA, taskB, taskC] });
      mockApiFetch.mockRejectedValue(new Error('Network error'));

      await useBoardStore.getState().reorderTask(
        'ws-1', 'a', 'IN_PROGRESS', null, null,
      );

      // Tasks should be rolled back to the original snapshot
      const state = useBoardStore.getState();
      expect(state.tasks).toEqual([taskA, taskB, taskC]);
      expect(state.error).toBe(
        'Move failed — card returned to original position',
      );
    });

    it('should show API error message on ApiError', async () => {
      useBoardStore.setState({ tasks: [taskA] });

      const { ApiError } = jest.requireMock('@/lib/api-client') as {
        ApiError: new (status: number, message: string) => Error;
      };
      mockApiFetch.mockRejectedValue(new ApiError(400, 'Concurrent conflict'));

      await useBoardStore.getState().reorderTask(
        'ws-1', 'a', 'DONE', null, null,
      );

      expect(useBoardStore.getState().error).toBe(
        'Move failed: Concurrent conflict',
      );
    });

    it('should compute correct optimistic order between two tasks', async () => {
      const t1 = makeTask({ id: 't1', status: 'TODO', order: 2 });
      const t2 = makeTask({ id: 't2', status: 'TODO', order: 6 });
      const moving = makeTask({ id: 'mv', status: 'IN_PROGRESS', order: 1 });

      useBoardStore.setState({ tasks: [t1, t2, moving] });
      mockApiFetch.mockResolvedValue(makeTask());

      await useBoardStore.getState().reorderTask(
        'ws-1', 'mv', 'TODO', 't1', 't2',
      );

      // Midpoint between t1 (order=2) and t2 (order=6) = 4
      const movedTask = useBoardStore.getState().tasks.find((t) => t.id === 'mv');
      expect(movedTask!.order).toBe(4);
      expect(movedTask!.status).toBe('TODO');
    });
  });

  describe('createTask — deduplication', () => {
    it('should add task from API response', async () => {
      const newTask = makeTask({ id: 'created-1' });
      mockApiFetch.mockResolvedValue(newTask);

      await useBoardStore.getState().createTask('ws-1', 'proj-1', 'New task');

      expect(useBoardStore.getState().tasks).toHaveLength(1);
    });

    it('should NOT duplicate if socket event arrived first', async () => {
      const newTask = makeTask({ id: 'created-1' });

      // Socket event arrives first
      useBoardStore.getState().addTask(newTask);
      expect(useBoardStore.getState().tasks).toHaveLength(1);

      // Then REST response arrives
      mockApiFetch.mockResolvedValue(newTask);
      await useBoardStore.getState().createTask('ws-1', 'proj-1', 'New task');

      // Still only one task
      expect(useBoardStore.getState().tasks).toHaveLength(1);
    });

    it('should set error on create failure', async () => {
      mockApiFetch.mockRejectedValue(new Error('Server error'));

      await useBoardStore.getState().createTask('ws-1', 'proj-1', 'Fail');

      expect(useBoardStore.getState().tasks).toHaveLength(0);
      expect(useBoardStore.getState().error).toBe('Failed to create task');
    });
  });

  describe('clearError', () => {
    it('should clear the error message', () => {
      useBoardStore.setState({ error: 'Something went wrong' });

      useBoardStore.getState().clearError();

      expect(useBoardStore.getState().error).toBeNull();
    });
  });
});
