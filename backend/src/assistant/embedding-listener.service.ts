import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantService } from './assistant.service';

@Injectable()
export class EmbeddingListenerService {
  private readonly logger = new Logger(EmbeddingListenerService.name);

  constructor(
    private readonly assistantService: AssistantService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('task.contentChanged')
  async handleTaskContentChanged(payload: {
    workspaceId: string;
    taskId: string;
    title: string;
    description: string | null;
  }) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: payload.workspaceId },
      select: { aiAssistantEnabled: true },
    });

    // Cost gate: do not call OpenAI embeddings unless the workspace was
    // explicitly approved. Skip quietly — task save already succeeded.
    if (!workspace?.aiAssistantEnabled) {
      this.logger.debug(
        `Skipping embedding re-index for task ${payload.taskId}: AI assistant disabled`,
      );
      return;
    }

    // Fire-and-forget — do NOT await this on the request path that saves
    // the task. The user doesn't need the task to be searchable the
    // instant they hit save, they need the task saved. Decoupling this
    // avoids adding external-API latency to the core task-management flow.
    this.assistantService
      .reindex(payload.taskId, payload.title, payload.description)
      .catch((err: unknown) =>
        this.logger.error('Embedding re-index failed', err),
      );
  }
}
