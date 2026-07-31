'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task, TaskStatus, WorkspaceMember } from '@/types/api';
import { apiFetch } from '@/lib/api-client';
import { useBoardStore } from '@/stores/board-store';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'DONE', label: 'Done' },
];

interface TaskModalProps {
  task: Task;
  workspaceId: string;
  onClose: () => void;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  task,
  workspaceId,
  onClose,
}) => {
  const { isAdmin, workspace } = useWorkspace();
  const updateTask = useBoardStore((s) => s.updateTask);
  const removeTask = useBoardStore((s) => s.removeTask);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string | null>(
    task.assigneeId,
  );
  const [isSaving, setIsSaving] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const members: WorkspaceMember[] = useMemo(
    () => workspace?.members ?? [],
    [workspace],
  );

  const hasChanges =
    title !== task.title ||
    description !== (task.description ?? '') ||
    status !== task.status ||
    assigneeId !== task.assigneeId;

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.classList.add('scroll-locked');
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.classList.remove('scroll-locked');
    };
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      const updated = await apiFetch<Task>(
        `/workspaces/${workspaceId}/tasks/${task.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            status,
            assigneeId: assigneeId || null,
          }),
        },
      );
      updateTask(updated);
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, task.id, title, description, status, assigneeId, updateTask, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this task?')) return;
    await apiFetch(`/workspaces/${workspaceId}/tasks/${task.id}`, {
      method: 'DELETE',
    });
    removeTask(task.id);
    onClose();
  }, [workspaceId, task.id, removeTask, onClose]);

  const inputClass =
    'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="task-modal-backdrop"
    >
      <div className="task-modal-panel" role="dialog" aria-modal="true" aria-label="Task details">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Task details</h2>
          <button
            onClick={onClose}
            aria-label="Close task details"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="Add a description..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Assignee
            </label>
            <select
              value={assigneeId ?? ''}
              onChange={(e) => setAssigneeId(e.target.value || null)}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name} ({m.user.email})
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-gray-400">
            Created {new Date(task.createdAt).toLocaleString()}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isAdmin ? (
            <Button variant="danger" size="sm" onClick={handleDelete}>
              Delete task
            </Button>
          ) : (
            <span className="hidden sm:inline" />
          )}

          <div className="flex gap-2 sm:justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              isLoading={isSaving}
              disabled={!hasChanges || !title.trim()}
              className="flex-1 sm:flex-none"
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
