import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskGateway } from '../gateway/task.gateway';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(TaskGateway) private readonly gateway?: TaskGateway,
  ) {}

  async create(workspaceId: string, dto: CreateProjectDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return this.prisma.project.create({
      data: {
        name: dto.name,
        workspaceId,
      },
      select: { id: true, name: true, workspaceId: true, createdAt: true },
    });
  }

  async findAll(workspaceId: string) {
    return this.prisma.project.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        createdAt: true,
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Fetches one project and verifies it belongs to the given workspace. */
  async findOne(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        createdAt: true,
        _count: { select: { tasks: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'Project does not belong to this workspace',
      );
    }

    return project;
  }

  async update(workspaceId: string, projectId: string, dto: UpdateProjectDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
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

    return this.prisma.project.update({
      where: { id: projectId },
      data: { name: dto.name },
      select: { id: true, name: true, workspaceId: true, createdAt: true },
    });
  }

  async remove(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
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

    // Emit WS delete events for all tasks before cascade delete
    if (this.gateway) {
      const tasks = await this.prisma.task.findMany({
        where: { projectId },
        select: { id: true, projectId: true },
      });
      this.gateway.emitBulkTasksDeleted(workspaceId, tasks);
    }

    await this.prisma.project.delete({ where: { id: projectId } });
  }
}
