/**
 * Operator-only toggle for workspace AI assistant access (cost gate).
 *
 * Usage:
 *   npx ts-node scripts/enable-ai-assistant.ts <workspaceId>
 *   npx ts-node scripts/enable-ai-assistant.ts <workspaceId> --off
 *
 * Workspace ADMIN cannot flip this via the API — that is intentional until
 * org-level billing exists.
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const args = process.argv.slice(2);
  const off = args.includes('--off');
  const workspaceId = args.find((a) => !a.startsWith('--'));

  if (!workspaceId) {
    console.error(
      'Usage: npx ts-node scripts/enable-ai-assistant.ts <workspaceId> [--off]',
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
