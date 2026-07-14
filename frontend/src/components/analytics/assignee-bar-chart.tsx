'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { AssigneeLoad } from '@/types/api';

interface AssigneeBarChartProps {
  data: AssigneeLoad[];
}

export const AssigneeBarChart: React.FC<AssigneeBarChartProps> = ({ data }) => {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No data</p>;
  }

  const chartData = data.map((d) => ({
    name: d.assigneeName ?? 'Unassigned',
    'To Do': d.todo,
    'In Progress': d.inProgress,
    'In Review': d.inReview,
    Done: d.done,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fontSize: 12 }}
        />
        <Tooltip />
        <Legend />
        <Bar dataKey="To Do" stackId="a" fill="#9ca3af" />
        <Bar dataKey="In Progress" stackId="a" fill="#3b82f6" />
        <Bar dataKey="In Review" stackId="a" fill="#eab308" />
        <Bar dataKey="Done" stackId="a" fill="#22c55e" />
      </BarChart>
    </ResponsiveContainer>
  );
};
