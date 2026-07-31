"""
AI Assistant microservice — RAG-based Q&A over workspace tasks.
Called internally by the NestJS backend only (never exposed directly).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.embeddings import embed_text
from app.retrieval import retrieve_relevant_tasks
from app.generation import retrieval_query, stream_answer
from app.db import get_pool, close_pool, try_connect_pool

app = FastAPI(title="task-tracker-ai-assistant")


class HistoryTurn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    workspace_id: str
    question: str
    current_project_id: Optional[str] = None
    history: Optional[List[HistoryTurn]] = Field(default=None)


class EmbedRequest(BaseModel):
    task_id: str
    title: str
    # Optional[] — pydantic on Python 3.9 cannot eval `str | None` annotations.
    description: Optional[str] = None


@app.on_event("startup")
async def startup() -> None:
    # Do not block process start on DB — Railway healthcheck hits /health/live.
    # Pool is created lazily; readiness still verifies Postgres.
    await try_connect_pool()


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_pool()


@app.get("/")
@app.get("/health/live")
async def health_live() -> dict:
    # "/" included so platforms that default-healthcheck "/" still pass.
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready() -> dict:
    # Real dependency check, not an unconditional 200 — same principle as
    # the NestJS health module.
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ready"}


@app.post("/internal/assistant/ask")
async def ask(req: AskRequest) -> StreamingResponse:
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")

    history_dicts = (
        [{"role": h.role, "content": h.content} for h in req.history]
        if req.history
        else []
    )
    query = retrieval_query(req.question, history_dicts)
    query_embedding = await embed_text(query)

    relevant_tasks = await retrieve_relevant_tasks(
        workspace_id=req.workspace_id,
        query_embedding=query_embedding,
        limit=5,
    )

    return StreamingResponse(
        stream_answer(
            question=req.question,
            context_tasks=relevant_tasks,
            workspace_id=req.workspace_id,
            current_project_id=req.current_project_id,
            history=history_dicts,
        ),
        media_type="text/event-stream",
    )


@app.post("/internal/embed")
async def embed_task(req: EmbedRequest) -> dict:
    """Upsert a task embedding. Called fire-and-forget from NestJS."""
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="title must not be empty")

    content = req.title
    if req.description:
        content = f"{req.title}\n{req.description}"

    embedding = await embed_text(content)
    pool = await get_pool()
    # pgvector literal — same pattern as retrieval.
    embedding_literal = "[" + ",".join(str(x) for x in embedding) + "]"

    await pool.execute(
        """
        INSERT INTO task_embeddings (id, "taskId", embedding, content, "updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2::vector, $3, NOW())
        ON CONFLICT ("taskId")
        DO UPDATE SET
          embedding = EXCLUDED.embedding,
          content = EXCLUDED.content,
          "updatedAt" = NOW()
        """,
        req.task_id,
        embedding_literal,
        content,
    )
    return {"ok": True}
