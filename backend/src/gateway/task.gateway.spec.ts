import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TaskGateway } from './task.gateway';
import { PrismaService } from '../prisma/prisma.service';
import type { Server, Socket } from 'socket.io';

const userId = 'user-uuid';
const workspaceId = 'workspace-uuid';
const projectId = 'project-uuid';

function createMockSocket(overrides: Partial<Socket> = {}): Socket {
  const rooms = new Set<string>();
  return {
    id: 'socket-1',
    handshake: { auth: { token: 'valid-jwt' } },
    data: {},
    rooms,
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn((room: string) => {
      rooms.add(room);
      return Promise.resolve();
    }),
    leave: jest.fn((room: string) => {
      rooms.delete(room);
      return Promise.resolve();
    }),
    ...overrides,
  } as unknown as Socket;
}

describe('TaskGateway', () => {
  let gateway: TaskGateway;
  let jwtService: { verify: jest.Mock };
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    task: { findMany: jest.Mock };
  };
  let mockServer: { to: jest.Mock };

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };
    prisma = {
      workspaceMember: { findUnique: jest.fn() },
      task: { findMany: jest.fn() },
    };
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskGateway,
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    gateway = module.get(TaskGateway);
    gateway.server = mockServer as unknown as Server;
  });

  describe('handleConnection', () => {
    it('should authenticate and set userId on socket data', async () => {
      jwtService.verify.mockReturnValue({ sub: userId, email: 'a@b.com' });
      const client = createMockSocket();

      await gateway.handleConnection(client);

      expect(client.data['userId']).toBe(userId);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect client with invalid token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });
      const client = createMockSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Unauthorized',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('workspace:join', () => {
    it('should join room and send board:sync on join', async () => {
      const tasks = [
        {
          id: 'task-1',
          title: 'T1',
          description: null,
          status: 'TODO',
          order: 1,
          projectId,
          assigneeId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ];

      prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      prisma.task.findMany.mockResolvedValue(tasks);

      const client = createMockSocket();
      client.data['userId'] = userId;

      await gateway.handleJoin(client, { workspaceId, projectId });

      expect(client.join).toHaveBeenCalledWith(`workspace:${workspaceId}`);
      expect(client.emit).toHaveBeenCalledWith(
        'board:sync',
        expect.objectContaining({
          type: 'board:sync',
          projectId,
          tasks: expect.arrayContaining([
            expect.objectContaining({ id: 'task-1' }),
          ]),
        }),
      );
    });

    it('should reject join for non-member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      const client = createMockSocket();
      client.data['userId'] = userId;

      await gateway.handleJoin(client, { workspaceId, projectId });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Not a member of this workspace',
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('should reject join for unauthenticated socket', async () => {
      const client = createMockSocket();

      await gateway.handleJoin(client, { workspaceId, projectId });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Not authenticated',
      });
    });

    /**
     * HUNT FOR (Phase 4): reconnect reconciliation.
     *
     * When a client reconnects, it sends workspace:join again.
     * The gateway must leave old rooms, join the new one, and
     * send a fresh board:sync — ensuring no events are missed.
     */
    it('should leave old workspace room on rejoin and send fresh board:sync', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      prisma.task.findMany.mockResolvedValue([]);

      const client = createMockSocket();
      client.data['userId'] = userId;
      client.rooms.add('workspace:old-workspace');

      await gateway.handleJoin(client, { workspaceId, projectId });

      expect(client.leave).toHaveBeenCalledWith('workspace:old-workspace');
      expect(client.join).toHaveBeenCalledWith(`workspace:${workspaceId}`);
      expect(client.emit).toHaveBeenCalledWith(
        'board:sync',
        expect.objectContaining({ type: 'board:sync' }),
      );
    });
  });

  describe('emit helpers', () => {
    const taskPayload = {
      id: 'task-1',
      title: 'T1',
      description: null,
      status: 'TODO',
      order: 1,
      projectId,
      assigneeId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should emit task:created to workspace room', () => {
      gateway.emitTaskCreated(workspaceId, taskPayload);

      expect(mockServer.to).toHaveBeenCalledWith(
        `workspace:${workspaceId}`,
      );
      const emitFn = mockServer.to.mock.results[0]!.value.emit;
      expect(emitFn).toHaveBeenCalledWith(
        'task:created',
        expect.objectContaining({ type: 'task:created', task: taskPayload }),
      );
    });

    it('should emit task:deleted to workspace room', () => {
      gateway.emitTaskDeleted(workspaceId, 'task-1', projectId);

      const emitFn = mockServer.to.mock.results[0]!.value.emit;
      expect(emitFn).toHaveBeenCalledWith(
        'task:deleted',
        expect.objectContaining({ type: 'task:deleted', taskId: 'task-1' }),
      );
    });
  });
});
