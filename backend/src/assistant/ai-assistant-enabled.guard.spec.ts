import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AiAssistantEnabledGuard } from './ai-assistant-enabled.guard';
import { PrismaService } from '../prisma/prisma.service';

function createMockContext(
  params: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params }),
    }),
  } as unknown as ExecutionContext;
}

describe('AiAssistantEnabledGuard', () => {
  let guard: AiAssistantEnabledGuard;
  let prisma: { workspace: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = {
      workspace: { findUnique: jest.fn() },
    };
    guard = new AiAssistantEnabledGuard(prisma as unknown as PrismaService);
  });

  it('should allow when aiAssistantEnabled is true', async () => {
    prisma.workspace.findUnique.mockResolvedValue({
      aiAssistantEnabled: true,
    });

    await expect(
      guard.canActivate(createMockContext({ workspaceId: 'ws-1' })),
    ).resolves.toBe(true);
  });

  it('should reject when aiAssistantEnabled is false', async () => {
    prisma.workspace.findUnique.mockResolvedValue({
      aiAssistantEnabled: false,
    });

    await expect(
      guard.canActivate(createMockContext({ workspaceId: 'ws-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject when workspace is missing', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(createMockContext({ workspaceId: 'ws-missing' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject when workspaceId param is absent', async () => {
    await expect(guard.canActivate(createMockContext({}))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });
});
