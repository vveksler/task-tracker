-- pgvector for RAG task embeddings. Applied as raw SQL because Prisma
-- cannot create the vector type via its DSL alone.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "task_embeddings" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_embeddings_taskId_key" ON "task_embeddings"("taskId");

ALTER TABLE "task_embeddings"
  ADD CONSTRAINT "task_embeddings_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
