'use client';

import type { ReactNode } from 'react';
import { WorkspaceProvider } from '@/lib/workspace-context';
import { AssistantProvider } from '@/lib/assistant-context';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import type { Workspace } from '@/types/api';

interface WorkspaceShellProps {
  workspaceId: string;
  workspace: Workspace;
  children: ReactNode;
}

/**
 * Thin client wrapper that hydrates WorkspaceProvider with server-fetched data.
 * Also mounts the global AI Assistant slide-over when the workspace is entitled.
 */
export function WorkspaceShell({
  workspaceId,
  workspace,
  children,
}: WorkspaceShellProps) {
  return (
    <WorkspaceProvider workspaceId={workspaceId} initialData={workspace}>
      <AssistantProvider>
        {children}
        {workspace.aiAssistantEnabled && (
          <AssistantPanel workspaceId={workspaceId} />
        )}
      </AssistantProvider>
    </WorkspaceProvider>
  );
}
