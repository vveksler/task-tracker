import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskGateway } from '../gateway/task.gateway';
import type { TaskPayload } from '../gateway/gateway.events';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReorderTaskDto } from './dto/reorder-task.dto';
import {
  BulkDeleteTasksDto,
  BulkTasksFilterDto,
  BulkUpdateTasksDto,
} from './dto/bulk-update-tasks.dto';

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
    private readonly eventEmitter: EventEmitter2,
    @Optional() @Inject(TaskGateway) private readonly gateway?: TaskGateway,
  ) {}

  async create(workspaceId: string, dto: CreateTaskDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true, workspaceId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'Project does not belong to this workspace',
      );
    }

    if (dto.assigneeId) {
      await this.validateAssignee(workspaceId, dto.assigneeId);
    }

    // Wrap read+insert in a Serializable transaction to prevent two
    // concurrent creates from reading the same max order and both
    // inserting the same value.
    const created = await this.prisma.$transaction(
      async (tx) => {
        const lastTask = await tx.task.findFirst({
          where: { projectId: dto.projectId, status: dto.status ?? 'TODO' },
          orderBy: { order: 'desc' },
          select: { order: true },
        });

        const order = (lastTask?.order ?? 0) + 1;

        return tx.task.create({
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.emit('created', created);
    // Fire-and-forget embedding re-index — listener must not block save.
    // Listener checks workspace.aiAssistantEnabled before any paid API call.
    this.eventEmitter.emit('task.contentChanged', {
      workspaceId: created.project.workspaceId,
      taskId: created.id,
      title: created.title,
      description: created.description,
    });
    return created;
  }

  async findAllByProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'Project does not belong to this workspace',
      );
    }

    return this.prisma.task.findMany({
      where: { projectId },
      select: TASK_SELECT,
      orderBy: { order: 'asc' },
    });
  }

  async findOne(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: TASK_SELECT,
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.project.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'Task does not belong to this workspace',
      );
    }

    return task;
  }

  async update(workspaceId: string, taskId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.project.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'Task does not belong to this workspace',
      );
    }

    if (dto.assigneeId) {
      await this.validateAssignee(workspaceId, dto.assigneeId);
    }

    // When status changes, auto-append to the bottom of the new column
    // to avoid the task landing at a nonsensical order position.
    let order: number | undefined;
    if (dto.status && dto.status !== task.status) {
      const lastInColumn = await this.prisma.task.findFirst({
        where: { projectId: task.projectId, status: dto.status },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      order = (lastInColumn?.order ?? 0) + 1;
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        assigneeId: dto.assigneeId,
        ...(order !== undefined && { order }),
      },
      select: TASK_SELECT,
    });

    this.emit('updated', updated);
    // Re-index only when searchable content actually changed.
    // Listener checks workspace.aiAssistantEnabled before any paid API call.
    if (dto.title !== undefined || dto.description !== undefined) {
      this.eventEmitter.emit('task.contentChanged', {
        workspaceId: updated.project.workspaceId,
        taskId: updated.id,
        title: updated.title,
        description: updated.description,
      });
    }
    return updated;
  }

  /**
   * Apply a patch to all tasks in this workspace matching the filter.
   * Filter must include at least one field (enforced by DTO) so we never
   * mass-update an entire workspace by accident.
   */
  async bulkUpdate(workspaceId: string, dto: BulkUpdateTasksDto) {
    const { filter, patch } = dto;
    const where = await this.buildBulkWhere(workspaceId, filter);

    if (patch.assigneeId !== undefined) {
      await this.validateAssignee(workspaceId, patch.assigneeId);
    }

    const matched = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        project: { select: { workspaceId: true } },
      },
    });

    if (matched.length === 0) {
      return { updatedCount: 0, taskIds: [] as string[] };
    }

    const data: Prisma.TaskUncheckedUpdateManyInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;

    await this.prisma.task.updateMany({
      where: { id: { in: matched.map((t) => t.id) } },
      data,
    });

    const contentChanged =
      patch.title !== undefined || patch.description !== undefined;

    for (const task of matched) {
      const nextTitle = patch.title ?? task.title;
      const nextDescription =
        patch.description !== undefined ? patch.description : task.description;

      if (this.gateway) {
        const full = await this.prisma.task.findUnique({
          where: { id: task.id },
          select: TASK_SELECT,
        });
        if (full) this.emit('updated', full);
      }

      if (contentChanged) {
        this.eventEmitter.emit('task.contentChanged', {
          workspaceId,
          taskId: task.id,
          title: nextTitle,
          description: nextDescription,
        });
      }
    }

    const taskIds = matched.map((t) => t.id);
    return {
      updatedCount: taskIds.length,
      taskIds: taskIds.slice(0, 100),
    };
  }

  /**
   * Delete all tasks matching the filter within this workspace.
   * Same filter rules as bulkUpdate (projectId/projectName alone is enough).
   */
  async bulkDelete(workspaceId: string, dto: BulkDeleteTasksDto) {
    const where = await this.buildBulkWhere(workspaceId, dto.filter);

    const matched = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    });

    if (matched.length === 0) {
      return { deletedCount: 0, taskIds: [] as string[] };
    }

    const taskIds = matched.map((t) => t.id);
    await this.prisma.task.deleteMany({
      where: { id: { in: taskIds } },
    });

    for (const task of matched) {
      this.gateway?.emitTaskDeleted(
        task.project.workspaceId,
        task.id,
        task.projectId,
      );
    }

    return {
      deletedCount: taskIds.length,
      taskIds: taskIds.slice(0, 100),
    };
  }

  /**
   * Build a Prisma where clause for bulk task ops.
   * Always scoped to workspaceId; resolves projectName → projectId.
   */
  private async buildBulkWhere(
    workspaceId: string,
    filter: BulkTasksFilterDto,
  ): Promise<Prisma.TaskWhereInput> {
    let resolvedProjectId = filter.projectId?.trim() || undefined;

    if (filter.projectName?.trim()) {
      const name = filter.projectName.trim();
      const projects = await this.prisma.project.findMany({
        where: {
          workspaceId,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (projects.length === 0) {
        // No match — return an impossible predicate (no accidental wide delete).
        return {
          project: { workspaceId },
          id: '00000000-0000-0000-0000-000000000000',
        };
      }

      if (projects.length > 1) {
        if (
          resolvedProjectId &&
          projects.some((p) => p.id === resolvedProjectId)
        ) {
          // keep resolvedProjectId
        } else {
          throw new BadRequestException(
            `Multiple projects named "${name}" — specify projectId`,
          );
        }
      } else {
        const onlyId = projects[0]!.id;
        if (resolvedProjectId && resolvedProjectId !== onlyId) {
          throw new BadRequestException(
            'projectId does not match projectName in this workspace',
          );
        }
        resolvedProjectId = onlyId;
      }
    }

    if (resolvedProjectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: resolvedProjectId },
        select: { workspaceId: true },
      });
      if (!project || project.workspaceId !== workspaceId) {
        throw new ForbiddenException(
          'Project does not belong to this workspace',
        );
      }
    }

    const where: Prisma.TaskWhereInput = {
      project: resolvedProjectId
        ? { workspaceId, id: resolvedProjectId }
        : { workspaceId },
    };

    if (filter.titleContains?.trim()) {
      where.title = {
        contains: filter.titleContains.trim(),
        mode: 'insensitive',
      };
    }

    if (filter.descriptionContains?.trim()) {
      where.description = {
        contains: filter.descriptionContains.trim(),
        mode: 'insensitive',
      };
    }

    if (filter.statusIn && filter.statusIn.length > 0) {
      where.status = { in: filter.statusIn };
    }

    if (filter.assigneeNameContains?.trim()) {
      const q = filter.assigneeNameContains.trim();
      where.assignee = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    // When both titleContains and descriptionContains are set, match tasks
    // where EITHER field matches (OR) — closer to "tasks about auth".
    if (filter.titleContains?.trim() && filter.descriptionContains?.trim()) {
      const titleQ = filter.titleContains.trim();
      const descQ = filter.descriptionContains.trim();
      delete where.title;
      delete where.description;
      where.OR = [
        { title: { contains: titleQ, mode: 'insensitive' } },
        { description: { contains: descQ, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  async remove(workspaceId: string, taskId: string) {
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

    if (task.project.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'Task does not belong to this workspace',
      );
    }

    await this.prisma.task.delete({ where: { id: taskId } });

    this.gateway?.emitTaskDeleted(
      task.project.workspaceId,
      task.id,
      task.projectId,
    );
  }

  /** Validates that the assignee is a member of the workspace. */
  private async validateAssignee(
    workspaceId: string,
    assigneeId: string,
  ): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId: assigneeId, workspaceId },
      },
      select: { userId: true },
    });

    if (!member) {
      throw new BadRequestException(
        'Assignee must be a member of this workspace',
      );
    }
  }

  /**
   * Reorder a task — move it to a new position within a column (status).
   *
   * Uses fractional indexing: the new order is the midpoint between the
   * tasks above and below the target position. This avoids reindexing
   * all tasks in the column on every drag.
   *
   * Wrapped in a Serializable transaction to prevent two concurrent
   * reorder requests from reading the same order values and both
   * computing the same midpoint. If a conflict occurs, Prisma throws
   * a P2034 error and we retry once.
   *
   * Trade-off: Serializable isolation is stricter than needed for most
   * operations, but reorder is the one place where concurrent reads of
   * the same data can produce a collision. An alternative is optimistic
   * locking with a version column, but fractional indexing + serializable
   * transaction is simpler to implement and explain.
   */
  async reorder(workspaceId: string, taskId: string, dto: ReorderTaskDto) {
    const MAX_RETRIES = 2;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        return await this.reorderInTransaction(workspaceId, taskId, dto);
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

  private async reorderInTransaction(
    workspaceId: string,
    taskId: string,
    dto: ReorderTaskDto,
  ) {
    const moved = await this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({
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

        if (task.project.workspaceId !== workspaceId) {
          throw new ForbiddenException(
            'Task does not belong to this workspace',
          );
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
    let afterOrder: number | undefined;
    let beforeOrder: number | undefined;

    if (dto.afterTaskId) {
      const anchor = await tx.task.findUnique({
        where: { id: dto.afterTaskId },
        select: { order: true, projectId: true, status: true },
      });
      if (!anchor || anchor.projectId !== projectId) {
        throw new BadRequestException('Invalid afterTaskId — anchor task not found in this project');
      }
      afterOrder = anchor.order;
    }

    if (dto.beforeTaskId) {
      const anchor = await tx.task.findUnique({
        where: { id: dto.beforeTaskId },
        select: { order: true, projectId: true, status: true },
      });
      if (!anchor || anchor.projectId !== projectId) {
        throw new BadRequestException('Invalid beforeTaskId — anchor task not found in this project');
      }
      beforeOrder = anchor.order;
    }

    if (afterOrder !== undefined && beforeOrder !== undefined) {
      const midpoint = (afterOrder + beforeOrder) / 2;
      // M3: precision exhaustion — if midpoint collapsed to an endpoint,
      // rebalance the entire column before computing position.
      if (midpoint === afterOrder || midpoint === beforeOrder) {
        await this.rebalanceColumn(tx, projectId, dto.status);
        return this.computeOrder(tx, projectId, {
          ...dto,
          // Clear explicit order to re-derive from fresh values
        });
      }
      return midpoint;
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

  /**
   * Rebalance all tasks in a column to integer order values (1, 2, 3, ...).
   * Called when fractional indexing precision is exhausted.
   */
  private async rebalanceColumn(
    tx: Prisma.TransactionClient,
    projectId: string,
    status: TaskStatus,
  ): Promise<void> {
    const tasks = await tx.task.findMany({
      where: { projectId, status },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    for (let i = 0; i < tasks.length; i++) {
      await tx.task.update({
        where: { id: tasks[i]!.id },
        data: { order: i + 1 },
      });
    }
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
