'use client';

import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import type { ActivityDay } from '@/types/api';

interface ActivityHeatmapProps {
  data: ActivityDay[];
}

/**
 * Hand-rolled D3 activity heatmap — GitHub-contributions style.
 *
 * Renders a grid of day cells colored by the sum of created + updated
 * tasks. Weeks run left-to-right, days-of-week run top-to-bottom.
 */
export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const dayMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data) {
      map.set(d.date, d.created + d.updated);
    }
    return map;
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const cellSize = 14;
    const cellGap = 3;
    const step = cellSize + cellGap;
    const marginTop = 20;
    const marginLeft = 30;

    const dates = data.map((d) => new Date(d.date + 'T00:00:00Z'));
    const minDate = d3.min(dates)!;
    const maxDate = d3.max(dates)!;

    const allDays: Date[] = [];
    const d = new Date(minDate);
    while (d <= maxDate) {
      allDays.push(new Date(d));
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const maxCount = d3.max(data, (d) => d.created + d.updated) ?? 1;

    const colorScale = d3
      .scaleSequential(d3.interpolateGreens)
      .domain([0, maxCount]);

    const weekOfDate = (date: Date) => {
      const startWeek = d3.utcWeek.count(d3.utcYear(minDate), minDate);
      const dateWeek = d3.utcWeek.count(d3.utcYear(date), date);
      const yearDiff = date.getUTCFullYear() - minDate.getUTCFullYear();
      return dateWeek - startWeek + yearDiff * 52;
    };

    const numWeeks = weekOfDate(maxDate) + 1;

    const width = marginLeft + numWeeks * step + 10;
    const height = marginTop + 7 * step + 10;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Day labels
    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    svg
      .selectAll('.day-label')
      .data(dayLabels)
      .join('text')
      .attr('class', 'day-label')
      .attr('x', marginLeft - 5)
      .attr('y', (_, i) => marginTop + i * step + cellSize / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 10)
      .attr('fill', '#9ca3af')
      .text((d) => d);

    // Month labels
    const months = d3.utcMonths(minDate, maxDate);
    svg
      .selectAll('.month-label')
      .data(months)
      .join('text')
      .attr('class', 'month-label')
      .attr('x', (d) => marginLeft + weekOfDate(d) * step)
      .attr('y', marginTop - 6)
      .attr('font-size', 10)
      .attr('fill', '#6b7280')
      .text((d) =>
        d.toLocaleDateString('en-US', { month: 'short' }),
      );

    // Cells
    const tooltip = d3
      .select('body')
      .selectAll<HTMLDivElement, unknown>('.heatmap-tooltip')
      .data([null])
      .join('div')
      .attr('class', 'heatmap-tooltip')
      .style('position', 'fixed')
      .style('pointer-events', 'none')
      .style('background', '#1f2937')
      .style('color', '#fff')
      .style('padding', '4px 8px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('opacity', 0)
      .style('z-index', '9999');

    svg
      .selectAll('.cell')
      .data(allDays)
      .join('rect')
      .attr('class', 'cell')
      .attr('x', (d) => marginLeft + weekOfDate(d) * step)
      .attr('y', (d) => marginTop + d.getUTCDay() * step)
      .attr('width', cellSize)
      .attr('height', cellSize)
      .attr('rx', 2)
      .attr('fill', (d) => {
        const key = d.toISOString().split('T')[0]!;
        const count = dayMap.get(key) ?? 0;
        return count === 0 ? '#f3f4f6' : colorScale(count);
      })
      .on('mouseenter', (event, d) => {
        const key = d.toISOString().split('T')[0]!;
        const count = dayMap.get(key) ?? 0;
        tooltip
          .style('opacity', 1)
          .html(`<strong>${key}</strong>: ${count} task${count !== 1 ? 's' : ''}`);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('left', event.clientX + 12 + 'px')
          .style('top', event.clientY - 10 + 'px');
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
      });

    return () => {
      tooltip.remove();
    };
  }, [data, dayMap]);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No activity data</p>;
  }

  return (
    <div className="overflow-x-auto">
      <svg ref={svgRef} />
    </div>
  );
};
