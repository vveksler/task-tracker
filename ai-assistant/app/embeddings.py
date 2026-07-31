"""
Turns text into a vector. Used both for indexing tasks (ingestion) and for
embedding the user's question at query time.
"""

from __future__ import annotations

from openai import AsyncOpenAI
from app.config import settings

_client = AsyncOpenAI(api_key=settings.openai_api_key)


async def embed_text(text: str) -> list[float]:
    # Truncate defensively — embedding models have a token limit, and a
    # runaway-long task description shouldn't crash ingestion.
    truncated = text[:8000]

    response = await _client.embeddings.create(
        model=settings.embedding_model,
        input=truncated,
    )
    return response.data[0].embedding
