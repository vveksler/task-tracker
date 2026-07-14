/**
 * Seed script — populates the DB with realistic data for analytics testing.
 * Creates users, a workspace, projects, and 5000+ tasks with varied
 * statuses, assignees, and createdAt/updatedAt timestamps spread over
 * the past 90 days.
 *
 * Usage: npx ts-node prisma/seed.ts
 * (or via `npx prisma db seed` with package.json config)
 */

import { PrismaClient, TaskStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
const TASK_COUNT = 5500;
const PROJECT_COUNT = 8;
const USER_COUNT = 6;
const DAYS_RANGE = 90;

function randomDate(daysBack: number): Date {
  const now = Date.now();
  const past = now - daysBack * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('password123', 10);

  // Create users
  const users = await Promise.all(
    Array.from({ length: USER_COUNT }, (_, i) =>
      prisma.user.upsert({
        where: { email: `user${i + 1}@seed.local` },
        update: {},
        create: {
          email: `user${i + 1}@seed.local`,
          name: `Seed User ${i + 1}`,
          passwordHash,
        },
      }),
    ),
  );
  console.log(`  ${users.length} users created`);

  const owner = users[0]!;

  // Create workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: '00000000-0000-4000-a000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'Seed Workspace',
      ownerId: owner.id,
    },
  });
  console.log(`  Workspace: ${workspace.name}`);

  // Add all users as members
  for (const [i, user] of users.entries()) {
    await prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
      },
      update: {},
      create: {
        userId: user.id,
        workspaceId: workspace.id,
        role: i === 0 ? 'ADMIN' : 'MEMBER',
      },
    });
  }
  console.log(`  ${users.length} members added`);

  // Create projects
  const projects = await Promise.all(
    Array.from({ length: PROJECT_COUNT }, (_, i) =>
      prisma.project.upsert({
        where: { id: `00000000-0000-4000-b000-00000000000${i + 1}` },
        update: {},
        create: {
          id: `00000000-0000-4000-b000-00000000000${i + 1}`,
          name: `Project ${String.fromCharCode(65 + i)}`,
          workspaceId: workspace.id,
        },
      }),
    ),
  );
  console.log(`  ${projects.length} projects created`);

  // Delete existing seed tasks to avoid duplicates on re-run
  const projectIds = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });

  // Create tasks in bulk
  const taskData = Array.from({ length: TASK_COUNT }, (_, i) => {
    const createdAt = randomDate(DAYS_RANGE);
    const status = randomElement(STATUSES);
    const isUpdated = status !== 'TODO' && Math.random() > 0.3;
    const updatedAt = isUpdated
      ? new Date(createdAt.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000)
      : createdAt;
    // ~20% unassigned
    const assigneeId = Math.random() > 0.2 ? randomElement(users).id : null;

    return {
      title: `Task #${i + 1} — ${status.toLowerCase().replace('_', ' ')}`,
      description: i % 3 === 0 ? `Auto-generated seed task ${i + 1}` : null,
      status,
      order: i,
      projectId: randomElement(projects).id,
      assigneeId,
      createdAt,
      updatedAt,
    };
  });

  await prisma.task.createMany({ data: taskData });
  console.log(`  ${TASK_COUNT} tasks created`);

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
