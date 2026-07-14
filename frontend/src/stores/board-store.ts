'use client';

import { create } from 'zustand';
import type { Task, TaskStatus } from '@/types/api';
import { apiFetch, ApiError } from '@/lib/api-client';

/**
 * Board store — manages kanban board UI state.
 *
 * Key design: optimistic updates with rollback.
 * When a card is dragged, we immediately update the local state
 * (so the UI feels instant), then fire the API request. If the
 * request fails, we rollback to the pre-drag snapshot and show
 * a toast-like error. This is the Phase 5 "Hunt for."
 */

interface BoardState {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;

  loadTasks: (workspaceId: string, projectId: string) => Promise<void>;
  syncTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  removeTask: (taskId: string) => void;

  /**
   * Optimistic reorder: moves the task in local state immediately,
   * then fires API. On failure, rolls back and sets error.
   */
  reorderTask: (
    workspaceId: string,
    taskId: string,
    newStatus: TaskStatus,
    afterTaskId: string | null,
    beforeTaskId: string | null,
  ) => Promise<void>;

  createTask: (
    workspaceId: string,
    projectId: string,
    title: string,
    status?: TaskStatus,
  ) => Promise<void>;

  clearError: () => void;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,

  loadTasks: async (workspaceId, projectId) => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await apiFetch<Task[]>(
        `/workspaces/${workspaceId}/tasks?projectId=${projectId}`,
      );
      set({ tasks, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof ApiError ? err.message : 'Failed to load tasks',
      });
    }
  },

  syncTasks: (tasks) => set({ tasks, isLoading: false }),

  addTask: (task) =>
    set((state) => {
      if (state.tasks.some((t) => t.id === task.id)) return state;
      return { tasks: [...state.tasks, task] };
    }),

  updateTask: (task) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
    })),

  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),

  reorderTask: async (workspaceId, taskId, newStatus, afterTaskId, beforeTaskId) => {
    // Snapshot before optimistic update
    const snapshot = get().tasks;

    // Optimistic: move the task to new position in local state
    const task = snapshot.find((t) => t.id === taskId);
    if (!task) return;

    const otherTasks = snapshot.filter((t) => t.id !== taskId);
    const columnTasks = otherTasks
      .filter((t) => t.status === newStatus)
      .sort((a, b) => a.order - b.order);

    let insertIdx: number;
    if (afterTaskId) {
      const afterIdx = columnTasks.findIndex((t) => t.id === afterTaskId);
      insertIdx = afterIdx + 1;
    } else if (beforeTaskId) {
      const beforeIdx = columnTasks.findIndex((t) => t.id === beforeTaskId);
      insertIdx = Math.max(0, beforeIdx);
    } else {
      insertIdx = columnTasks.length;
    }

    const afterOrder = insertIdx > 0 ? columnTasks[insertIdx - 1]!.order : 0;
    const beforeOrder =
      insertIdx < columnTasks.length ? columnTasks[insertIdx]!.order : afterOrder + 2;
    const optimisticOrder = (afterOrder + beforeOrder) / 2;

    const optimisticTask: Task = {
      ...task,
      status: newStatus,
      order: optimisticOrder,
    };

    set({ tasks: [...otherTasks, optimisticTask], error: null });

    try {
      await apiFetch<Task>(
        `/workspaces/${workspaceId}/tasks/${taskId}/reorder`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: newStatus,
            afterTaskId: afterTaskId ?? undefined,
            beforeTaskId: beforeTaskId ?? undefined,
          }),
        },
      );
    } catch (err) {
      // HUNT FOR (Phase 5): rollback on failure
      set({
        tasks: snapshot,
        error:
          err instanceof ApiError
            ? `Move failed: ${err.message}`
            : 'Move failed — card returned to original position',
      });
    }
  },

  createTask: async (workspaceId, projectId, title, status) => {
    try {
      const task = await apiFetch<Task>(
        `/workspaces/${workspaceId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({ projectId, title, status }),
        },
      );
      set((state) => {
        if (state.tasks.some((t) => t.id === task.id)) return state;
        return { tasks: [...state.tasks, task] };
      });
    } catch (err) {
      set({
        error:
          err instanceof ApiError
            ? err.message
            : 'Failed to create task',
      });
    }
  },

  clearError: () => set({ error: null }),
}));
