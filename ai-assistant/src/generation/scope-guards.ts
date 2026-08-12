import type { Proposal } from './sanitize-proposals.js';
import type { ScopeIntent } from './intent.js';

function filterHasProject(filt: Record<string, unknown>): boolean {
  return Boolean(
    (typeof filt['projectId'] === 'string' &&
      (filt['projectId'] as string).trim()) ||
      (typeof filt['projectName'] === 'string' &&
        (filt['projectName'] as string).trim()),
  );
}

function filterHasContentScope(filt: Record<string, unknown>): boolean {
  return Boolean(
    filt['titleContains'] ||
      filt['descriptionContains'] ||
      filt['assigneeNameContains'],
  );
}

/**
 * Deterministic scope fixes (language-agnostic safety + intent flags):
 * - On a project board: inject current projectId into bulk filters.
 * - wantsAllTasksInScope && !statusLimited: drop statusIn.
 * - Workspace with no project: drop status-only / empty-scope bulk
 *   (safety net — does not depend on question language).
 */
export function applyScopeGuards(
  proposals: Proposal[],
  intent: ScopeIntent,
  currentProjectId?: string | null,
): Proposal[] {
  const wantsAll = intent.wantsAllTasksInScope;
  const statusLimited = intent.statusLimited;
  const out: Proposal[] = [];

  for (const proposal of proposals) {
    const ptype = proposal['type'];
    if (ptype === 'move_tasks_to_project') {
      const source =
        typeof proposal['sourceProjectId'] === 'string'
          ? proposal['sourceProjectId'].trim()
          : '';
      const target =
        typeof proposal['targetProjectId'] === 'string'
          ? proposal['targetProjectId'].trim()
          : '';
      const targetName =
        typeof proposal['targetProjectName'] === 'string'
          ? proposal['targetProjectName'].trim()
          : '';
      let nextSource = source;
      if ((!nextSource || (target && nextSource === target)) && currentProjectId) {
        // "this project" → current board as source when LLM omitted it.
        nextSource = currentProjectId;
      }
      if (!nextSource) {
        continue;
      }
      // Destination may be name-only until create_project Apply binds a UUID.
      if (!target && !targetName) {
        continue;
      }
      if (target && nextSource === target) {
        continue;
      }
      const next: Proposal = {
        ...proposal,
        sourceProjectId: nextSource,
      };
      if (target) next['targetProjectId'] = target;
      else delete next['targetProjectId'];
      if (targetName) next['targetProjectName'] = targetName;
      out.push(next);
      continue;
    }

    if (ptype !== 'bulk_update_tasks' && ptype !== 'bulk_delete_tasks') {
      out.push(proposal);
      continue;
    }

    const filt = {
      ...((proposal['filter'] as Record<string, unknown>) || {}),
    };
    const namedOtherProject =
      filterHasProject(filt) &&
      currentProjectId &&
      filt['projectId'] &&
      filt['projectId'] !== currentProjectId;

    if (currentProjectId && !namedOtherProject) {
      if (!filterHasProject(filt) || !filt['projectId']) {
        filt['projectId'] = currentProjectId;
        delete filt['projectName'];
      }
    }

    if (wantsAll && !statusLimited) {
      delete filt['statusIn'];
    }

    // Safety: refuse ambiguous workspace-wide bulk with no project/keyword scope.
    if (!currentProjectId) {
      if (!filterHasProject(filt) && !filterHasContentScope(filt)) {
        continue;
      }
    }

    if (Object.keys(filt).length === 0) continue;

    const updated: Proposal = { ...proposal, filter: filt };
    if (
      currentProjectId &&
      wantsAll &&
      !statusLimited &&
      filt['projectId'] === currentProjectId
    ) {
      const summary = proposal['summary'];
      if (typeof summary === 'string') {
        const lower = summary.toLowerCase();
        if (
          lower.includes('all projects') ||
          lower.includes('across') ||
          lower.includes('todo')
        ) {
          updated['summary'] =
            ptype === 'bulk_update_tasks'
              ? 'Update all tasks in the current project'
              : 'Delete all tasks in the current project';
        }
      }
    }
    out.push(updated);
  }

  return out;
}
