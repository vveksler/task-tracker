import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { CreateWorkspaceForm } from '@/components/workspaces/create-workspace-form';
import type { Workspace } from '@/types/api';

const WorkspacesPage = async () => {
  const workspaces = await serverFetch<Workspace[]>('/workspaces');

  if (workspaces === null) redirect('/auth/login');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
        <CreateWorkspaceForm />
      </div>

      {workspaces.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No workspaces yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/workspaces/${ws.id}`}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <h2 className="text-lg font-semibold text-gray-900">{ws.name}</h2>
              <p className="mt-1 text-sm text-gray-500">
                Created {new Date(ws.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkspacesPage;
