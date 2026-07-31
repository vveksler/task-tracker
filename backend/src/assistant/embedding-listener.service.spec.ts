import { EmbeddingListenerService } from './embedding-listener.service';
import { AssistantService } from './assistant.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EmbeddingListenerService', () => {
  let listener: EmbeddingListenerService;
  let assistantService: { reindex: jest.Mock };
  let prisma: { workspace: { findUnique: jest.Mock } };

  const payload = {
    workspaceId: 'ws-1',
    taskId: 'task-1',
    title: 'Fix login',
    description: null as string | null,
  };

  beforeEach(() => {
    assistantService = { reindex: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      workspace: { findUnique: jest.fn() },
    };
    listener = new EmbeddingListenerService(
      assistantService as unknown as AssistantService,
      prisma as unknown as PrismaService,
    );
  });

  it('should not call reindex when AI assistant is disabled', async () => {
    prisma.workspace.findUnique.mockResolvedValue({
      aiAssistantEnabled: false,
    });

    await listener.handleTaskContentChanged(payload);

    expect(assistantService.reindex).not.toHaveBeenCalled();
  });

  it('should not call reindex when workspace is missing', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);

    await listener.handleTaskContentChanged(payload);

    expect(assistantService.reindex).not.toHaveBeenCalled();
  });

  it('should fire-and-forget reindex when AI assistant is enabled', async () => {
    prisma.workspace.findUnique.mockResolvedValue({
      aiAssistantEnabled: true,
    });

    await listener.handleTaskContentChanged(payload);

    expect(assistantService.reindex).toHaveBeenCalledWith(
      'task-1',
      'Fix login',
      null,
    );
  });
});
