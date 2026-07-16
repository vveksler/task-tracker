import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
    workspaceMember: { findUnique: jest.Mock };
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
      workspaceMember: {
        findUnique: jest.fn(),
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
      prisma.project.findUnique.mockResolvedValue({
        id: projectId,
        workspaceId,
      });
      // create now runs inside $transaction — mock passes through to prisma
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );
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

      const result = await service.create(workspaceId, {
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
        service.create(workspaceId, { title: 'Test', projectId: 'bad-id' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if project belongs to another workspace (IDOR)', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: projectId,
        workspaceId: 'other-workspace',
      });

      await expect(
        service.create(workspaceId, { title: 'Test', projectId }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw if assignee is not a workspace member', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: projectId,
        workspaceId,
      });
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create(workspaceId, {
          title: 'Test',
          projectId,
          assigneeId: 'non-member-id',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reorder', () => {
    it('should compute midpoint between two anchors and emit moved', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );

      prisma.task.findUnique
        .mockResolvedValueOnce({
          id: taskId,
          projectId,
          project: { workspaceId },
        })
        .mockResolvedValueOnce({ order: 2.0, projectId, status: TaskStatus.IN_PROGRESS })
        .mockResolvedValueOnce({ order: 4.0, projectId, status: TaskStatus.IN_PROGRESS });

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

      const result = await service.reorder(workspaceId, taskId, {
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
        project: { workspaceId },
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

      const result = await service.reorder(workspaceId, taskId, {
        status: TaskStatus.TODO,
      });

      expect(result.order).toBe(6.0);
    });

    it('should throw ForbiddenException when task belongs to another workspace (IDOR)', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );

      prisma.task.findUnique.mockResolvedValueOnce({
        id: taskId,
        projectId,
        project: { workspaceId: 'other-workspace' },
      });

      await expect(
        service.reorder(workspaceId, taskId, { status: TaskStatus.TODO }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.task.update).not.toHaveBeenCalled();
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
        service.reorder(workspaceId, taskId, { status: TaskStatus.TODO }),
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
        project: { workspaceId },
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

      const result = await service.reorder(workspaceId, taskId, {
        status: TaskStatus.TODO,
      });

      expect(result.order).toBe(2.0);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should throw non-serialization errors immediately', async () => {
      prisma.$transaction.mockRejectedValue(new Error('DB is down'));

      await expect(
        service.reorder(workspaceId, taskId, { status: TaskStatus.TODO }),
      ).rejects.toThrow('DB is down');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException for invalid anchor task (deleted or wrong project)', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );

      prisma.task.findUnique
        .mockResolvedValueOnce({
          id: taskId,
          projectId,
          project: { workspaceId },
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.reorder(workspaceId, taskId, {
          status: TaskStatus.TODO,
          afterTaskId: 'deleted-task-id',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should auto-append to bottom of new column when status changes', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: taskId,
        status: TaskStatus.TODO,
        projectId,
        project: { workspaceId },
      });
      prisma.task.findFirst.mockResolvedValue({ order: 5.0 });
      prisma.task.update.mockResolvedValue(
        withProject({
          id: taskId,
          title: 'T',
          description: null,
          status: TaskStatus.DONE,
          order: 6.0,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      await service.update(workspaceId, taskId, {
        status: TaskStatus.DONE,
      });

      const updateCall = prisma.task.update.mock.calls[0]![0]!;
      expect(updateCall.data.order).toBe(6.0);
    });

    it('should not change order when status stays the same', async () => {
      prisma.task.findUnique.mockResolvedValue({
        id: taskId,
        status: TaskStatus.TODO,
        projectId,
        project: { workspaceId },
      });
      prisma.task.update.mockResolvedValue(
        withProject({
          id: taskId,
          title: 'Updated',
          description: null,
          status: TaskStatus.TODO,
          order: 3.0,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      await service.update(workspaceId, taskId, {
        title: 'Updated',
      });

      const updateCall = prisma.task.update.mock.calls[0]![0]!;
      expect(updateCall.data.order).toBeUndefined();
    });
  });

  describe('create (concurrency)', () => {
    it('should use Serializable transaction to prevent duplicate order values', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: projectId,
        workspaceId,
      });
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      );
      prisma.task.findFirst.mockResolvedValue({ order: 5 });
      prisma.task.create.mockResolvedValue(
        withProject({
          id: 'new-id',
          title: 'T',
          order: 6,
          status: TaskStatus.TODO,
          description: null,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );

      await service.create(workspaceId, { title: 'T', projectId });

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });
  });
});
