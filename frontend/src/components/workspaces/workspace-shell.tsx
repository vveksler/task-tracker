'use client';

import { WorkspaceProvider } from '@/lib/workspace-context';
import { AssistantProvider } from '@/lib/assistant-context';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import type { Workspace } from '@/types/api';

interface WorkspaceShellProps {
  workspaceId: string;
  workspace: Workspace;
  children: React.ReactNode;
}

/**
 * Thin client wrapper that hydrates WorkspaceProvider with server-fetched data.
 * Also mounts the global AI Assistant slide-over when the workspace is entitled.
 */
export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  workspaceId,
  workspace,
  children,
}) => (
  <WorkspaceProvider workspaceId={workspaceId} initialData={workspace}>
    <AssistantProvider>
      {children}
      {workspace.aiAssistantEnabled && (
        <AssistantPanel workspaceId={workspaceId} />
      )}
    </AssistantProvider>
  </WorkspaceProvider>
);
