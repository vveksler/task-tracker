'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '@/types/api';

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onClick }) => {
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
        // Distinguish click from drag: only fire onClick if pointer
        // didn't move (dnd-kit uses distance threshold of 5px)
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
    </div>
  );
};
