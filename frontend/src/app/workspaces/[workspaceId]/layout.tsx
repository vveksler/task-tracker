import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { WorkspaceShell } from '@/components/workspaces/workspace-shell';
import type { Workspace } from '@/types/api';

interface WorkspaceLayoutProps {
  params: Promise<{ workspaceId: string }>;
  children: React.ReactNode;
}

const WorkspaceLayout = async ({ params, children }: WorkspaceLayoutProps) => {
  const { workspaceId } = await params;
  const workspace = await serverFetch<Workspace>(
    `/workspaces/${workspaceId}`,
  );

  if (!workspace) redirect('/auth/login');

  return (
    <WorkspaceShell workspaceId={workspaceId} workspace={workspace}>
      {children}
    </WorkspaceShell>
  );
};

export default WorkspaceLayout;
