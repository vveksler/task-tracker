'use client';

import { useParams } from 'next/navigation';
import { WorkspaceProvider } from '@/lib/workspace-context';

interface WorkspaceLayoutProps {
  children: React.ReactNode;
}

const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({ children }) => {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return (
    <WorkspaceProvider workspaceId={workspaceId}>
      {children}
    </WorkspaceProvider>
  );
};

export default WorkspaceLayout;
