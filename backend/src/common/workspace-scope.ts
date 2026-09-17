import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, TaskStatus } from '@prisma/client';

/**
 * Tenant-scope checks for resources addressed by id inside a workspace.
 *
 * WorkspaceRolesGuard only proves the caller belongs to the workspace in the
 * URL — it says nothing about the task/project id in the same request. Twice
 * that gap shipped as an IDOR: `reorder` (write, REST) and `workspace:join`
 * (read, WebSocket, where HTTP guards don't run at all). Every lookup of a
 * task or project by id must go through here so the check can't be skipped.
 *
 * Prefer findTaskInWorkspace / findProjectInWorkspace. Use assertInWorkspace
 * directly only when a query needs a richer select (to avoid a second query);
 * that select must include the owning workspaceId.
 *
 * 404 vs 403 mirrors the existing API contract.
 */

type ScopeClient = Prisma.TransactionClient;
type ResourceKind = 'Task' | 'Project';

export function assertInWorkspace<T>(
  resource: T | null,
  workspaceId: string,
  kind: ResourceKind,
  /** Where the owning workspace lives on T, e.g. `(t) => t.project.workspaceId`. */
  ownerOf: (resource: T) => string,
): asserts resource is T {
  if (!resource) {
    throw new NotFoundException(`${kind} not found`);
  }
  if (ownerOf(resource) !== workspaceId) {
    throw new ForbiddenException(`${kind} does not belong to this workspace`);
  }
}

export interface ScopedProject {
  id: string;
  workspaceId: string;
}

export async function findProjectInWorkspace(
  client: ScopeClient,
  workspaceId: string,
  projectId: string,
): Promise<ScopedProject> {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true },
  });
  assertInWorkspace(project, workspaceId, 'Project', (p) => p.workspaceId);
  return project;
}

export interface ScopedTask {
  id: string;
  projectId: string;
  status: TaskStatus;
  workspaceId: string;
}

/** Works with a transaction client, so checks can run inside `$transaction`. */
export async function findTaskInWorkspace(
  client: ScopeClient,
  workspaceId: string,
  taskId: string,
): Promise<ScopedTask> {
  const task = await client.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      status: true,
      project: { select: { workspaceId: true } },
    },
  });
  assertInWorkspace(task, workspaceId, 'Task', (t) => t.project.workspaceId);
  return {
    id: task.id,
    projectId: task.projectId,
    status: task.status,
    workspaceId: task.project.workspaceId,
  };
}
