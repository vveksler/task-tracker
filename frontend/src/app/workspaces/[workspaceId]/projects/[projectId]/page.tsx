'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { useOptionalAssistant } from '@/lib/assistant-context';
import { KanbanBoard } from '@/components/board/kanban-board';
import type { Project } from '@/types/api';

const BoardPage = () => {
  const { workspaceId, projectId } = useParams<{
    workspaceId: string;
    projectId: string;
  }>();

  const [project, setProject] = useState<Project | null>(null);
  const assistant = useOptionalAssistant();
  const setBoardScope = assistant?.setBoardScope;

  // Keep the slide-over assistant scoped to this board (layout-mounted chat
  // may not see child route params reliably).
  useEffect(() => {
    if (!setBoardScope) return;
    setBoardScope({
      projectId,
      projectName: project?.name ?? null,
    });
    return () => {
      setBoardScope(null);
    };
  }, [setBoardScope, projectId, project?.name]);

  // Title fetch runs in parallel with the board — do not block Kanban mount.
  useEffect(() => {
    let cancelled = false;

    apiFetch<Project>(`/workspaces/${workspaceId}/projects/${projectId}`)
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch(() => {
        // Board still works; title stays empty on failure.
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, projectId]);

  return (
    <div className="board-page">
      <div className="board-page-header">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Projects
        </Link>
        <h1 className="mt-2 break-words text-xl font-bold text-gray-900 sm:text-2xl">
          {project?.name ?? (
            <span className="inline-block h-7 w-40 animate-pulse rounded bg-gray-200 align-middle" />
          )}
        </h1>
      </div>

      <KanbanBoard workspaceId={workspaceId} projectId={projectId} />
    </div>
  );
};

export default BoardPage;
