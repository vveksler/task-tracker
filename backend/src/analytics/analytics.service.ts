import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface StatusBreakdownRow {
  status: string;
  count: number;
}

export interface ActivityRow {
  date: string;
  created: number;
  updated: number;
}

export interface AssigneeLoadRow {
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  total: number;
  todo: number;
  inProgress: number;
  inReview: number;
  done: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Count of tasks grouped by status across all projects in the workspace.
   * Uses Prisma groupBy — no raw SQL needed.
   */
  async statusBreakdown(workspaceId: string): Promise<StatusBreakdownRow[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) return [];

    const groups = await this.prisma.task.groupBy({
      by: ['status'],
      where: { projectId: { in: projectIds } },
      _count: { id: true },
    });

    return groups.map((g) => ({
      status: g.status,
      count: g._count.id,
    }));
  }

  /**
   * Time-bucketed activity: tasks created and updated per day.
   *
   * Uses raw SQL with date_trunc for proper time bucketing —
   * Prisma doesn't support date grouping natively.
   *
   * HUNT FOR (Phase 6): this is the query to EXPLAIN ANALYZE.
   * Without an index on tasks.createdAt (filtered by projectId),
   * this does a sequential scan on 5000+ rows.
   */
  async activity(workspaceId: string, days: number): Promise<ActivityRow[]> {
    const rows = await this.prisma.$queryRaw<
      { date: Date; created: bigint; updated: bigint }[]
    >`
      SELECT
        d.date,
        COALESCE(c.cnt, 0) AS created,
        COALESCE(u.cnt, 0) AS updated
      FROM generate_series(
        date_trunc('day', NOW() - (${days} || ' days')::interval),
        date_trunc('day', NOW()),
        '1 day'::interval
      ) AS d(date)
      LEFT JOIN (
        SELECT date_trunc('day', t."createdAt") AS day, COUNT(*) AS cnt
        FROM tasks t
        JOIN projects p ON t."projectId" = p.id
        WHERE p."workspaceId" = ${workspaceId}
          AND t."createdAt" >= NOW() - (${days} || ' days')::interval
        GROUP BY day
      ) c ON c.day = d.date
      LEFT JOIN (
        SELECT date_trunc('day', t."updatedAt") AS day, COUNT(*) AS cnt
        FROM tasks t
        JOIN projects p ON t."projectId" = p.id
        WHERE p."workspaceId" = ${workspaceId}
          AND t."updatedAt" >= NOW() - (${days} || ' days')::interval
          AND t."updatedAt" != t."createdAt"
        GROUP BY day
      ) u ON u.day = d.date
      ORDER BY d.date
    `;

    return rows.map((r) => ({
      date: r.date.toISOString().split('T')[0]!,
      created: Number(r.created),
      updated: Number(r.updated),
    }));
  }

  /**
   * Task count per assignee, broken down by status.
   * Unassigned tasks are grouped under assigneeId = null.
   */
  async assigneeLoad(workspaceId: string): Promise<AssigneeLoadRow[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) return [];

    const rows = await this.prisma.$queryRaw<
      {
        assigneeId: string | null;
        assigneeName: string | null;
        assigneeEmail: string | null;
        total: bigint;
        todo: bigint;
        in_progress: bigint;
        in_review: bigint;
        done: bigint;
      }[]
    >`
      SELECT
        t."assigneeId",
        u."name"  AS "assigneeName",
        u."email" AS "assigneeEmail",
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE t.status = 'TODO')         AS todo,
        COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')  AS in_progress,
        COUNT(*) FILTER (WHERE t.status = 'IN_REVIEW')    AS in_review,
        COUNT(*) FILTER (WHERE t.status = 'DONE')         AS done
      FROM tasks t
      LEFT JOIN users u ON t."assigneeId" = u.id
      WHERE t."projectId" = ANY(${projectIds})
      GROUP BY t."assigneeId", u."name", u."email"
      ORDER BY total DESC
    `;

    return rows.map((r) => ({
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      assigneeEmail: r.assigneeEmail,
      total: Number(r.total),
      todo: Number(r.todo),
      inProgress: Number(r.in_progress),
      inReview: Number(r.in_review),
      done: Number(r.done),
    }));
  }
}
