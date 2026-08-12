/**
 * Prevents cross-workspace retrieval leak — same IDOR class as task reorder.
 * Requires DATABASE_URL (pgvector) and OPENAI_API_KEY. Skipped otherwise.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './db.js';
import { loadConfig, resetConfigCache } from './config.js';
import { embedText, embeddingLiteral } from './embeddings.js';
import { retrieveRelevantTasks } from './retrieval.js';

const hasIntegrationEnv = Boolean(
  process.env['DATABASE_URL'] && process.env['OPENAI_API_KEY'],
);

describe.skipIf(!hasIntegrationEnv)(
  'retrieveRelevantTasks workspace isolation',
  () => {
    let workspaceAId = '';
    let userId = '';
    let sslEmbedding: number[] = [];

    beforeAll(async () => {
      // ANTHROPIC_API_KEY may be unset for this test — provide a dummy so
      // config schema passes (embeddings only need OpenAI).
      if (!process.env['ANTHROPIC_API_KEY']) {
        process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-unused';
      }
      resetConfigCache();
      loadConfig();

      const pool = getPool();
      userId = randomUUID();
      workspaceAId = randomUUID();
      const workspaceBId = randomUUID();
      const projectAId = randomUUID();
      const projectBId = randomUUID();
      const taskAId = randomUUID();
      const taskBId = randomUUID();
      const embAId = randomUUID();
      const embBId = randomUUID();

      const loginTitle = 'Fix login bug';
      const sslTitle = 'Renew SSL certificate';

      const loginEmbedding = await embedText(loginTitle);
      sslEmbedding = await embedText(sslTitle);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO users (id, email, name, "createdAt")
           VALUES ($1, $2, $3, now())`,
          [userId, `rag-test-${userId}@example.com`, 'RAG Test User'],
        );
        await client.query(
          `INSERT INTO workspaces (id, name, "ownerId", "createdAt")
           VALUES ($1, $2, $3, now()), ($4, $5, $3, now())`,
          [workspaceAId, 'Workspace A', userId, workspaceBId, 'Workspace B'],
        );
        await client.query(
          `INSERT INTO projects (id, name, "workspaceId", "createdAt")
           VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
          [
            projectAId,
            'Project A',
            workspaceAId,
            projectBId,
            'Project B',
            workspaceBId,
          ],
        );
        await client.query(
          `INSERT INTO tasks
             (id, title, description, status, "order", "projectId",
              "createdAt", "updatedAt")
           VALUES
             ($1, $2, $3, 'TODO', 1, $4, now(), now()),
             ($5, $6, $7, 'TODO', 1, $8, now(), now())`,
          [
            taskAId,
            loginTitle,
            'Users cannot sign in',
            projectAId,
            taskBId,
            sslTitle,
            'Certificate expires next week',
            projectBId,
          ],
        );
        await client.query(
          `INSERT INTO task_embeddings
             (id, "taskId", embedding, content, "updatedAt")
           VALUES
             ($1, $2, $3::vector, $4, now()),
             ($5, $6, $7::vector, $8, now())`,
          [
            embAId,
            taskAId,
            embeddingLiteral(loginEmbedding),
            loginTitle,
            embBId,
            taskBId,
            embeddingLiteral(sslEmbedding),
            sslTitle,
          ],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }, 120_000);

    afterAll(async () => {
      if (!userId) return;
      const pool = getPool();
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await closePool();
    });

    it('excludes tasks from other workspaces', async () => {
      const results = await retrieveRelevantTasks(
        workspaceAId,
        sslEmbedding,
        5,
      );
      const titles = results.map((r) => r.title);
      expect(titles).not.toContain('Renew SSL certificate');
    });
  },
);
