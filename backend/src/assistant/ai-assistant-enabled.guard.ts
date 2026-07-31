import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cost gate for the RAG assistant. Runs after WorkspaceRolesGuard.
 * Only workspaces with aiAssistantEnabled=true may hit paid LLM/embedding paths.
 * Flipping the flag is operator-only (scripts/enable-ai-assistant.ts) — not
 * something a workspace ADMIN can self-serve.
 */
@Injectable()
export class AiAssistantEnabledGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const workspaceId =
      (request.params['workspaceId'] as string | undefined) ??
      (request.params['id'] as string | undefined);

    if (!workspaceId) {
      throw new ForbiddenException('Workspace ID not found in route params');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { aiAssistantEnabled: true },
    });

    if (!workspace?.aiAssistantEnabled) {
      throw new ForbiddenException(
        'AI assistant is not enabled for this workspace',
      );
    }

    return true;
  }
}
