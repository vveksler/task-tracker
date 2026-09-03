/**
 * Workspace-scoped reads for AI proposal context (not for RAG ranking).
 * Every query filters by workspace_id inside SQL.
 */

import { getPool } from './db.js';

export type CatalogTask = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: string;
  assigneeName?: string | null;
  assigneeId?: string | null;
  assigneeEmail?: string | null;
};

export async function fetchWorkspaceProjects(
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string }>(
    `
    SELECT id, name
    FROM projects
    WHERE "workspaceId" = $1
    ORDER BY "createdAt" ASC
    `,
    [workspaceId],
  );
  return rows;
}

export async function fetchWorkspaceMembers(
  workspaceId: string,
): Promise<{ userId: string; name: string; email: string }[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    name: string;
    email: string;
  }>(
    `
    SELECT u.id, u.name, u.email
    FROM workspace_members wm
    JOIN users u ON u.id = wm."userId"
    WHERE wm."workspaceId" = $1
    ORDER BY u.name ASC
    `,
    [workspaceId],
  );
  return rows.map((r) => ({
    userId: r.id,
    name: r.name,
    email: r.email,
  }));
}

export async function fetchProjectTasks(
  workspaceId: string,
  projectId: string,
  limit = 100,
): Promise<CatalogTask[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    projectId: string;
    project_name: string;
    title: string;
    description: string | null;
    status: string;
    assigneeId: string | null;
    assignee_name: string | null;
  }>(
    `
    SELECT t.id, t."projectId", p.name AS project_name,
           t.title, t.description, t.status,
           t."assigneeId", u.name AS assignee_name
    FROM tasks t
    JOIN projects p ON p.id = t."projectId"
    LEFT JOIN users u ON u.id = t."assigneeId"
    WHERE p."workspaceId" = $1
      AND t."projectId" = $2
    ORDER BY t.status ASC, t."order" ASC
    LIMIT $3
    `,
    [workspaceId, projectId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.project_name,
    title: r.title,
    description: r.description ?? '',
    status: r.status,
    assigneeName: r.assignee_name,
  }));
}

export function statusCounts(
  tasks: { status: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };
  for (const t of tasks) {
    if (t.status in counts) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
  }
  return counts;
}

export async function searchTasksByKeywords(
  workspaceId: string,
  keywords: string[],
  limit = 50,
): Promise<CatalogTask[]> {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  const pool = getPool();
  const args: unknown[] = [workspaceId];
  const clauses: string[] = [];
  for (const kw of cleaned.slice(0, 5)) {
    args.push(`%${kw}%`);
    const idx = args.length;
    clauses.push(`(t.title ILIKE $${idx} OR t.description ILIKE $${idx})`);
  }
  args.push(limit);
  const limitIdx = args.length;
  const whereExtra = clauses.join(' OR ');

  const { rows } = await pool.query<{
    id: string;
    projectId: string;
    project_name: string;
    title: string;
    description: string | null;
    status: string;
    assigneeId: string | null;
    assignee_name: string | null;
    assignee_email: string | null;
  }>(
    `
    SELECT t.id, t."projectId", p.name AS project_name,
           t.title, t.description, t.status,
           t."assigneeId", u.name AS assignee_name, u.email AS assignee_email
    FROM tasks t
    JOIN projects p ON p.id = t."projectId"
    LEFT JOIN users u ON u.id = t."assigneeId"
    WHERE p."workspaceId" = $1
      AND (${whereExtra})
    ORDER BY t."updatedAt" DESC
    LIMIT $${limitIdx}
    `,
    args,
  );

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.project_name,
    title: r.title,
    description: r.description ?? '',
    status: r.status,
    assigneeId: r.assigneeId,
    assigneeName: r.assignee_name,
    assigneeEmail: r.assignee_email,
  }));
}

