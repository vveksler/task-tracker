import { ALLOWED_STATUSES } from './prompts.js';

export type Proposal = Record<string, unknown>;

function sanitizeTaskFilter(filt: unknown): Record<string, unknown> | null {
  if (typeof filt !== 'object' || filt === null || Array.isArray(filt)) {
    return null;
  }
  const src = filt as Record<string, unknown>;
  const safeFilter: Record<string, unknown> = {};
  for (const key of [
    'titleContains',
    'descriptionContains',
    'assigneeNameContains',
    'projectName',
  ] as const) {
    const val = src[key];
    if (typeof val === 'string' && val.trim()) {
      safeFilter[key] = val.trim();
    }
  }
  const projectId = src['projectId'];
  if (typeof projectId === 'string' && projectId.trim()) {
    safeFilter['projectId'] = projectId.trim();
  }
  const statusIn = src['statusIn'];
  if (Array.isArray(statusIn)) {
    const statuses = statusIn.filter(
      (s): s is string => typeof s === 'string' && ALLOWED_STATUSES.has(s),
    );
    if (statuses.length > 0) {
      safeFilter['statusIn'] = statuses;
    }
  }
  if (Object.keys(safeFilter).length === 0) return null;
  return safeFilter;
}

/** Keep only allowlisted, well-shaped proposals (max 5). */
export const MAX_PROPOSALS = 5;

export function sanitizeProposals(raw: unknown): Proposal[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [];
  }
  const proposals = (raw as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return [];

  // Oversized create bursts: refuse entirely (do not silently keep first 5).
  let createBurst = 0;
  for (const item of proposals) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const t = (item as { type?: unknown }).type;
    if (t === 'create_task' || t === 'create_project') {
      createBurst += 1;
    }
  }
  if (createBurst > MAX_PROPOSALS) {
    return [];
  }

  const cleaned: Proposal[] = [];
  for (const item of proposals) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const ptype = obj['type'];
    const summary = obj['summary'];
    if (typeof summary !== 'string' || !summary.trim()) continue;

    if (ptype === 'update_task') {
      const taskId = obj['taskId'];
      const patch = obj['patch'];
      if (typeof taskId !== 'string' || !taskId) continue;
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        continue;
      }
      const p = patch as Record<string, unknown>;
      const safePatch: Record<string, unknown> = {};
      if (typeof p['title'] === 'string' && (p['title'] as string).trim()) {
        safePatch['title'] = (p['title'] as string).trim();
      }
      if (typeof p['description'] === 'string') {
        safePatch['description'] = p['description'];
      }
      if (
        typeof p['status'] === 'string' &&
        ALLOWED_STATUSES.has(p['status'])
      ) {
        safePatch['status'] = p['status'];
      }
      if ('assigneeId' in p) {
        const aid = p['assigneeId'];
        if (aid === null) {
          safePatch['assigneeId'] = null;
        } else if (typeof aid === 'string' && aid.trim()) {
          safePatch['assigneeId'] = aid.trim();
        }
      }
      if (Object.keys(safePatch).length === 0) continue;
      cleaned.push({
        type: 'update_task',
        summary: summary.trim(),
        taskId,
        patch: safePatch,
      });
    } else if (ptype === 'create_task') {
      const projectId = obj['projectId'];
      const projectName = obj['projectName'];
      const title = obj['title'];
      const hasProjectId =
        typeof projectId === 'string' && Boolean(projectId.trim());
      const hasProjectName =
        typeof projectName === 'string' && Boolean(projectName.trim());
      if (!hasProjectId && !hasProjectName) continue;
      if (typeof title !== 'string' || !title.trim()) continue;
      const proposal: Proposal = {
        type: 'create_task',
        summary: summary.trim(),
        title: title.trim(),
      };
      if (hasProjectId) proposal['projectId'] = (projectId as string).trim();
      if (hasProjectName) {
        proposal['projectName'] = (projectName as string).trim();
      }
      if (typeof obj['description'] === 'string') {
        proposal['description'] = obj['description'];
      }
      if (
        typeof obj['status'] === 'string' &&
        ALLOWED_STATUSES.has(obj['status'])
      ) {
        proposal['status'] = obj['status'];
      }
      const assigneeId = obj['assigneeId'];
      if (typeof assigneeId === 'string' && assigneeId.trim()) {
        proposal['assigneeId'] = assigneeId.trim();
      }
      cleaned.push(proposal);
    } else if (ptype === 'create_project') {
      const name = obj['name'];
      if (typeof name !== 'string' || !name.trim()) continue;
      cleaned.push({
        type: 'create_project',
        summary: summary.trim(),
        name: name.trim(),
      });
    } else if (ptype === 'bulk_update_tasks') {
      const safeFilter = sanitizeTaskFilter(obj['filter']);
      const patch = obj['patch'];
      if (
        !safeFilter ||
        typeof patch !== 'object' ||
        patch === null ||
        Array.isArray(patch)
      ) {
        continue;
      }
      const p = patch as Record<string, unknown>;
      const safePatch: Record<string, unknown> = {};
      if (typeof p['title'] === 'string' && (p['title'] as string).trim()) {
        safePatch['title'] = (p['title'] as string).trim();
      }
      if (typeof p['description'] === 'string') {
        safePatch['description'] = p['description'];
      }
      if (
        typeof p['status'] === 'string' &&
        ALLOWED_STATUSES.has(p['status'])
      ) {
        safePatch['status'] = p['status'];
      }
      const assigneeId = p['assigneeId'];
      if (assigneeId === null) {
        safePatch['assigneeId'] = null;
      } else if (typeof assigneeId === 'string' && assigneeId.trim()) {
        safePatch['assigneeId'] = assigneeId.trim();
      }
      if (Object.keys(safePatch).length === 0) continue;
      cleaned.push({
        type: 'bulk_update_tasks',
        summary: summary.trim(),
        filter: safeFilter,
        patch: safePatch,
      });
    } else if (ptype === 'bulk_delete_tasks') {
      const safeFilter = sanitizeTaskFilter(obj['filter']);
      if (!safeFilter) continue;
      cleaned.push({
        type: 'bulk_delete_tasks',
        summary: summary.trim(),
        filter: safeFilter,
      });
    } else if (ptype === 'dedupe_projects') {
      let keep = obj['keep'] ?? 'oldest';
      if (keep !== 'oldest' && keep !== 'newest') keep = 'oldest';
      const proposal: Proposal = {
        type: 'dedupe_projects',
        summary: summary.trim(),
        keep,
      };
      const name = obj['name'];
      if (typeof name === 'string' && name.trim()) {
        proposal['name'] = name.trim();
      }
      cleaned.push(proposal);
    } else if (ptype === 'delete_project') {
      const projectId = obj['projectId'];
      if (typeof projectId !== 'string' || !projectId.trim()) continue;
      cleaned.push({
        type: 'delete_project',
        summary: summary.trim(),
        projectId: projectId.trim(),
      });
    } else if (ptype === 'navigate_to_project') {
      const projectId = obj['projectId'];
      if (typeof projectId !== 'string' || !projectId.trim()) continue;
      cleaned.push({
        type: 'navigate_to_project',
        summary: summary.trim(),
        projectId: projectId.trim(),
      });
    } else if (ptype === 'move_tasks_to_project') {
      const targetRaw = obj['targetProjectId'];
      const targetNameRaw = obj['targetProjectName'];
      const target =
        typeof targetRaw === 'string' && targetRaw.trim()
          ? targetRaw.trim()
          : '';
      const targetName =
        typeof targetNameRaw === 'string' && targetNameRaw.trim()
          ? targetNameRaw.trim()
          : '';
      // Need a destination UUID and/or name (name for create_project in same batch).
      if (!target && !targetName) continue;

      const sourceRaw = obj['sourceProjectId'];
      const source =
        typeof sourceRaw === 'string' && sourceRaw.trim()
          ? sourceRaw.trim()
          : '';
      // Source may be filled from <current_project> in applyScopeGuards.
      if (source && target && source === target) continue;

      const proposal: Proposal = {
        type: 'move_tasks_to_project',
        summary: summary.trim(),
      };
      if (source) proposal['sourceProjectId'] = source;
      if (target) proposal['targetProjectId'] = target;
      if (targetName) proposal['targetProjectName'] = targetName;

      const statusIn = obj['statusIn'];
      if (Array.isArray(statusIn)) {
        const statuses = statusIn.filter(
          (s): s is string => typeof s === 'string' && ALLOWED_STATUSES.has(s),
        );
        if (statuses.length > 0) {
          proposal['statusIn'] = statuses;
        }
      }
      cleaned.push(proposal);
    }

    if (cleaned.length >= MAX_PROPOSALS) break;
  }

  return repairCreatePlusDeleteAsMove(cleaned);
}

