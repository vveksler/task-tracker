'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ActivityDay } from '@/types/api';

interface ActivityLineChartProps {
  data: ActivityDay[];
}

export const ActivityLineChart: React.FC<ActivityLineChartProps> = ({ data }) => {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No activity</p>;
  }

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12 }}
          interval="preserveStartEnd"
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="created"
          name="Created"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="updated"
          name="Updated"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
