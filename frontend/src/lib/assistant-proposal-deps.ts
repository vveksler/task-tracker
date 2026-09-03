/**
 * Proposal Apply ordering: cards that need a project created in the same
 * batch stay blocked until that create_project card is Applied.
 */

import type { AssistantProposal } from '@/types/api';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function namesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type ProposalCardLike = {
  key: string;
  proposal: AssistantProposal;
  status: string;
};

function createProjectCards(all: ProposalCardLike[]): ProposalCardLike[] {
  return all.filter(
    (c) => c.proposal.type === 'create_project' && c.status !== 'dismissed',
  );
}

/**
 * Which create_project cards (if any) must be Applied before `proposal`
 * can run. Empty when the proposal targets an existing project UUID.
 */
export function requiredCreateProjectCards(
  proposal: AssistantProposal,
  all: ProposalCardLike[],
): ProposalCardLike[] {
  const creates = createProjectCards(all);
  if (creates.length === 0) return [];

  if (proposal.type === 'create_task') {
    const pid = proposal.projectId?.trim() ?? '';
    const pname = proposal.projectName?.trim() ?? '';
    if (isUuid(pid)) return [];
    const matched = creates.filter(
      (c) =>
        c.proposal.type === 'create_project' &&
        (namesMatch(c.proposal.name, pname) ||
          namesMatch(c.proposal.name, pid)),
    );
    if (matched.length > 0) return matched;
    // Single new project in the batch + placeholder / missing id.
    return creates.length === 1 ? creates : [];
  }

  if (proposal.type === 'move_tasks_to_project') {
    const tid = proposal.targetProjectId?.trim() ?? '';
    const tname = proposal.targetProjectName?.trim() ?? '';
    if (isUuid(tid)) return [];
    const matched = creates.filter(
      (c) =>
        c.proposal.type === 'create_project' &&
        (namesMatch(c.proposal.name, tname) ||
          namesMatch(c.proposal.name, tid)),
    );
    if (matched.length > 0) return matched;
    return creates.length === 1 ? creates : [];
  }

  if (proposal.type === 'navigate_to_project') {
    const pid = proposal.projectId?.trim() ?? '';
    if (isUuid(pid)) return [];
    const matched = creates.filter(
      (c) =>
        c.proposal.type === 'create_project' &&
        namesMatch(c.proposal.name, pid),
    );
    if (matched.length > 0) return matched;
    return creates.length === 1 ? creates : [];
  }

  return [];
}

/**
 * Human-readable reason Apply/Go must wait, or null when the card is ready.
 */
export function getProposalBlockReason(
  card: ProposalCardLike,
  all: ProposalCardLike[],
): string | null {
  if (
    card.status === 'applied' ||
    card.status === 'dismissed' ||
    card.status === 'applying'
  ) {
    return null;
  }

  const required = requiredCreateProjectCards(card.proposal, all).filter(
    (c) => c.key !== card.key && c.status !== 'applied',
  );
  if (required.length === 0) return null;

  const first = required[0]!;
  const name =
    first.proposal.type === 'create_project' ? first.proposal.name : 'project';
  return `Apply “create project '${name}'” first`;
}
