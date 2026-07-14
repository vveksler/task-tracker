import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    project: { findMany: jest.Mock };
    task: { groupBy: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      project: { findMany: jest.fn() },
      task: { groupBy: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('statusBreakdown', () => {
    it('should return task counts grouped by status', async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: 'proj-1' },
        { id: 'proj-2' },
      ]);
      prisma.task.groupBy.mockResolvedValue([
        { status: 'TODO', _count: { id: 5 } },
        { status: 'DONE', _count: { id: 3 } },
      ]);

      const result = await service.statusBreakdown('ws-1');

      expect(result).toEqual([
        { status: 'TODO', count: 5 },
        { status: 'DONE', count: 3 },
      ]);
      expect(prisma.task.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { projectId: { in: ['proj-1', 'proj-2'] } },
        _count: { id: true },
      });
    });

    it('should return empty array when no projects exist', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      const result = await service.statusBreakdown('ws-1');

      expect(result).toEqual([]);
      expect(prisma.task.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('activity', () => {
    it('should call raw SQL and format dates correctly', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          date: new Date('2026-06-15T00:00:00.000Z'),
          created: BigInt(10),
          updated: BigInt(3),
        },
        {
          date: new Date('2026-06-16T00:00:00.000Z'),
          created: BigInt(0),
          updated: BigInt(5),
        },
      ]);

      const result = await service.activity('ws-1', 30);

      expect(result).toEqual([
        { date: '2026-06-15', created: 10, updated: 3 },
        { date: '2026-06-16', created: 0, updated: 5 },
      ]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('assigneeLoad', () => {
    it('should return load data per assignee', async () => {
      prisma.project.findMany.mockResolvedValue([{ id: 'proj-1' }]);
      prisma.$queryRaw.mockResolvedValue([
        {
          assigneeId: 'user-1',
          assigneeName: 'Alice',
          assigneeEmail: 'alice@test.com',
          total: BigInt(10),
          todo: BigInt(2),
          in_progress: BigInt(3),
          in_review: BigInt(1),
          done: BigInt(4),
        },
        {
          assigneeId: null,
          assigneeName: null,
          assigneeEmail: null,
          total: BigInt(5),
          todo: BigInt(5),
          in_progress: BigInt(0),
          in_review: BigInt(0),
          done: BigInt(0),
        },
      ]);

      const result = await service.assigneeLoad('ws-1');

      expect(result).toEqual([
        {
          assigneeId: 'user-1',
          assigneeName: 'Alice',
          assigneeEmail: 'alice@test.com',
          total: 10,
          todo: 2,
          inProgress: 3,
          inReview: 1,
          done: 4,
        },
        {
          assigneeId: null,
          assigneeName: null,
          assigneeEmail: null,
          total: 5,
          todo: 5,
          inProgress: 0,
          inReview: 0,
          done: 0,
        },
      ]);
    });

    it('should return empty array when no projects exist', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      const result = await service.assigneeLoad('ws-1');

      expect(result).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
