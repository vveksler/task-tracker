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
  children: ReactNode;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
  workspaceId,
  children,
}) => {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
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
