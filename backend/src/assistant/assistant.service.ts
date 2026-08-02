// Talks to the Python service over the internal cluster network only
// (ClusterIP Service, not exposed via Ingress). URL comes from typed
// config — never process.env scattered in business logic.

import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('assistant.url') ?? 'http://localhost:8000';
  }

  async ask(
    workspaceId: string,
    question: string,
    currentProjectId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ReadableStream<Uint8Array>> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/assistant/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          question,
          ...(currentProjectId
            ? { current_project_id: currentProjectId }
            : {}),
          ...(history && history.length > 0 ? { history } : {}),
        }),
      });
    } catch (err) {
      const cause =
        err instanceof Error ? err.message : String(err ?? 'unknown error');
      // Log the configured base URL (no secrets) so Railway misconfig is obvious.
      this.logger.error(
        `Failed to reach AI assistant at ${this.baseUrl}/internal/assistant/ask: ${cause}`,
      );
      throw new ServiceUnavailableException(
        `AI assistant service is unavailable (${this.baseUrl}: ${cause})`,
      );
    }

    if (!response.ok || !response.body) {
      throw new BadGatewayException(
        `AI assistant service returned ${response.status}`,
      );
    }

    return response.body;
  }

  /**
   * Upsert the embedding for a task in the Python service.
   * Fire-and-forget from the embedding listener — never await on the
   * task create/update request path.
   */
  async reindex(
    taskId: string,
    title: string,
    description: string | null,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          title,
          description,
        }),
      });
    } catch (err) {
      // Re-throw with context so the listener's .catch logs something useful.
      throw new Error(
        `AI assistant reindex request failed for task ${taskId}: ${String(err)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `AI assistant reindex returned ${response.status} for task ${taskId}`,
      );
    }
  }
}
