/**
 * Operator-only toggle for workspace AI assistant access (cost gate).
 *
 * Usage:
 *   npx ts-node scripts/enable-ai-assistant.ts <workspaceId>
 *   npx ts-node scripts/enable-ai-assistant.ts <workspaceId> --off
 *   npx ts-node scripts/enable-ai-assistant.ts <workspaceId> --no-backfill
 *
 * Enabling also indexes tasks that have no (or a stale) embedding, since the
 * runtime listener only reacts to task edits made after enabling. Needs
 * AI_ASSISTANT_URL and AI_ASSISTANT_INTERNAL_TOKEN; use --no-backfill to only
 * flip the flag.
 *
 * Workspace ADMIN cannot flip this via the API — that is intentional until
 * org-level billing exists.
 */

import { PrismaClient } from '@prisma/client';
import { backfillWorkspaceEmbeddings } from './lib/backfill-embeddings';

async function main() {
  const args = process.argv.slice(2);
  const off = args.includes('--off');
  const skipBackfill = args.includes('--no-backfill');
  const workspaceId = args.find((a) => !a.startsWith('--'));

  if (!workspaceId) {
    console.error(
      'Usage: npx ts-node scripts/enable-ai-assistant.ts <workspaceId> [--off] [--no-backfill]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, aiAssistantEnabled: true },
    });

    if (!workspace) {
      console.error(`Workspace not found: ${workspaceId}`);
      process.exit(1);
    }

    const enabled = !off;
    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { aiAssistantEnabled: enabled },
      select: { id: true, name: true, aiAssistantEnabled: true },
    });

    console.log(
      `AI assistant ${enabled ? 'ENABLED' : 'DISABLED'} for workspace "${updated.name}" (${updated.id})`,
    );

    if (enabled && !skipBackfill) {
      const result = await backfillWorkspaceEmbeddings(prisma, workspaceId, {
        onlyMissingOrStale: true,
      });
      console.log(
        `Embeddings backfill: ${result.reindexed}/${result.total} indexed, ${result.failed} failed`,
      );
      if (result.failed > 0) process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
