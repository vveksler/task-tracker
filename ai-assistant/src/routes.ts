import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { embedText, embeddingLiteral } from './embeddings.js';
import { getPool, tryConnectPool } from './db.js';
import { retrieveRelevantTasks } from './retrieval.js';
import {
  retrievalQuery,
  normalizeHistory,
  type HistoryTurn,
} from './generation/history.js';
import { sseComment, streamAnswer } from './generation/stream-answer.js';

export type AskBody = {
  workspace_id: string;
  question: string;
  current_project_id?: string | null;
  history?: HistoryTurn[] | null;
};

export type EmbedBody = {
  task_id: string;
  title: string;
  description?: string | null;
};

export function createApp(): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json({ status: 'ok' }));
  app.get('/health/live', (c) => c.json({ status: 'ok' }));

  app.get('/health/ready', async (c) => {
    const pool = getPool();
    await pool.query('SELECT 1');
    return c.json({ status: 'ready' });
  });

  app.post('/internal/assistant/ask', async (c) => {
    let body: AskBody;
    try {
      body = await c.req.json<AskBody>();
    } catch {
      return c.json({ detail: 'invalid JSON body' }, 400);
    }

    if (!body.question?.trim()) {
      return c.json({ detail: 'question must not be empty' }, 400);
    }
    if (!body.workspace_id?.trim()) {
      return c.json({ detail: 'workspace_id must not be empty' }, 400);
    }

    const history: HistoryTurn[] = normalizeHistory(
      Array.isArray(body.history) ? body.history : [],
    );

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    // Open the SSE body before OpenAI embed so Nest's fetch gets headers
    // immediately (otherwise a slow first embed looks like a dead service).
    return stream(c, async (streamWriter) => {
      const ac = new AbortController();
      streamWriter.onAbort(() => {
        ac.abort();
      });

      try {
        await streamWriter.write(sseComment('ping'));

        const query = retrievalQuery(body.question, history);
        const queryEmbedding = await embedText(query);
        const relevantTasks = await retrieveRelevantTasks(
          body.workspace_id,
          queryEmbedding,
          5,
        );

        for await (const event of streamAnswer({
          question: body.question,
          contextTasks: relevantTasks,
          workspaceId: body.workspace_id,
          currentProjectId: body.current_project_id,
          history,
          signal: ac.signal,
        })) {
          if (ac.signal.aborted) break;
          await streamWriter.write(event);
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error('ask stream failed', err);
        throw err;
      }
    });
  });

  app.post('/internal/embed', async (c) => {
    let body: EmbedBody;
    try {
      body = await c.req.json<EmbedBody>();
    } catch {
      return c.json({ detail: 'invalid JSON body' }, 400);
    }

    if (!body.title?.trim()) {
      return c.json({ detail: 'title must not be empty' }, 400);
    }
    if (!body.task_id?.trim()) {
      return c.json({ detail: 'task_id must not be empty' }, 400);
    }

    let content = body.title;
    if (body.description) {
      content = `${body.title}\n${body.description}`;
    }

    const embedding = await embedText(content);
    const literal = embeddingLiteral(embedding);
    const pool = getPool();

    await pool.query(
      `
      INSERT INTO task_embeddings (id, "taskId", embedding, content, "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2::vector, $3, NOW())
      ON CONFLICT ("taskId")
      DO UPDATE SET
        embedding = EXCLUDED.embedding,
        content = EXCLUDED.content,
        "updatedAt" = NOW()
      `,
      [body.task_id, literal, content],
    );

    return c.json({ ok: true });
  });

  return app;
}

export { tryConnectPool };
