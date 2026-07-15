'use client';

import { useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task, WorkspaceMember } from '@/types/api';
import { useWorkspace } from '@/lib/workspace-context';

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

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onClick }) => {
  const { workspace } = useWorkspace();

  const assignee: WorkspaceMember | undefined = useMemo(
    () =>
      task.assigneeId
        ? workspace?.members?.find((m) => m.userId === task.assigneeId)
        : undefined,
    [task.assigneeId, workspace?.members],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        rounded-lg border border-gray-200 bg-white p-3 shadow-sm
        cursor-grab active:cursor-grabbing
        ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-brand-500' : 'hover:shadow-md'}
      `}
      {...attributes}
      {...listeners}
      onPointerUp={(e) => {
        if (!isDragging && onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
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
    </div>
  );
};
