/**
 * Shared by operator scripts: (re)index task embeddings via the AI service.
 *
 * The runtime listener only reindexes on task create/update while the
 * workspace is enabled, so tasks that existed before enabling (or whose
 * fire-and-forget reindex failed) are otherwise invisible to retrieval.
 */

import type { PrismaClient } from '@prisma/client';

export interface BackfillResult {
  total: number;
  reindexed: number;
  failed: number;
}

export async function backfillWorkspaceEmbeddings(
  prisma: PrismaClient,
  workspaceId: string,
  options: { onlyMissingOrStale?: boolean } = {},
): Promise<BackfillResult> {
  const aiUrl = process.env['AI_ASSISTANT_URL'] ?? 'http://localhost:8000';
  const internalToken = process.env['AI_ASSISTANT_INTERNAL_TOKEN'] ?? '';
  if (!internalToken) {
    throw new Error(
      'AI_ASSISTANT_INTERNAL_TOKEN is not set — cannot call the AI service',
    );
  }

  const tasks = await prisma.task.findMany({
    where: { project: { workspaceId } },
    select: {
      id: true,
      title: true,
      description: true,
      updatedAt: true,
      embedding: { select: { updatedAt: true } },
    },
  });

  const pending = options.onlyMissingOrStale
    ? tasks.filter((t) => !t.embedding || t.embedding.updatedAt < t.updatedAt)
    : tasks;

  const result: BackfillResult = {
    total: pending.length,
    reindexed: 0,
    failed: 0,
  };

  for (const task of pending) {
    let res: Response;
    try {
      res = await fetch(`${aiUrl}/internal/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': internalToken,
        },
        body: JSON.stringify({
          task_id: task.id,
          title: task.title,
          description: task.description,
        }),
      });
    } catch (err) {
      throw new Error(
        `AI assistant not reachable at ${aiUrl} after ${result.reindexed} tasks: ${String(err)}`,
      );
    }

    if (res.ok) {
      result.reindexed += 1;
    } else {
      result.failed += 1;
      console.warn(`reindex failed for ${task.id}: HTTP ${res.status}`);
    }
  }

  return result;
}
