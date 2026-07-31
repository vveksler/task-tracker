import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskGateway } from '../gateway/task.gateway';

describe('TasksService.bulkUpdate / bulkDelete', () => {
  let service: TasksService;
  let prisma: {
    task: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
    };
    project: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let eventEmitter: { emit: jest.Mock };
  let gateway: { emitTaskDeleted: jest.Mock; emitTaskUpdated: jest.Mock };

  beforeEach(async () => {
    prisma = {
      task: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
      project: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    eventEmitter = { emit: jest.fn() };
    gateway = {
      emitTaskDeleted: jest.fn(),
      emitTaskUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: TaskGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  it('updates matching tasks scoped to workspace', async () => {
    prisma.task.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Fix auth login',
        description: null,
        status: TaskStatus.TODO,
        project: { workspaceId: 'ws-1' },
      },
      {
        id: 't2',
        title: 'Auth rate limit',
        description: 'login',
        status: TaskStatus.TODO,
        project: { workspaceId: 'ws-1' },
      },
    ]);

    const result = await service.bulkUpdate('ws-1', {
      filter: { titleContains: 'auth', descriptionContains: 'auth' },
      patch: { status: TaskStatus.IN_PROGRESS },
    });

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: { workspaceId: 'ws-1' },
        }),
      }),
    );
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2'] } },
      data: { status: TaskStatus.IN_PROGRESS },
    });
    expect(result).toEqual({ updatedCount: 2, taskIds: ['t1', 't2'] });
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('matches assignee by name/email filter', async () => {
    prisma.task.findMany.mockResolvedValue([]);

    await service.bulkUpdate('ws-1', {
      filter: { assigneeNameContains: 'Alice' },
      patch: { status: TaskStatus.DONE },
    });

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignee: {
            OR: [
              { name: { contains: 'Alice', mode: 'insensitive' } },
              { email: { contains: 'Alice', mode: 'insensitive' } },
            ],
          },
        }),
      }),
    );
  });

  it('emits contentChanged when title/description patched', async () => {
    prisma.task.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Old',
        description: null,
        status: TaskStatus.TODO,
        project: { workspaceId: 'ws-1' },
      },
    ]);
    prisma.task.findUnique.mockResolvedValue({
      id: 't1',
      title: 'New title',
      description: null,
      status: TaskStatus.TODO,
      order: 1,
      projectId: 'p1',
      assigneeId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { workspaceId: 'ws-1' },
    });

    await service.bulkUpdate('ws-1', {
      filter: { titleContains: 'Old' },
      patch: { title: 'New title' },
    });

    expect(eventEmitter.emit).toHaveBeenCalledWith('task.contentChanged', {
      workspaceId: 'ws-1',
      taskId: 't1',
      title: 'New title',
      description: null,
    });
  });

  it('scopes bulkUpdate by projectName', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 'proj-auth' }]);
    prisma.project.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });
    prisma.task.findMany.mockResolvedValue([]);

    await service.bulkUpdate('ws-1', {
      filter: { projectName: 'Auth & Security' },
      patch: { status: TaskStatus.DONE },
    });

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: { workspaceId: 'ws-1', id: 'proj-auth' },
        }),
      }),
    );
  });

  it('rejects projectId from another workspace', async () => {
    prisma.project.findUnique.mockResolvedValue({ workspaceId: 'other' });

    await expect(
      service.bulkUpdate('ws-1', {
        filter: { projectId: 'foreign-proj' },
        patch: { status: TaskStatus.DONE },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bulkDeletes by projectName and emits task:deleted', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 'proj-auth' }]);
    prisma.project.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });
    prisma.task.findMany.mockResolvedValue([
      {
        id: 't1',
        projectId: 'proj-auth',
        project: { workspaceId: 'ws-1' },
      },
      {
        id: 't2',
        projectId: 'proj-auth',
        project: { workspaceId: 'ws-1' },
      },
    ]);

    const result = await service.bulkDelete('ws-1', {
      filter: { projectName: 'Auth & Security' },
    });

    expect(prisma.task.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2'] } },
    });
    expect(result).toEqual({ deletedCount: 2, taskIds: ['t1', 't2'] });
    expect(gateway.emitTaskDeleted).toHaveBeenCalledTimes(2);
  });

  it('throws when projectName matches multiple projects without projectId', async () => {
    prisma.project.findMany.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
    ]);

    await expect(
      service.bulkDelete('ws-1', {
        filter: { projectName: 'Auth' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
