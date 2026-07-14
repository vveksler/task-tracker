'use client';

import { useCallback, useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { Task, TaskStatus } from '@/types/api';
import { TaskCard } from './task-card';
import { useBoardStore } from '@/stores/board-store';

const COLUMN_META: Record<TaskStatus, { label: string; color: string }> = {
  TODO: { label: 'To Do', color: 'bg-gray-400' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-500' },
  IN_REVIEW: { label: 'In Review', color: 'bg-yellow-500' },
  DONE: { label: 'Done', color: 'bg-green-500' },
};

interface BoardColumnProps {
  status: TaskStatus;
  tasks: Task[];
  workspaceId: string;
  projectId: string;
  onTaskClick?: (task: Task) => void;
}

export const BoardColumn: React.FC<BoardColumnProps> = ({
  status,
  tasks,
  workspaceId,
  projectId,
  onTaskClick,
}) => {
  const { label, color } = COLUMN_META[status];
  const createTask = useBoardStore((s) => s.createTask);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newTitle.trim()) return;
      await createTask(workspaceId, projectId, newTitle.trim(), status);
      setNewTitle('');
      setShowAdd(false);
    },
    [workspaceId, projectId, status, newTitle, createTask],
  );

  // Tasks arrive pre-sorted from the parent (by order during load,
  // by visual position during drag)
  const sortedTasks = tasks;

  return (
    <div
      ref={setNodeRef}
      className={`
        flex w-72 flex-shrink-0 flex-col rounded-xl bg-gray-100 transition-colors
        ${isOver ? 'ring-2 ring-brand-500 ring-opacity-50' : ''}
      `}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
        <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3 pt-1">
        <div className="flex-1 space-y-2">
          <SortableContext
            items={sortedTasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {sortedTasks.length === 0 && !showAdd && (
              <p className="py-8 text-center text-xs text-gray-400">No tasks yet</p>
            )}
            {sortedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick?.(task)}
              />
            ))}
          </SortableContext>
        </div>

        {status === 'TODO' && (
          <div className="mt-2">
            {showAdd ? (
              <form onSubmit={handleAdd} className="space-y-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Task title..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  autoFocus
                  onBlur={() => {
                    if (!newTitle.trim()) setShowAdd(false);
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdd(false);
                      setNewTitle('');
                    }}
                    className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                className="w-full rounded-lg py-2 text-sm text-gray-500 hover:bg-gray-200"
              >
                + Add task
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
