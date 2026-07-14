'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Task, TaskStatus, BoardSyncEvent, TaskCreatedEvent, TaskUpdatedEvent, TaskMovedEvent, TaskDeletedEvent } from '@/types/api';
import { useBoardStore } from '@/stores/board-store';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { BoardColumn } from './board-column';
import { TaskCard } from './task-card';
import { TaskModal } from './task-modal';

const COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

const emptyColumns: Record<TaskStatus, Task[]> = {
  TODO: [],
  IN_PROGRESS: [],
  IN_REVIEW: [],
  DONE: [],
};

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const map: Record<TaskStatus, Task[]> = { ...emptyColumns, TODO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] };
  for (const task of tasks) {
    map[task.status]?.push(task);
  }
  for (const key of COLUMNS) {
    map[key].sort((a, b) => a.order - b.order);
  }
  return map;
}

interface KanbanBoardProps {
  workspaceId: string;
  projectId: string;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  workspaceId,
  projectId,
}) => {
  const {
    tasks,
    isLoading,
    error,
    reset,
    syncTasks,
    addTask,
    updateTask,
    removeTask,
    reorderTask,
    clearError,
  } = useBoardStore();

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Local column state used during drag for live preview.
  // Mirrors the store when not dragging; mutated on dragOver for visual feedback.
  const [columns, setColumns] = useState<Record<TaskStatus, Task[]>>(emptyColumns);
  const isDragging = activeTask !== null;

  // Sync store → local columns when NOT dragging
  const storeColumns = useMemo(() => groupByStatus(tasks), [tasks]);
  useEffect(() => {
    if (!isDragging) {
      setColumns(storeColumns);
    }
  }, [storeColumns, isDragging]);

  const storeRef = useRef({ syncTasks, addTask, updateTask, removeTask });
  storeRef.current = { syncTasks, addTask, updateTask, removeTask };

  // Clear stale data and show loading spinner immediately when projectId
  // changes — prevents the old project's tasks from flashing before
  // board:sync arrives with the new project's data.
  useEffect(() => {
    reset();
  }, [projectId, reset]);

  // Socket.io connection — board:sync on join provides the initial task list,
  // so no separate REST fetch is needed.
  useEffect(() => {
    const socket = connectSocket();

    socket.emit('workspace:join', { workspaceId, projectId });

    socket.on('board:sync', (event: BoardSyncEvent) => {
      storeRef.current.syncTasks(event.tasks);
    });

    socket.on('task:created', (event: TaskCreatedEvent) => {
      storeRef.current.addTask(event.task);
    });

    socket.on('task:updated', (event: TaskUpdatedEvent) => {
      storeRef.current.updateTask(event.task);
    });

    socket.on('task:moved', (event: TaskMovedEvent) => {
      storeRef.current.updateTask(event.task);
    });

    socket.on('task:deleted', (event: TaskDeletedEvent) => {
      storeRef.current.removeTask(event.taskId);
    });

    socket.on('connect', () => {
      socket.emit('workspace:join', { workspaceId, projectId });
    });

    return () => {
      socket.emit('workspace:leave');
      socket.off('board:sync');
      socket.off('task:created');
      socket.off('task:updated');
      socket.off('task:moved');
      socket.off('task:deleted');
      socket.off('connect');
      disconnectSocket();
    };
  }, [workspaceId, projectId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const findContainer = useCallback(
    (id: string): TaskStatus | null => {
      if (id.startsWith('column-')) {
        return id.replace('column-', '') as TaskStatus;
      }
      for (const col of COLUMNS) {
        if (columns[col].some((t) => t.id === id)) return col;
      }
      return null;
    },
    [columns],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (task) {
        setActiveTask(task);
        setColumns(groupByStatus(tasks));
      }
    },
    [tasks],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const activeContainer = findContainer(activeId);
      const overContainer = findContainer(overId);

      if (!activeContainer || !overContainer) return;

      // Same column → reorder within (SortableContext handles the animation)
      if (activeContainer === overContainer) {
        setColumns((prev) => {
          const col = [...prev[activeContainer]];
          const oldIdx = col.findIndex((t) => t.id === activeId);
          const newIdx = overId.startsWith('column-')
            ? col.length - 1
            : col.findIndex((t) => t.id === overId);

          if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;

          return { ...prev, [activeContainer]: arrayMove(col, oldIdx, newIdx) };
        });
        return;
      }

      // Cross-column → move the task to the target column
      setColumns((prev) => {
        const sourceCol = prev[activeContainer].filter((t) => t.id !== activeId);
        const destCol = [...prev[overContainer]];

        const movedTask = prev[activeContainer].find((t) => t.id === activeId);
        if (!movedTask) return prev;

        const taskWithNewStatus: Task = { ...movedTask, status: overContainer };

        let insertIdx: number;
        if (overId.startsWith('column-')) {
          insertIdx = destCol.length;
        } else {
          const overIdx = destCol.findIndex((t) => t.id === overId);
          if (overIdx < 0) {
            insertIdx = destCol.length;
          } else {
            // If cursor is below the midpoint of the target card, insert after it
            const activeY = active.rect.current.translated?.top ?? 0;
            const overMidY = over.rect.top + over.rect.height / 2;
            insertIdx = activeY > overMidY ? overIdx + 1 : overIdx;
          }
        }

        destCol.splice(insertIdx, 0, taskWithNewStatus);

        return {
          ...prev,
          [activeContainer]: sourceCol,
          [overContainer]: destCol,
        };
      });
    },
    [findContainer],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveTask(null);

      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const overContainer = findContainer(overId);
      if (!overContainer) return;

      const task = tasks.find((t) => t.id === activeId);
      if (!task) return;

      // Determine the final position from the visual columns state
      const destCol = columns[overContainer].filter((t) => t.id !== activeId);
      const visualIdx = columns[overContainer].findIndex((t) => t.id === activeId);

      // Convert visual index to afterTaskId / beforeTaskId
      // (excluding the active task itself from the list)
      let afterTaskId: string | null = null;
      let beforeTaskId: string | null = null;

      if (visualIdx > 0) {
        afterTaskId = destCol[visualIdx - 1]?.id ?? null;
      }
      if (visualIdx < columns[overContainer].length - 1) {
        beforeTaskId = destCol[visualIdx]?.id ?? null;
      }

      // Skip if nothing changed
      if (
        task.status === overContainer &&
        afterTaskId === null &&
        beforeTaskId === null
      ) {
        return;
      }

      reorderTask(workspaceId, activeId, overContainer, afterTaskId, beforeTaskId);
    },
    [tasks, columns, workspaceId, reorderTask, findContainer],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
    setColumns(storeColumns);
  }, [storeColumns]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={clearError}
            className="text-sm font-medium text-red-700 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-4 overflow-x-auto p-1 pb-4">
          {COLUMNS.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={columns[status]}
              workspaceId={workspaceId}
              projectId={projectId}
              onTaskClick={(task) => setSelectedTask(task)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          workspaceId={workspaceId}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
};
