'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const CreateWorkspaceForm: React.FC = () => {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim()) return;
      setIsCreating(true);

      try {
        await apiFetch('/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name: newName.trim() }),
        });
        setNewName('');
        setShowCreate(false);
        router.refresh();
      } finally {
        setIsCreating(false);
      }
    },
    [newName, router],
  );

  if (!showCreate) {
    return <Button onClick={() => setShowCreate(true)}>New workspace</Button>;
  }

  return (
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
  );
};
