import { SetMetadata } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to specific workspace roles (e.g. ADMIN).
 * Used together with WorkspaceRolesGuard.
 * Without this decorator, the guard only checks workspace membership.
 */
export const Roles = (...roles: WorkspaceRole[]) =>
  SetMetadata(ROLES_KEY, roles);
