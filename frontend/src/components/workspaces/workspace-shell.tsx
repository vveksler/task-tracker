'use client';

import { WorkspaceProvider } from '@/lib/workspace-context';
import type { Workspace } from '@/types/api';

interface WorkspaceShellProps {
  workspaceId: string;
  workspace: Workspace;
  children: React.ReactNode;
}

/**
 * Thin client wrapper that hydrates WorkspaceProvider with server-fetched data.
 * Context providers must be Client Components, but the layout that fetches
 * data is a Server Component — this bridges the two.
 */
export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  workspaceId,
  workspace,
  children,
}) => (
  <WorkspaceProvider workspaceId={workspaceId} initialData={workspace}>
    {children}
  </WorkspaceProvider>
);
