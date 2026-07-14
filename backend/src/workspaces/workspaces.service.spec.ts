import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { WorkspacesService } from './workspaces.service';
import { PrismaService } from '../prisma/prisma.service';

const adminId = 'admin-uuid';
const memberId = 'member-uuid';
const workspaceId = 'ws-uuid';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      workspace: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      workspaceMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WorkspacesService);
  });

  describe('create', () => {
    it('should create workspace and add creator as ADMIN', async () => {
      prisma['workspace']!['create']!.mockResolvedValue({
        id: workspaceId,
        name: 'Test',
        ownerId: adminId,
      });

      const result = await service.create({ name: 'Test' }, adminId);

      expect(result.id).toBe(workspaceId);
      const call = prisma['workspace']!['create']!.mock.calls[0]![0]!;
      expect(call.data.members.create.role).toBe(WorkspaceRole.ADMIN);
    });
  });

  describe('addMember', () => {
    it('should add a user by email', async () => {
      prisma['user']!['findUnique']!.mockResolvedValue({ id: memberId });
      prisma['workspaceMember']!['findUnique']!.mockResolvedValue(null);
      prisma['workspaceMember']!['create']!.mockResolvedValue({
        userId: memberId,
        role: WorkspaceRole.MEMBER,
      });

      const result = await service.addMember(workspaceId, {
        email: 'new@example.com',
      });

      expect(result.role).toBe(WorkspaceRole.MEMBER);
    });

    it('should throw NotFoundException if email not found', async () => {
      prisma['user']!['findUnique']!.mockResolvedValue(null);

      await expect(
        service.addMember(workspaceId, { email: 'nobody@example.com' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already a member', async () => {
      prisma['user']!['findUnique']!.mockResolvedValue({ id: memberId });
      prisma['workspaceMember']!['findUnique']!.mockResolvedValue({
        userId: memberId,
        workspaceId,
      });

      await expect(
        service.addMember(workspaceId, { email: 'exists@example.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeMember', () => {
    it('should remove a member successfully', async () => {
      prisma['workspaceMember']!['findUnique']!.mockResolvedValue({
        userId: memberId,
        workspaceId,
      });
      prisma['workspace']!['findUnique']!.mockResolvedValue({
        ownerId: adminId,
      });
      prisma['workspaceMember']!['delete']!.mockResolvedValue({});

      await service.removeMember(workspaceId, memberId, adminId);

      expect(prisma['workspaceMember']!['delete']).toHaveBeenCalledWith({
        where: {
          userId_workspaceId: { userId: memberId, workspaceId },
        },
      });
    });

    it('should throw if trying to remove yourself', async () => {
      await expect(
        service.removeMember(workspaceId, adminId, adminId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw if target member not found', async () => {
      prisma['workspaceMember']!['findUnique']!.mockResolvedValue(null);

      await expect(
        service.removeMember(workspaceId, 'unknown-uuid', adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if trying to remove workspace owner', async () => {
      const ownerId = 'owner-uuid';
      prisma['workspaceMember']!['findUnique']!.mockResolvedValue({
        userId: ownerId,
        workspaceId,
      });
      prisma['workspace']!['findUnique']!.mockResolvedValue({
        ownerId,
      });

      await expect(
        service.removeMember(workspaceId, ownerId, adminId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
