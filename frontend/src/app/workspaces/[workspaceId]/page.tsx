import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { WorkspaceDetailContent } from '@/components/workspaces/workspace-detail-content';
import type { Project } from '@/types/api';

interface WorkspaceDetailPageProps {
  params: Promise<{ workspaceId: string }>;
}

const WorkspaceDetailPage = async ({ params }: WorkspaceDetailPageProps) => {
  const { workspaceId } = await params;
  const projects = await serverFetch<Project[]>(
    `/workspaces/${workspaceId}/projects`,
  );

  if (projects === null) redirect('/auth/login');

  return (
    <WorkspaceDetailContent
      workspaceId={workspaceId}
      initialProjects={projects}
    />
  );
};

export default WorkspaceDetailPage;
