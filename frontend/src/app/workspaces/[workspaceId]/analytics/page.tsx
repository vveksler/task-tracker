import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';
import type { StatusBreakdown, ActivityDay, AssigneeLoad } from '@/types/api';

interface AnalyticsPageProps {
  params: Promise<{ workspaceId: string }>;
}

/**
 * Analytics page — Server Component.
 *
 * All three datasets are fetched in parallel on the server.
 * React cache() inside serverFetch deduplicates the token refresh.
 */
const AnalyticsPage = async ({ params }: AnalyticsPageProps) => {
  const { workspaceId } = await params;

  const [statusData, activityData, assigneeData] = await Promise.all([
    serverFetch<StatusBreakdown[]>(
      `/workspaces/${workspaceId}/analytics/status-breakdown`,
    ),
    serverFetch<ActivityDay[]>(
      `/workspaces/${workspaceId}/analytics/activity?days=90`,
    ),
    serverFetch<AssigneeLoad[]>(
      `/workspaces/${workspaceId}/analytics/assignee-load`,
    ),
  ]);

  if (!statusData || !activityData || !assigneeData) {
    redirect('/auth/login');
  }

  return (
    <AnalyticsDashboard
      workspaceId={workspaceId}
      statusData={statusData}
      activityData={activityData}
      assigneeData={assigneeData}
    />
  );
};

export default AnalyticsPage;