export function extractKeywords(question: string): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'to',
    'in',
    'on',
    'all',
    'tasks',
    'task',
    'project',
    'projects',
    'move',
    'set',
    'make',
    'please',
    'with',
    'from',
    'into',
    'that',
    'this',
    'are',
    'is',
    'of',
    'for',
    'user',
    'users',
    'duplicate',
    'duplicates',
    'delete',
    'remove',
    'keep',
    'only',
    'one',
    'leave',
    'find',
    'same',
    'name',
    'names',
    'progress',
    'completed',
    'done',
    'todo',
    'review',
    'status',
    'open',
    'go',
    'navigate',
  ]);
  const tokens: string[] = [];
  for (const raw of question
    .replace(/"/g, ' ')
    .replace(/'/g, ' ')
    .split(/\s+/)) {
    let t = raw.trim().toLowerCase();
    t = [...t].filter((ch) => /[a-z0-9_-]/i.test(ch)).join('');
    if (t.length < 3 || stop.has(t)) continue;
    if (!tokens.includes(t)) tokens.push(t);
  }
  return tokens.slice(0, 8);
}

/**
 * Projects named in the question that are not already the current board.
 * Used so listings/nav about "Auth" get a full live task snapshot, not only
 * RAG top-k snippets.
 */
export function findMentionedProjects(
  question: string,
  projects: { id: string; name: string }[],
  currentProjectId?: string | null,
): { id: string; name: string }[] {
  const q = question.toLowerCase();
  const matched: { id: string; name: string }[] = [];
  for (const p of projects) {
    if (currentProjectId && p.id === currentProjectId) continue;
    const name = p.name.toLowerCase();
    if (name.length >= 3 && q.includes(name)) {
      matched.push(p);
      continue;
    }
    const tokens = name.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    if (tokens.some((t) => q.includes(t))) {
      matched.push(p);
    }
  }
  return matched.slice(0, 2);
}

function appendProjectTaskBlock(
  lines: string[],
  label: string,
  project: { id: string; name: string },
  tasks: CatalogTask[],
): void {
  lines.push(`<${label} id="${project.id}" name="${project.name}" />`);
  const counts = statusCounts(tasks);
  lines.push(
    `${label}_task_counts: ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') +
      ` total=${tasks.length}`,
  );
  lines.push(`${label}_tasks:`);
  if (tasks.length > 0) {
    for (const t of tasks) {
      lines.push(
        `- id=${t.id} [${t.status}] ${t.title}: ${t.description} ` +
          `(assignee=${t.assigneeName || 'none'})`,
      );
    }
  } else {
    lines.push('- (none)');
  }
}

export async function buildWorkspaceCatalog(
  workspaceId: string,
  question: string,
  currentProjectId?: string | null,
): Promise<string> {
  const projects = await fetchWorkspaceProjects(workspaceId);
  const members = await fetchWorkspaceMembers(workspaceId);
  const keywords = extractKeywords(question);
  const keywordTasks = await searchTasksByKeywords(workspaceId, keywords);

  let currentProjectTasks: CatalogTask[] = [];
  if (currentProjectId) {
    currentProjectTasks = await fetchProjectTasks(
      workspaceId,
      currentProjectId,
    );
  }

  const mentioned = findMentionedProjects(question, projects, currentProjectId);
  const mentionedBlocks: {
    project: { id: string; name: string };
    tasks: CatalogTask[];
  }[] = [];
  for (const p of mentioned) {
    mentionedBlocks.push({
      project: p,
      tasks: await fetchProjectTasks(workspaceId, p.id),
    });
  }

  const lines = ['<workspace_catalog>'];

  if (currentProjectId) {
    const current = projects.find((p) => p.id === currentProjectId);
    appendProjectTaskBlock(
      lines,
      'current_project',
      current ?? { id: currentProjectId, name: '(unknown)' },
      currentProjectTasks,
    );
  }

  for (const block of mentionedBlocks) {
    appendProjectTaskBlock(
      lines,
      'mentioned_project',
      block.project,
      block.tasks,
    );
  }

  lines.push('projects:');
  if (projects.length > 0) {
    for (const p of projects) {
      lines.push(`- id=${p.id} name=${p.name}`);
    }
  } else {
    lines.push('- (none)');
  }

  lines.push('members:');
  if (members.length > 0) {
    for (const m of members) {
      lines.push(`- userId=${m.userId} name=${m.name} email=${m.email}`);
    }
  } else {
    lines.push('- (none)');
  }

  lines.push('keyword_matched_tasks:');
  if (keywordTasks.length > 0) {
    for (const t of keywordTasks) {
      lines.push(
        `- id=${t.id} projectId=${t.projectId} ` +
          `projectName=${t.projectName} [${t.status}] ` +
          `${t.title}: ${t.description} ` +
          `(assignee=${t.assigneeName || 'none'})`,
      );
    }
  } else {
    lines.push('- (none)');
  }
  lines.push('</workspace_catalog>');
  return lines.join('\n');
}
