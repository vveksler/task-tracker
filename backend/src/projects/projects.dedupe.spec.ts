import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskGateway } from '../gateway/task.gateway';

describe('ProjectsService.dedupe', () => {
  let service: ProjectsService;
  let prisma: {
    project: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
    task: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
      task: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TaskGateway, useValue: undefined },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  it('keeps oldest and removes newer duplicates', async () => {
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-02-01T00:00:00.000Z');

    prisma.project.findMany.mockResolvedValue([
      { id: 'p-old', name: 'Auth', createdAt: older },
      { id: 'p-new', name: 'Auth', createdAt: newer },
      { id: 'p-solo', name: 'Billing', createdAt: older },
    ]);

    prisma.project.findUnique.mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve({ id, workspaceId: 'ws-1' }),
    );

    const result = await service.dedupe('ws-1', { keep: 'oldest' });

    expect(result.keptProjectIds).toEqual(['p-old']);
    expect(result.removedProjectIds).toEqual(['p-new']);
    expect(result.removedCount).toBe(1);
    expect(prisma.project.delete).toHaveBeenCalledWith({
      where: { id: 'p-new' },
    });
    expect(prisma.project.delete).not.toHaveBeenCalledWith({
      where: { id: 'p-solo' },
    });
  });

  it('scopes optional name filter', async () => {
    prisma.project.findMany.mockResolvedValue([]);

    await service.dedupe('ws-1', { name: 'Auth', keep: 'newest' });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', name: 'Auth' },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});
