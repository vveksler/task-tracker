"""
Similarity search over task embeddings.

The workspace_id filter below is not optional and is applied inside the SQL
query itself — not just checked once somewhere upstream. This is deliberate:
NestJS already verifies the caller belongs to workspace_id before this
service is ever called, but that check happens at the API-gateway layer, not
at the data-access layer. If this query ever ran without the WHERE clause on
p."workspaceId", a caller could get task content from workspaces they don't
belong to injected straight into the LLM's context — the same class of bug
as the IDOR found in the task reorder endpoint, just one layer over.
"""

from __future__ import annotations

from app.db import get_pool


class RelevantTask:
    def __init__(
        self,
        id: str,
        project_id: str,
        project_name: str,
        title: str,
        description: str | None,
        status: str,
    ):
        self.id = id
        self.project_id = project_id
        self.project_name = project_name
        self.title = title
        self.description = description or ""
        self.status = status


async def retrieve_relevant_tasks(
    workspace_id: str,
    query_embedding: list[float],
    limit: int = 5,
) -> list[RelevantTask]:
    pool = await get_pool()

    # $1 = query embedding, $2 = workspace_id, $3 = limit.
    # The join through projects is what enforces the workspace boundary —
    # removing it would silently widen retrieval to every workspace in the DB.
    # asyncpg has no built-in vector codec; pass a pgvector literal string
    # that Postgres can cast with ::vector. Same filter semantics as the
    # blueprint — workspace_id stays a bound parameter, never concatenated.
    embedding_literal = "[" + ",".join(str(x) for x in query_embedding) + "]"

    rows = await pool.fetch(
        """
        SELECT t.id, t."projectId", p.name AS project_name,
               t.title, t.description, t.status,
               te.embedding <=> $1::vector AS distance
        FROM task_embeddings te
        JOIN tasks t ON t.id = te."taskId"
        JOIN projects p ON p.id = t."projectId"
        WHERE p."workspaceId" = $2
        ORDER BY distance ASC
        LIMIT $3
        """,
        embedding_literal,
        workspace_id,
        limit,
    )

    return [
        RelevantTask(
            r["id"],
            r["projectId"],
            r["project_name"],
            r["title"],
            r["description"],
            r["status"],
        )
        for r in rows
    ]
