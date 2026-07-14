'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { KanbanBoard } from '@/components/board/kanban-board';
import type { Project } from '@/types/api';

const BoardPage = () => {
  const { workspaceId, projectId } = useParams<{
    workspaceId: string;
    projectId: string;
  }>();

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    apiFetch<Project>(
      `/workspaces/${workspaceId}/projects/${projectId}`,
    )
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [workspaceId, projectId]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          {project?.name ?? ''}
        </h1>
      </div>

      <KanbanBoard workspaceId={workspaceId} projectId={projectId} />
    </div>
  );
};

export default BoardPage;
