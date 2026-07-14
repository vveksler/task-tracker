import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@prisma/client';
import { WorkspaceRolesGuard } from './workspace-roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

function createMockContext(
  user: { sub: string } | undefined,
  params: Record<string, string>,
  handler = jest.fn(),
  classRef = jest.fn(),
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as ExecutionContext;
}

describe('WorkspaceRolesGuard', () => {
  let guard: WorkspaceRolesGuard;
  let reflector: Reflector;
  let prisma: { workspaceMember: { findUnique: jest.Mock } };

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      workspaceMember: { findUnique: jest.fn() },
    };
    guard = new WorkspaceRolesGuard(
      reflector,
      prisma as unknown as PrismaService,
    );
  });

  it('should allow an ADMIN when @Roles(ADMIN) is set', async () => {
    const ctx = createMockContext(
      { sub: 'user-1' },
      { id: 'ws-1' },
    );
    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: WorkspaceRole.ADMIN,
    });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      WorkspaceRole.ADMIN,
    ]);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should allow any member when no @Roles() is set', async () => {
    const ctx = createMockContext(
      { sub: 'user-1' },
      { id: 'ws-1' },
    );
    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: WorkspaceRole.MEMBER,
    });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  /**
   * HUNT FOR (Phase 2): a MEMBER calling an ADMIN-only endpoint directly.
   *
   * The UI hides the "remove member" button for non-admins, but the API
   * must enforce it independently. This test proves the guard rejects a
   * MEMBER when @Roles(ADMIN) is required — returning 403, not 200.
   */
  it('should reject a MEMBER when @Roles(ADMIN) is required', async () => {
    const ctx = createMockContext(
      { sub: 'user-1' },
      { id: 'ws-1' },
    );
    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: WorkspaceRole.MEMBER,
    });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      WorkspaceRole.ADMIN,
    ]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should reject a non-member of the workspace', async () => {
    const ctx = createMockContext(
      { sub: 'user-1' },
      { id: 'ws-1' },
    );
    prisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should read workspaceId from params.workspaceId (nested routes)', async () => {
    const ctx = createMockContext(
      { sub: 'user-1' },
      { workspaceId: 'ws-1' },
    );
    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: WorkspaceRole.MEMBER,
    });
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: {
        userId_workspaceId: { userId: 'user-1', workspaceId: 'ws-1' },
      },
      select: { role: true },
    });
  });
});
