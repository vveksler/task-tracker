'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MembersPanel } from '@/components/workspaces/members-panel';
import type { Project } from '@/types/api';

interface WorkspaceDetailContentProps {
  workspaceId: string;
  initialProjects: Project[];
}

export const WorkspaceDetailContent: React.FC<WorkspaceDetailContentProps> = ({
  workspaceId,
  initialProjects,
}) => {
  const router = useRouter();
  const { workspace, isOwner, isAdmin, isLoading: wsLoading, refetch } = useWorkspace();

  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState('');

  const handleCreateProject = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim()) return;
      setIsCreating(true);
      try {
        const project = await apiFetch<Project>(
          `/workspaces/${workspaceId}/projects`,
          { method: 'POST', body: JSON.stringify({ name: newName.trim() }) },
        );
        setProjects((prev) => [...prev, project]);
        setNewName('');
        setShowCreate(false);
      } finally {
        setIsCreating(false);
      }
    },
    [workspaceId, newName],
  );

  const handleSaveWorkspaceName = useCallback(async () => {
    if (!editName.trim() || editName.trim() === workspace?.name) {
      setIsEditingName(false);
      return;
    }
    await apiFetch(`/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editName.trim() }),
    });
    refetch();
    setIsEditingName(false);
  }, [workspaceId, editName, workspace?.name, refetch]);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!confirm('Delete this workspace? This cannot be undone.')) return;
    await apiFetch(`/workspaces/${workspaceId}`, { method: 'DELETE' });
    router.push('/workspaces');
  }, [workspaceId, router]);

  const handleSaveProjectName = useCallback(
    async (projectId: string) => {
      if (!editProjectName.trim()) {
        setEditingProjectId(null);
        return;
      }
      const updated = await apiFetch<Project>(
        `/workspaces/${workspaceId}/projects/${projectId}`,
        { method: 'PATCH', body: JSON.stringify({ name: editProjectName.trim() }) },
      );
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
      setEditingProjectId(null);
    },
    [workspaceId, editProjectName],
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      if (!confirm('Delete this project and all its tasks?')) return;
      await apiFetch(`/workspaces/${workspaceId}/projects/${projectId}`, {
        method: 'DELETE',
      });
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    },
    [workspaceId],
  );

  if (wsLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/workspaces" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Workspaces
        </Link>

        <div className="mt-2 flex items-center gap-3">
          {isEditingName ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleSaveWorkspaceName(); }}
              className="flex items-center gap-2"
            >
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-2xl font-bold focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
                onBlur={handleSaveWorkspaceName}
              />
            </form>
          ) : (
            <h1 className="text-2xl font-bold text-gray-900">
              {workspace?.name ?? 'Workspace'}
            </h1>
          )}

          {isAdmin && !isEditingName && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditName(workspace?.name ?? '');
                  setIsEditingName(true);
                }}
              >
                Edit
              </Button>
              {isOwner && (
                <Button variant="ghost" size="sm" onClick={handleDeleteWorkspace}>
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Link
          href={`/workspaces/${workspaceId}/analytics`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        >
          📊 Analytics
        </Link>
      </div>

      <MembersPanel workspaceId={workspaceId} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Projects</h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          New project
        </Button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreateProject}
          className="flex items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="flex-1">
            <Input
              label="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sprint 1"
              required
              autoFocus
            />
          </div>
          <Button type="submit" isLoading={isCreating}>Create</Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
            Cancel
          </Button>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group relative rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              {editingProjectId === project.id ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSaveProjectName(project.id); }}
                >
                  <input
                    value={editProjectName}
                    onChange={(e) => setEditProjectName(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-lg font-semibold focus:border-brand-500 focus:outline-none"
                    autoFocus
                    onBlur={() => handleSaveProjectName(project.id)}
                  />
                </form>
              ) : (
                <Link href={`/workspaces/${workspaceId}/projects/${project.id}`}>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="mt-1 text-sm text-gray-500">{project.description}</p>
                  )}
                </Link>
              )}

              {isAdmin && editingProjectId !== project.id && (
                <div className="absolute right-3 top-3 hidden gap-1 group-hover:flex">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setEditProjectName(project.name);
                      setEditingProjectId(project.id);
                    }}
                    className="rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleDeleteProject(project.id);
                    }}
                    className="rounded p-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
