import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { AssistantChat } from '@/components/assistant/assistant-chat';
import type { Workspace } from '@/types/api';

interface AssistantPageProps {
  params: Promise<{ workspaceId: string }>;
}

/**
 * Full-page AI Assistant fallback (bookmarks / direct URL).
 * Primary entry is the global FAB + slide-over in WorkspaceShell.
 */
const AssistantPage = async ({ params }: AssistantPageProps) => {
  const { workspaceId } = await params;
  const workspace = await serverFetch<Workspace>(
    `/workspaces/${workspaceId}`,
  );

  if (!workspace) redirect('/auth/login');

  if (!workspace.aiAssistantEnabled) {
    return (
      <div className="space-y-4">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Workspace
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">AI Assistant</h1>
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
          AI assistant is not enabled for this workspace. An operator must
          approve access before paid LLM calls are allowed.
        </p>
      </div>
    );
  }

  return <AssistantChat workspaceId={workspaceId} variant="page" />;
};

export default AssistantPage;
