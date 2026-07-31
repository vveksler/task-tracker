-- Approval-based cost gate for the RAG assistant. Off by default.
ALTER TABLE "workspaces" ADD COLUMN "aiAssistantEnabled" BOOLEAN NOT NULL DEFAULT false;
