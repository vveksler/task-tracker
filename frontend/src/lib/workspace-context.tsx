'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Workspace, WorkspaceRole } from '@/types/api';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface WorkspaceContextValue {
  workspace: Workspace | null;
  myRole: WorkspaceRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  refetch: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const useWorkspace = (): WorkspaceContextValue => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
};

interface WorkspaceProviderProps {
  workspaceId: string;
  /** Pre-fetched workspace data from a Server Component — skips the initial client fetch */
  initialData?: Workspace;
  children: ReactNode;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
  workspaceId,
  initialData,
  children,
}) => {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Skip first fetch if we have initial data from the server
    if (initialData && version === 0) return;

    let cancelled = false;
    setIsLoading(true);
    apiFetch<Workspace>(`/workspaces/${workspaceId}`)
      .then((data) => {
        if (!cancelled) setWorkspace(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo<WorkspaceContextValue>(() => {
    const myMember = workspace?.members?.find((m) => m.userId === user?.id);
    const myRole = myMember?.role ?? null;
    const isOwner = workspace?.ownerId === user?.id;
    const isAdmin = myRole === 'ADMIN';

    return { workspace, myRole, isOwner, isAdmin, isLoading, refetch };
  }, [workspace, user, isLoading, refetch]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};
