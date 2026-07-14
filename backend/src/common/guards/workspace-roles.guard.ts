import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../types/jwt-payload';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Guard that checks workspace membership and optionally required roles.
 *
 * Reads workspaceId from route params — checks both `workspaceId` and `id`
 * to support nested routes (/workspaces/:id/...) and flat routes.
 *
 * If @Roles('ADMIN') is set on the handler, membership alone is not enough —
 * the user's role in the workspace must match.
 *
 * Hunt for (Phase 2): this guard is the server-side enforcement.
 * The frontend may hide buttons for non-admins, but that's UX, not security.
 * This guard ensures the API itself rejects unauthorized mutations.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const workspaceId =
      (request.params['workspaceId'] as string | undefined) ??
      (request.params['id'] as string | undefined);

    if (!workspaceId) {
      throw new ForbiddenException('Workspace ID not found in route params');
    }

    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.sub,
          workspaceId,
        },
      },
      select: { role: true },
    });

    if (!member) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    const requiredRoles = this.reflector.getAllAndOverride<
      WorkspaceRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(member.role)) {
        throw new ForbiddenException(
          'Insufficient role — requires: ' + requiredRoles.join(', '),
        );
      }
    }

    return true;
  }
}
