'use client';

import { useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, TaskStatus, WorkspaceMember } from '@/types/api';
import { useWorkspace } from '@/lib/workspace-context';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'DONE', label: 'Done' },
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function TaskCardBody({ task }: { task: Task }) {
  const { workspace } = useWorkspace();

  const assignee: WorkspaceMember | undefined = useMemo(
    () =>
      task.assigneeId
        ? workspace?.members?.find((m) => m.userId === task.assigneeId)
        : undefined,
    [task.assigneeId, workspace?.members],
  );

  return (
    <>
      <p className="text-sm font-medium text-gray-900">{task.title}</p>
      {task.description && (
        <p className="mt-1 text-xs text-gray-500 line-clamp-2">
          {task.description}
        </p>
      )}
      {assignee && (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white ${colorForUser(assignee.userId)}`}
            title={assignee.user.name}
          >
            {getInitials(assignee.user.name)}
          </span>
          <span className="text-xs text-gray-400">{assignee.user.name}</span>
        </div>
      )}
    </>
  );
}

/**
 * DragOverlay clone — Trello-like “picked up” card: slight lift + tilt.
 * Must not call useSortable.
 */
export const TaskCardOverlay: React.FC<{ task: Task }> = ({ task }) => (
  <div className="task-card-overlay rounded-lg border border-gray-200 bg-white p-3">
    <TaskCardBody task={task} />
  </div>
);

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onClick,
  onStatusChange,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        task-card rounded-lg border border-gray-200 bg-white p-3 shadow-sm
        cursor-grab touch-manipulation active:cursor-grabbing
        ${isDragging ? 'opacity-30' : 'hover:shadow-md'}
      `}
      {...attributes}
      {...listeners}
      onClick={() => {
        // Tap opens the modal; TouchSensor delay means a short press won't drag.
        if (!isDragging) onClick?.();
      }}
    >
      <TaskCardBody task={task} />

      {onStatusChange && (
        <label className="mt-2 flex items-center gap-2 sm:hidden">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Move
          </span>
          <select
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={task.status}
            aria-label="Move task to column"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              onStatusChange(task.id, e.target.value as TaskStatus);
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
};
