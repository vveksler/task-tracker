"""
Fixtures for retrieval regression tests.

Seeds two workspaces with one task each and real OpenAI embeddings so the
workspace-scoping filter is exercised against production-shaped data.
Requires DATABASE_URL (with pgvector) and OPENAI_API_KEY.
"""

import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from app.db import close_pool, get_pool
from app.embeddings import embed_text


@pytest_asyncio.fixture
async def seeded_two_workspaces() -> AsyncIterator[dict]:
    pool = await get_pool()

    user_id = str(uuid.uuid4())
    workspace_a_id = str(uuid.uuid4())
    workspace_b_id = str(uuid.uuid4())
    project_a_id = str(uuid.uuid4())
    project_b_id = str(uuid.uuid4())
    task_a_id = str(uuid.uuid4())
    task_b_id = str(uuid.uuid4())
    emb_a_id = str(uuid.uuid4())
    emb_b_id = str(uuid.uuid4())

    login_title = "Fix login bug"
    ssl_title = "Renew SSL certificate"

    login_embedding = await embed_text(login_title)
    ssl_embedding = await embed_text(ssl_title)

    login_literal = "[" + ",".join(str(x) for x in login_embedding) + "]"
    ssl_literal = "[" + ",".join(str(x) for x in ssl_embedding) + "]"

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO users (id, email, name, "createdAt")
                VALUES ($1, $2, $3, now())
                """,
                user_id,
                f"rag-test-{user_id}@example.com",
                "RAG Test User",
            )
            await conn.execute(
                """
                INSERT INTO workspaces (id, name, "ownerId", "createdAt")
                VALUES ($1, $2, $3, now()), ($4, $5, $3, now())
                """,
                workspace_a_id,
                "Workspace A",
                user_id,
                workspace_b_id,
                "Workspace B",
            )
            await conn.execute(
                """
                INSERT INTO projects (id, name, "workspaceId", "createdAt")
                VALUES ($1, $2, $3, now()), ($4, $5, $6, now())
                """,
                project_a_id,
                "Project A",
                workspace_a_id,
                project_b_id,
                "Project B",
                workspace_b_id,
            )
            await conn.execute(
                """
                INSERT INTO tasks
                  (id, title, description, status, "order", "projectId",
                   "createdAt", "updatedAt")
                VALUES
                  ($1, $2, $3, 'TODO', 1, $4, now(), now()),
                  ($5, $6, $7, 'TODO', 1, $8, now(), now())
                """,
                task_a_id,
                login_title,
                "Users cannot sign in",
                project_a_id,
                task_b_id,
                ssl_title,
                "Certificate expires next week",
                project_b_id,
            )
            await conn.execute(
                """
                INSERT INTO task_embeddings
                  (id, "taskId", embedding, content, "updatedAt")
                VALUES
                  ($1, $2, $3::vector, $4, now()),
                  ($5, $6, $7::vector, $8, now())
                """,
                emb_a_id,
                task_a_id,
                login_literal,
                login_title,
                emb_b_id,
                task_b_id,
                ssl_literal,
                ssl_title,
            )

    try:
        yield {
            "workspace_a_id": workspace_a_id,
            "workspace_b_id": workspace_b_id,
            "ssl_task_embedding": ssl_embedding,
        }
    finally:
        async with pool.acquire() as conn:
            # Cascade from users deletes workspaces → projects → tasks → embeddings
            await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        await close_pool()
