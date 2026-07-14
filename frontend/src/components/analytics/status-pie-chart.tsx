'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { StatusBreakdown } from '@/types/api';

const STATUS_COLORS: Record<string, string> = {
  TODO: '#9ca3af',
  IN_PROGRESS: '#3b82f6',
  IN_REVIEW: '#eab308',
  DONE: '#22c55e',
};

const STATUS_LABELS: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
};

interface StatusPieChartProps {
  data: StatusBreakdown[];
}

export const StatusPieChart: React.FC<StatusPieChartProps> = ({ data }) => {
  const chartData = data.map((d) => ({
    name: STATUS_LABELS[d.status] ?? d.status,
    value: d.count,
    status: d.status,
  }));

  if (chartData.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No tasks yet</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label={({ name, percent }) =>
            `${name} ${(percent * 100).toFixed(0)}%`
          }
        >
          {chartData.map((entry) => (
            <Cell
              key={entry.status}
              fill={STATUS_COLORS[entry.status] ?? '#6b7280'}
            />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};
