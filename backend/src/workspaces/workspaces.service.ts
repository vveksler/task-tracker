import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWorkspaceDto, userId: string) {
    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: WorkspaceRole.ADMIN,
          },
        },
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
      },
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.workspace.findMany({
      where: {
        members: { some: { userId } },
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        _count: { select: { members: true, projects: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        createdAt: true,
        members: {
          select: {
            userId: true,
            role: true,
            joinedAt: true,
            user: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  async update(workspaceId: string, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: dto.name },
      select: { id: true, name: true, ownerId: true, createdAt: true },
    });
  }

  async remove(workspaceId: string) {
    await this.prisma.workspace.delete({
      where: { id: workspaceId },
    });
  }

  async addMember(workspaceId: string, dto: AddMemberDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found with this email');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId: user.id, workspaceId },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member');
    }

    return this.prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId,
        role: dto.role ?? WorkspaceRole.MEMBER,
      },
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async removeMember(
    workspaceId: string,
    targetUserId: string,
    requestingUserId: string,
  ) {
    // Prevent removing yourself — use a different flow for "leave workspace"
    if (targetUserId === requestingUserId) {
      throw new ForbiddenException('Cannot remove yourself — use leave instead');
    }

    const target = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId: targetUserId, workspaceId },
      },
    });

    if (!target) {
      throw new NotFoundException('Member not found in this workspace');
    }

    // Prevent removing the workspace owner
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    if (workspace?.ownerId === targetUserId) {
      throw new ForbiddenException('Cannot remove the workspace owner');
    }

    await this.prisma.workspaceMember.delete({
      where: {
        userId_workspaceId: { userId: targetUserId, workspaceId },
      },
    });
  }

  async getMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }
}
