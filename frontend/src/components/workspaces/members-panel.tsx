'use client';

import { useCallback, useState } from 'react';
import type { WorkspaceMember, WorkspaceRole } from '@/types/api';
import { apiFetch } from '@/lib/api-client';
import { useWorkspace } from '@/lib/workspace-context';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface MembersPanelProps {
  workspaceId: string;
}

export const MembersPanel: React.FC<MembersPanelProps> = ({ workspaceId }) => {
  const { workspace, isAdmin, refetch } = useWorkspace();
  const { user } = useAuth();

  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('MEMBER');
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = workspace?.members ?? [];

  const handleInvite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;
      setIsInviting(true);
      setError(null);
      try {
        await apiFetch(`/workspaces/${workspaceId}/members`, {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), role }),
        });
        setEmail('');
        setShowInvite(false);
        refetch();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to add member',
        );
      } finally {
        setIsInviting(false);
      }
    },
    [workspaceId, email, role, refetch],
  );

  const handleRemove = useCallback(
    async (member: WorkspaceMember) => {
      if (
        !confirm(
          `Remove ${member.user.name} from this workspace?`,
        )
      )
        return;
      try {
        await apiFetch(
          `/workspaces/${workspaceId}/members/${member.userId}`,
          { method: 'DELETE' },
        );
        refetch();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to remove member');
      }
    },
    [workspaceId, refetch],
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          Members ({members.length})
        </h2>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowInvite((v) => !v)}>
            {showInvite ? 'Cancel' : 'Add member'}
          </Button>
        )}
      </div>

      {showInvite && (
        <form onSubmit={handleInvite} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              autoFocus
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <Button type="submit" size="sm" isLoading={isInviting}>
            Add
          </Button>
        </form>
      )}

      <ul className="mt-4 divide-y divide-gray-100">
        {members.map((member) => {
          const isOwner = member.userId === workspace?.ownerId;
          const isSelf = member.userId === user?.id;
          const canRemove = isAdmin && !isSelf && !isOwner;

          return (
            <li
              key={member.userId}
              className="flex items-center justify-between py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-white ${colorForUser(member.userId)}`}
                >
                  {getInitials(member.user.name)}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {member.user.name}
                    {isSelf && (
                      <span className="ml-1 text-xs text-gray-400">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{member.user.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    isOwner
                      ? 'bg-amber-100 text-amber-700'
                      : member.role === 'ADMIN'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {isOwner ? 'Owner' : member.role}
                </span>

                {canRemove && (
                  <button
                    onClick={() => handleRemove(member)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    title="Remove member"
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
