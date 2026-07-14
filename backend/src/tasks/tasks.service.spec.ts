import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskGateway } from '../gateway/task.gateway';

const projectId = 'project-uuid';
const workspaceId = 'workspace-uuid';
const taskId = 'task-uuid';

const withProject = (data: Record<string, unknown>) => ({
  ...data,
  project: { workspaceId },
});

describe('TasksService', () => {
  let service: TasksService;
  let gateway: { emitTaskCreated: jest.Mock; emitTaskUpdated: jest.Mock; emitTaskMoved: jest.Mock; emitTaskDeleted: jest.Mock };
  let prisma: {
    project: { findUnique: jest.Mock };
    task: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findUnique: jest.fn(),
      },
      task: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    gateway = {
      emitTaskCreated: jest.fn(),
      emitTaskUpdated: jest.fn(),
      emitTaskMoved: jest.fn(),
      emitTaskDeleted: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: TaskGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  describe('create', () => {
    it('should create task at the bottom of column and emit event', async () => {
      prisma.project.findUnique.mockResolvedValue({ id: projectId });
      prisma.task.findFirst.mockResolvedValue({ order: 3 });
      prisma.task.create.mockResolvedValue(
        withProject({
          id: taskId,
          title: 'Test',
          order: 4,
          status: TaskStatus.TODO,
          description: null,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      const result = await service.create({
        title: 'Test',
        projectId,
      });

      expect(result.order).toBe(4);
      const createCall = prisma.task.create.mock.calls[0]![0]!;
      expect(createCall.data.order).toBe(4);
      expect(gateway.emitTaskCreated).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({ id: taskId }),
      );
    });

    it('should throw if project not found', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ title: 'Test', projectId: 'bad-id' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorder', () => {
    it('should compute midpoint between two anchors and emit moved', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );

      prisma.task.findUnique
        .mockResolvedValueOnce({ id: taskId, projectId })
        .mockResolvedValueOnce({ order: 2.0 })
        .mockResolvedValueOnce({ order: 4.0 });

      prisma.task.update.mockResolvedValue(
        withProject({
          id: taskId,
          status: TaskStatus.IN_PROGRESS,
          order: 3.0,
          title: 'T',
          description: null,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      const result = await service.reorder(taskId, {
        status: TaskStatus.IN_PROGRESS,
        afterTaskId: 'after-uuid',
        beforeTaskId: 'before-uuid',
      });

      expect(result.order).toBe(3.0);
      const updateCall = prisma.task.update.mock.calls[0]![0]!;
      expect(updateCall.data.order).toBe(3.0);
      expect(gateway.emitTaskMoved).toHaveBeenCalledWith(
        workspaceId,
        expect.objectContaining({ id: taskId }),
      );
    });

    it('should place at bottom when no anchors provided', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );

      prisma.task.findUnique.mockResolvedValueOnce({
        id: taskId,
        projectId,
      });
      prisma.task.findFirst.mockResolvedValue({ order: 5.0 });
      prisma.task.update.mockResolvedValue(
        withProject({
          id: taskId,
          order: 6.0,
          title: 'T',
          status: TaskStatus.TODO,
          description: null,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      const result = await service.reorder(taskId, {
        status: TaskStatus.TODO,
      });

      expect(result.order).toBe(6.0);
    });

    /**
     * HUNT FOR (Phase 3): concurrent reorder race condition.
     *
     * When two reorder requests hit simultaneously, the Serializable
     * transaction can fail with P2034. The service retries once, then
     * returns a clear error on the second failure — not a silent
     * order collision.
     */
    it('should retry on serialization failure and throw after max retries', async () => {
      const serializationError = new Prisma.PrismaClientKnownRequestError(
        'Transaction failed due to a write conflict or a deadlock',
        { code: 'P2034', clientVersion: '6.0.0' },
      );

      prisma.$transaction
        .mockRejectedValueOnce(serializationError)
        .mockRejectedValueOnce(serializationError);

      await expect(
        service.reorder(taskId, { status: TaskStatus.TODO }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should succeed on retry after first serialization failure', async () => {
      const serializationError = new Prisma.PrismaClientKnownRequestError(
        'Transaction failed',
        { code: 'P2034', clientVersion: '6.0.0' },
      );

      prisma.$transaction
        .mockRejectedValueOnce(serializationError)
        .mockImplementationOnce(
          async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
        );

      prisma.task.findUnique.mockResolvedValueOnce({
        id: taskId,
        projectId,
      });
      prisma.task.findFirst.mockResolvedValue({ order: 1.0 });
      prisma.task.update.mockResolvedValue(
        withProject({
          id: taskId,
          order: 2.0,
          title: 'T',
          status: TaskStatus.TODO,
          description: null,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      const result = await service.reorder(taskId, {
        status: TaskStatus.TODO,
      });

      expect(result.order).toBe(2.0);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should throw non-serialization errors immediately', async () => {
      prisma.$transaction.mockRejectedValue(new Error('DB is down'));

      await expect(
        service.reorder(taskId, { status: TaskStatus.TODO }),
      ).rejects.toThrow('DB is down');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
