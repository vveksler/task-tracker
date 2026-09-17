# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Full-stack Kanban task tracker, three services: **NestJS + Prisma** backend, **Next.js App Router** frontend, and a **Hono + LangChain.js** AI assistant microservice (RAG over tasks with pgvector + Claude). See `PROJECT_PLAN.md` for the phased build plan and `README.md` for architecture diagrams, deployment (Docker Compose / Kubernetes / Railway) and the full engineering-notes log of bugs found and fixed.

## Commands

### Backend (`backend/`)

```
npm run start:dev          # dev server w/ watch, http://localhost:3001
npm run lint                # eslint --max-warnings 0
npx tsc --noEmit            # type-check (run separately from lint, as in CI)
npm test                    # jest unit tests (*.spec.ts, colocated with source)
npm test -- <pattern>       # run a single test file/suite, e.g. npm test -- tasks.service
npm run test:e2e            # supertest e2e (test/*.e2e-spec.ts) against a real DB
npx prisma migrate dev --name <description>   # schema change; never hand-edit migrations
npx prisma studio
npx ts-node scripts/enable-ai-assistant.ts <workspaceId>   # cost gate: AI is off per-workspace by default
npx ts-node scripts/seed-rag-demo.ts                       # demo data + embeddings
npx ts-node prisma/seed.ts                                  # 5,500+ tasks for analytics testing
```

### Frontend (`frontend/`)

```
npm run dev      # http://localhost:3000
npm run lint      # eslint . (next/core-web-vitals + next/typescript)
npm test          # jest --verbose (jsdom, Testing Library)
npm test -- <pattern>   # single test file, e.g. npm test -- board-store
npm run build     # also the type-check step (no separate tsc script)
```

### AI Assistant (`ai-assistant/`)

```
npm run dev        # tsx watch, http://localhost:8000, needs Node 22+
npm test            # vitest run
npm run test:watch  # vitest
```

Not included in CI (`.github/workflows/ci.yml` only lints/tests/builds backend and frontend) — run its checks manually before committing changes here.

### Repo root

```
npm run format          # prettier --write . (all three packages, one shared config)
npm run format:check    # what CI's Format job runs
```

### Local environment

```
docker compose up -d postgres          # Postgres 16 w/ pgvector, required by both backend and ai-assistant
docker compose up -d ai-assistant      # optional, needs OPENAI_API_KEY + ANTHROPIC_API_KEY
docker compose up --build              # everything, quickest path (backend :3001, frontend :3000)
```

Each service has its own `.env` (`backend/.env`, `ai-assistant/.env`, `frontend/.env.local`) copied from `.env.example` — never share one `.env` across services. When running the AI service locally (not via compose), set `AI_ASSISTANT_URL=http://localhost:8000` in `backend/.env`.

## Architecture

### Request flow and service boundaries

Frontend (Next.js) never talks to the AI assistant directly — all AI requests go through the Nest backend, which checks workspace membership and the `Workspace.aiAssistantEnabled` cost-gate flag before proxying. The AI service itself never writes task mutations to the DB; it returns **proposals** that the frontend must render as suggest+confirm, and only the Nest backend executes confirmed actions through the normal task APIs with normal auth/RBAC. This "suggest, don't write" boundary is the load-bearing security property of the assistant feature — don't let the AI service call Prisma/task mutation endpoints directly.

`backend/src/assistant/` is the proxy layer: `assistant.controller.ts` → `assistant.service.ts` streams SSE from the AI service to the frontend, `ai-assistant-enabled.guard.ts` is the per-workspace cost gate, `embedding-listener.service.ts` listens for task create/update events and re-indexes embeddings in `ai-assistant`'s `task_embeddings` (pgvector) table.

### Backend module layout (`backend/src/`)

Domain-per-folder convention: `<domain>.module.ts` / `.controller.ts` / `.service.ts` / `dto/` / `.service.spec.ts`. Existing domains: `auth`, `workspaces`, `projects`, `tasks`, `analytics`, `assistant`, `gateway` (Socket.io), `health`, `common` (shared guards/decorators/pipes), `prisma` (injected `PrismaService` — never instantiate `PrismaClient` directly elsewhere).

