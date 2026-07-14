'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Workspace } from '@/types/api';

const WorkspacesPage = () => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await apiFetch<Workspace[]>('/workspaces');
      setWorkspaces(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim()) return;
      setIsCreating(true);

      try {
        const workspace = await apiFetch<Workspace>('/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name: newName.trim() }),
        });
        setWorkspaces((prev) => [...prev, workspace]);
        setNewName('');
        setShowCreate(false);
      } finally {
        setIsCreating(false);
      }
    },
    [newName],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
        <Button onClick={() => setShowCreate(true)}>New workspace</Button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="flex items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="flex-1">
            <Input
              label="Workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. My Team"
              required
              autoFocus
            />
          </div>
          <Button type="submit" isLoading={isCreating}>
            Create
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowCreate(false)}
          >
            Cancel
          </Button>
        </form>
      )}

      {workspaces.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No workspaces yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/workspaces/${ws.id}`}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <h2 className="text-lg font-semibold text-gray-900">{ws.name}</h2>
              <p className="mt-1 text-sm text-gray-500">
                Created {new Date(ws.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkspacesPage;
