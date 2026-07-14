import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
export class TaskGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TaskGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
   * Hunt for (Phase 4): on every join (including reconnect), we send
   * the full board state via board:sync. This ensures the client never
   * has a stale view after a dropped connection — it refetches
   * automatically on rejoin instead of assuming no events were missed.
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
