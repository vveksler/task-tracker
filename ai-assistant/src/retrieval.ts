/**
 * Similarity search over task embeddings.
 *
 * The workspace_id filter is applied inside SQL — Nest already verifies
 * membership, but that is the API-gateway layer. Omitting the WHERE on
 * p."workspaceId" would leak other workspaces into the LLM context.
 */

import { getPool } from './db.js';
import { embeddingLiteral } from './embeddings.js';

export type RelevantTask = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: string;
};

export async function retrieveRelevantTasks(
  workspaceId: string,
  queryEmbedding: number[],
  limit = 5,
): Promise<RelevantTask[]> {
  const pool = getPool();
  const literal = embeddingLiteral(queryEmbedding);

  const { rows } = await pool.query<{
    id: string;
    projectId: string;
    project_name: string;
    title: string;
    description: string | null;
    status: string;
  }>(
    `
    SELECT t.id, t."projectId", p.name AS project_name,
           t.title, t.description, t.status,
           te.embedding <=> $1::vector AS distance
    FROM task_embeddings te
    JOIN tasks t ON t.id = te."taskId"
    JOIN projects p ON p.id = t."projectId"
    WHERE p."workspaceId" = $2
    ORDER BY distance ASC
    LIMIT $3
    `,
    [literal, workspaceId, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: r.project_name,
    title: r.title,
    description: r.description ?? '',
    status: r.status,
  }));
}
