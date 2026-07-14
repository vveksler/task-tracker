import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskGateway } from '../gateway/task.gateway';
import type { TaskPayload } from '../gateway/gateway.events';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReorderTaskDto } from './dto/reorder-task.dto';

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  order: true,
  projectId: true,
  assigneeId: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { workspaceId: true } },
} satisfies Prisma.TaskSelect;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(TaskGateway) private readonly gateway?: TaskGateway,
  ) {}

  async create(dto: CreateTaskDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Place new task at the bottom of its column: max(order) + 1
    const lastTask = await this.prisma.task.findFirst({
      where: { projectId: dto.projectId, status: dto.status ?? 'TODO' },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const order = (lastTask?.order ?? 0) + 1;

    const created = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        order,
        projectId: dto.projectId,
        assigneeId: dto.assigneeId,
      },
      select: TASK_SELECT,
    });

    this.emit('created', created);
    return created;
  }

  async findAllByProject(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId },
      select: TASK_SELECT,
      orderBy: { order: 'asc' },
    });
  }

  async findOne(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: TASK_SELECT,
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async update(taskId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        assigneeId: dto.assigneeId,
      },
      select: TASK_SELECT,
    });

    this.emit('updated', updated);
    return updated;
  }

  async remove(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.prisma.task.delete({ where: { id: taskId } });

    this.gateway?.emitTaskDeleted(
      task.project.workspaceId,
      task.id,
      task.projectId,
    );
  }

  /**
   * Reorder a task — move it to a new position within a column (status).
   *
   * Uses fractional indexing: the new order is the midpoint between the
   * tasks above and below the target position. This avoids reindexing
   * all tasks in the column on every drag.
   *
   * Hunt for (Phase 3): wrapped in a Serializable transaction to prevent
   * two concurrent reorder requests from reading the same order values
   * and both computing the same midpoint. If a conflict occurs, Prisma
   * throws a P2034 error and we retry once.
   *
   * Trade-off: Serializable isolation is stricter than needed for most
   * operations, but reorder is the one place where concurrent reads of
   * the same data can produce a collision. An alternative is optimistic
   * locking with a version column, but fractional indexing + serializable
   * transaction is simpler to implement and explain.
   */
  async reorder(taskId: string, dto: ReorderTaskDto) {
    const MAX_RETRIES = 2;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        return await this.reorderInTransaction(taskId, dto);
      } catch (error) {
        // P2034 = Prisma serialization failure (concurrent transaction conflict)
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          attempt++;
          if (attempt >= MAX_RETRIES) {
            throw new BadRequestException(
              'Concurrent reorder conflict — please retry',
            );
          }
          continue;
        }
        throw error;
      }
    }

    throw new BadRequestException('Reorder failed after retries');
  }

  private async reorderInTransaction(taskId: string, dto: ReorderTaskDto) {
    const moved = await this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { id: true, projectId: true },
        });

        if (!task) {
          throw new NotFoundException('Task not found');
        }

        let newOrder: number;

        if (dto.order !== undefined) {
          newOrder = dto.order;
        } else {
          newOrder = await this.computeOrder(tx, task.projectId, dto);
        }

        return tx.task.update({
          where: { id: taskId },
          data: {
            status: dto.status,
            order: newOrder,
          },
          select: TASK_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.emit('moved', moved);
    return moved;
  }

  /**
   * Compute fractional order from afterTaskId / beforeTaskId anchors.
   *
   * Cases:
   * - Both anchors: midpoint between them
   * - Only afterTaskId: after.order + 1
   * - Only beforeTaskId: before.order / 2 (insert above)
   * - Neither: append at bottom (max + 1)
   */
  private async computeOrder(
    tx: Prisma.TransactionClient,
    projectId: string,
    dto: ReorderTaskDto,
  ): Promise<number> {
    const afterOrder = dto.afterTaskId
      ? (
          await tx.task.findUnique({
            where: { id: dto.afterTaskId },
            select: { order: true },
          })
        )?.order
      : undefined;

    const beforeOrder = dto.beforeTaskId
      ? (
          await tx.task.findUnique({
            where: { id: dto.beforeTaskId },
            select: { order: true },
          })
        )?.order
      : undefined;

    if (afterOrder !== undefined && beforeOrder !== undefined) {
      return (afterOrder + beforeOrder) / 2;
    }
    if (afterOrder !== undefined) {
      return afterOrder + 1;
    }
    if (beforeOrder !== undefined) {
      return beforeOrder / 2;
    }

    // No anchors — append at bottom
    const last = await tx.task.findFirst({
      where: { projectId, status: dto.status },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return (last?.order ?? 0) + 1;
  }

  // ── Realtime helpers ──

  private emit(
    kind: 'created' | 'updated' | 'moved',
    task: { project: { workspaceId: string } } & Record<string, unknown>,
  ): void {
    if (!this.gateway) return;
    const payload = this.toPayload(task);
    const workspaceId = task.project.workspaceId;

    switch (kind) {
      case 'created':
        this.gateway.emitTaskCreated(workspaceId, payload);
        break;
      case 'updated':
        this.gateway.emitTaskUpdated(workspaceId, payload);
        break;
      case 'moved':
        this.gateway.emitTaskMoved(workspaceId, payload);
        break;
    }
  }

  private toPayload(task: Record<string, unknown>): TaskPayload {
    return {
      id: task['id'] as string,
      title: task['title'] as string,
      description: task['description'] as string | null,
      status: task['status'] as string,
      order: task['order'] as number,
      projectId: task['projectId'] as string,
      assigneeId: task['assigneeId'] as string | null,
      createdAt: (task['createdAt'] as Date).toISOString(),
      updatedAt: (task['updatedAt'] as Date).toISOString(),
    };
  }
}
