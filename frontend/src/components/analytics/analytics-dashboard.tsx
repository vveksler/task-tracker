'use client';

import Link from 'next/link';
import { useWorkspace } from '@/lib/workspace-context';
import { StatusPieChart } from './status-pie-chart';
import { ActivityLineChart } from './activity-line-chart';
import { AssigneeBarChart } from './assignee-bar-chart';
import { ActivityHeatmap } from './activity-heatmap';
import type { StatusBreakdown, ActivityDay, AssigneeLoad } from '@/types/api';

interface AnalyticsDashboardProps {
  workspaceId: string;
  statusData: StatusBreakdown[];
  activityData: ActivityDay[];
  assigneeData: AssigneeLoad[];
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  workspaceId,
  statusData,
  activityData,
  assigneeData,
}) => {
  const { workspace } = useWorkspace();
  const totalTasks = statusData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/workspaces/${workspaceId}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; {workspace?.name ?? 'Workspace'}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500">
          {totalTasks} total tasks across all projects
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">
            Status Breakdown
          </h2>
          <StatusPieChart data={statusData} />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">
            Daily Activity (90 days)
          </h2>
          <ActivityLineChart data={activityData} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">
          Activity Heatmap
        </h2>
        <ActivityHeatmap data={activityData} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">
          Load by Assignee
        </h2>
        <AssigneeBarChart data={assigneeData} />
      </div>
    </div>
  );
};
