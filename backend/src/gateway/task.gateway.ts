import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/types/jwt-payload';
import type {
  BoardSyncEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskMovedEvent,
  TaskPayload,
  TaskUpdatedEvent,
} from './gateway.events';

interface JoinPayload {
  workspaceId: string;
  projectId: string;
}

@WebSocketGateway({
  cors: {
    origin: true, // will be narrowed via ConfigService in production
    credentials: true,
  },
})
export class TaskGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TaskGateway.name);
  private pubClient: RedisClientType | null = null;
  private subClient: RedisClientType | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Attach Redis adapter when REDIS_URL is set so emits reach clients on
   * other Nest pods after HPA scale-out. Without Redis, Socket.io stays
   * in-memory (correct for local single-process dev).
   *
   * Trade-off vs sticky-only: sticky keeps one client's socket on one pod,
   * but HTTP reorder can still land on another pod — Redis pub/sub is what
   * makes cross-pod broadcast correct. Sticky remains useful for Socket.io
   * HTTP long-polling fallback.
   */
  async afterInit(server: Server): Promise<void> {
    const redisUrl = this.config.get<string>('redis.url') ?? '';
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL not set — Socket.io using in-memory adapter (single instance only)',
      );
      return;
    }

    this.pubClient = createClient({ url: redisUrl });
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (err: Error) => {
      this.logger.error(`Redis pub client error: ${err.message}`);
    });
    this.subClient.on('error', (err: Error) => {
      this.logger.error(`Redis sub client error: ${err.message}`);
    });

    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    this.logger.log('Socket.io Redis adapter attached');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.pubClient?.quit().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Redis pub quit failed: ${message}`);
      }),
      this.subClient?.quit().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Redis sub quit failed: ${message}`);
      }),
    ]);
  }

  /**
   * Authenticate on connection — client sends access token via
   * socket.io auth: { token: 'Bearer <jwt>' }.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth?.['token'] as string) ?? '';
      const secret = this.config.get<string>('jwt.accessSecret');
      const payload = this.jwt.verify<JwtPayload>(token, { secret });
      client.data['userId'] = payload.sub;
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      this.logger.warn(`Unauthorized connection attempt: ${client.id}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Join a workspace room + project context.
   *
   * On every join (including reconnect), send the full board state via
   * board:sync so the client never keeps a stale view after a dropped
   * connection — it refetches on rejoin instead of assuming no events
   * were missed.
   */
  @SubscribeMessage('workspace:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinPayload,
  ): Promise<void> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    // Verify membership
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: data.workspaceId,
        },
      },
      select: { role: true },
    });

    if (!member) {
      client.emit('error', { message: 'Not a member of this workspace' });
      return;
    }

    const room = `workspace:${data.workspaceId}`;

    // Leave previous workspace rooms (but not the socket's own room)
    for (const existingRoom of client.rooms) {
      if (existingRoom.startsWith('workspace:')) {
        await client.leave(existingRoom);
      }
    }

    await client.join(room);
    client.data['workspaceId'] = data.workspaceId;
    client.data['projectId'] = data.projectId;

    this.logger.log(
      `Client ${client.id} joined ${room} (project: ${data.projectId})`,
    );

    // Send full board state on join — reconciliation strategy for reconnect
    const tasks = await this.prisma.task.findMany({
      where: { projectId: data.projectId },
      orderBy: { order: 'asc' },
    });

    const syncEvent: BoardSyncEvent = {
      type: 'board:sync',
      projectId: data.projectId,
      tasks: tasks.map(this.toTaskPayload),
    };

    client.emit('board:sync', syncEvent);
  }

  @SubscribeMessage('workspace:leave')
  async handleLeave(@ConnectedSocket() client: Socket): Promise<void> {
    for (const room of client.rooms) {
      if (room.startsWith('workspace:')) {
        await client.leave(room);
      }
    }
    client.data['workspaceId'] = undefined;
    client.data['projectId'] = undefined;
  }

  // ── Methods called by TasksService to broadcast events ──

  emitTaskCreated(workspaceId: string, task: TaskPayload): void {
    const event: TaskCreatedEvent = { type: 'task:created', task };
    this.server.to(`workspace:${workspaceId}`).emit('task:created', event);
  }

  emitTaskUpdated(workspaceId: string, task: TaskPayload): void {
    const event: TaskUpdatedEvent = { type: 'task:updated', task };
    this.server.to(`workspace:${workspaceId}`).emit('task:updated', event);
  }

  emitTaskMoved(workspaceId: string, task: TaskPayload): void {
    const event: TaskMovedEvent = { type: 'task:moved', task };
    this.server.to(`workspace:${workspaceId}`).emit('task:moved', event);
  }

  emitTaskDeleted(
    workspaceId: string,
    taskId: string,
    projectId: string,
  ): void {
    const event: TaskDeletedEvent = {
      type: 'task:deleted',
      taskId,
      projectId,
    };
    this.server.to(`workspace:${workspaceId}`).emit('task:deleted', event);
  }

  /** Emit delete events for all tasks before a cascade delete. */
  emitBulkTasksDeleted(
    workspaceId: string,
    tasks: { id: string; projectId: string }[],
  ): void {
    for (const task of tasks) {
      this.emitTaskDeleted(workspaceId, task.id, task.projectId);
    }
  }

  private toTaskPayload(task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    order: number;
    projectId: string;
    assigneeId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): TaskPayload {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      order: task.order,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }
}