- **Auth**: JWT access token (short-lived, returned in body only, kept in memory client-side — never `localStorage`) + refresh token (httpOnly/Secure/SameSite=Strict cookie, hashed in DB, revocable). Refresh endpoint validates existence, expiry, and `revokedAt IS NULL` as three distinct checks, plus a 30s grace period with `replacedByHash` chaining to tolerate parallel Server Component requests during rotation.
- **RBAC**: workspace membership role (`admin`/`member`) is enforced by `WorkspaceRolesGuard` + `@Roles('admin')` — always server-side, never inferred from hidden UI. Every mutating endpoint must have this even if the frontend already hides the control (see the IDOR bug in README's "Bugs found" section — `reorder` shipped once without the ownership check other task methods had).
- **Realtime**: single `TaskGateway` in `gateway/`, one Socket.io room per workspace (`workspace:{id}`) — not per-project. Clients must self-filter by `projectId` in event handlers (the frontend's `kanban-board.tsx` does this for all five event types) since the server broadcasts workspace-wide. On `workspace:join` the server emits a full `board:sync` so reconnecting clients (e.g. after laptop sleep) don't silently miss events — don't rely on incremental events alone for board consistency.
- **Task reorder**: uses fractional indexing (`Float` order column) inside a `Serializable` Prisma transaction with retry on `P2034`, chosen over full re-index for O(1) moves. Any change to reorder logic needs regression coverage for the concurrent-drag race condition.
- Raw SQL (`$queryRaw`) is acceptable for aggregations/time-bucketing the query builder can't express cleanly (e.g. `analytics`'s `activity-over-time`, which needed a composite index `@@index([projectId, createdAt])` to avoid a sequential scan) — always parameterized, never string-concatenated.

### Frontend layout (`frontend/src/`)

- `app/` — App Router pages, `api/` holds the BFF routes (`login`, `register`, `refresh`, `logout`) that sit between the browser and the Nest API.
- `components/board/` — the Kanban board itself, a Client Component (drag state, WebSocket, optimistic updates); its page shell stays a Server Component. Default to Server Components generally; add `'use client'` only for interactivity/browser APIs/hooks.
- `components/assistant/` — chat panel/FAB for the RAG assistant.
- `stores/board-store.ts` — Zustand, for cross-component client UI state only (drag state, optimistic positions), not server data owned by a single page. Every optimistic move snapshots prior state first and rolls back with a visible error on API failure — don't let the UI claim a state the server rejected.
- `lib/api-client.ts` — the only place raw `fetch()` to the Nest API should happen; owns the 401 → refresh → retry interceptor flow.
- `lib/socket.ts` — single Socket.io client instance per workspace being viewed; on reconnect, expect (and handle) a full `board:sync`, not just resumed incremental events.
- `middleware.ts` — token refresh + access-token injection for Server Components.

### AI assistant (`ai-assistant/src/`)

Hono service, workspace-scoped RAG: `retrieval.ts` (pgvector similarity search, always filtered by `workspaceId`), `generation/` (prompt construction, intent detection, Claude streaming via `stream-answer.ts`, proposal sanitization), `workspace-context.ts` (live project/task snapshot when the user is on a board), `routes.ts` (`/internal/assistant/ask` SSE endpoint, `/internal/embed`). Bulk-mutation proposals reject empty filters (no accidental "update entire workspace") and are scoped to the current `projectId` when triggered from a project board. `DATABASE_URL` here points at the same Postgres as the backend (`node-postgres`, not Prisma) — schema changes to `task_embeddings` still go through the backend's Prisma migrations.

### Data model

Prisma schema (`backend/prisma/schema.prisma`) is the source of truth: `User`, `Workspace` → `WorkspaceMember` (role) → `Project` → `Task`, plus `RefreshToken`/`PasswordResetToken`/`EmailVerificationToken` and `TaskEmbedding` (pgvector, populated by the AI assistant pipeline). Workspace is the top-level tenancy boundary — most authorization and retrieval scoping keys off `workspaceId`.

## Working conventions

- TypeScript strict mode everywhere; no `any` without a justifying comment.
- Environment variables are read through a typed config module only, never scattered `process.env.X` in business logic.
- Never swallow errors silently — every `catch` either handles meaningfully or rethrows with context.
- State non-obvious architectural trade-offs (e.g. why fractional indexing over re-indexing, cookie vs header auth) explicitly rather than silently — either in a short code comment or in your reply.
- Don't add a dependency without explicitly naming it and why it's needed over what's already installed.
- Commit messages: Conventional Commits, `type(scope): short description` (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`; scope = domain folder). For non-obvious fixes, explain the root cause in the body, not just the change.

## Security non-negotiables

- Never `dangerouslySetInnerHTML` without `DOMPurify`; prefer plain JSX interpolation when rich text isn't actually needed.
- Access token: memory only (module-level var / React context), never `localStorage`/`sessionStorage`. Refresh token: httpOnly/Secure/SameSite=Strict cookie only.
- Validate any `href` built from user input starts with `http://`/`https://` before rendering.
- Every mutating backend endpoint re-checks authorization server-side — frontend hiding is UX, not security.
- CORS whitelists the exact frontend origin (cookies + `credentials: true` in use), never `*`.
- Never log JWTs, passwords, or refresh tokens, even at debug level.
- Passwords hashed with bcrypt server-side only; never returned in any API response.