/**
 * LLM often emits create_project + bulk_delete for "create X and move tasks there"
 * and skips the recreate step. Rewrite those deletes into move_tasks_to_project
 * targeting the new project by name (UI binds UUID after create Apply).
 */
export function repairCreatePlusDeleteAsMove(
  proposals: Proposal[],
): Proposal[] {
  const createProjects = proposals.filter(
    (p) => p['type'] === 'create_project',
  );
  const hasMove = proposals.some((p) => p['type'] === 'move_tasks_to_project');
  if (createProjects.length !== 1 || hasMove) {
    return proposals;
  }
  const createName = createProjects[0]!['name'];
  if (typeof createName !== 'string' || !createName.trim()) {
    return proposals;
  }
  const name = createName.trim();

  let converted = false;
  const out: Proposal[] = [];
  for (const p of proposals) {
    if (p['type'] !== 'bulk_delete_tasks') {
      out.push(p);
      continue;
    }
    const filt = (p['filter'] as Record<string, unknown>) || {};
    const sourceId =
      typeof filt['projectId'] === 'string' ? filt['projectId'].trim() : '';
    if (!sourceId) {
      out.push(p);
      continue;
    }
    const move: Proposal = {
      type: 'move_tasks_to_project',
      summary:
        typeof p['summary'] === 'string' && p['summary'].trim()
          ? p['summary'].trim().replace(/^delete\b/i, 'Move')
          : `Move tasks to ${name}`,
      sourceProjectId: sourceId,
      targetProjectName: name,
    };
    if (Array.isArray(filt['statusIn']) && filt['statusIn'].length > 0) {
      move['statusIn'] = filt['statusIn'];
    }
    out.push(move);
    converted = true;
  }
  return converted ? out : proposals;
}

export function extractJsonObject(
  text: string,
): Record<string, unknown> | null {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    cleaned = fence[1].trim();
  }
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to brace slice
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}
