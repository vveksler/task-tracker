# Task Tracker

Full-stack Kanban task tracker built to production standards: typed end-to-end,
tested, containerized, and deployed to Kubernetes. Built with the same rigor
I'd apply to production code — see [Engineering notes](#engineering-notes)
for real bugs found and fixed along the way, including a security
vulnerability caught during review.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Kubernetes (minikube)                       │
│                                                                     │
│  ┌──────────────────────── Ingress (nginx) ───────────────────────┐ │
│  │  /api/auth/*  → frontend:3000  (BFF)                          │ │
│  │  /api/*       → backend:3001   (REST, rewrite strips /api)    │ │
│  │  /socket.io   → backend:3001   (WebSocket)                    │ │
│  │  /*           → frontend:3000  (Next.js pages)                │ │
│  └───────────────────────────────────────────────────────────────-┘ │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐ │
│  │  Frontend     │   │  Backend     │   │  PostgreSQL + pgvector │ │
│  │  Next.js 15   │──▶│  NestJS      │──▶│  StatefulSet + PVC     │ │
│  │  App Router   │   │  Prisma ORM  │   │  (1 Gi persistent)     │ │
│  │  Zustand      │   │  Socket.io   │   └───────────┬─────────────┘ │
│  │  dnd-kit      │   │  JWT + RBAC  │               │               │
│  │  Recharts/D3  │   │  Terminus    │               │ SQL + vectors │
│  └──────────────┘   └──────┬───────┘               │               │
│                             │ internal HTTP         ▼               │
│                             │              ┌─────────────────────┐  │
│                             └─────────────▶│  AI Assistant       │  │
│                                            │  FastAPI (Python)   │  │
│                                            │  RAG + Claude       │  │
│                                            └─────────────────────┘  │
│  ┌────────────────────────────────────┐ ┌─────────────────────────┐ │
│  │  HPA (1→3 replicas at 70% CPU)    │ │  Migrate Job            │ │
│  └────────────────────────────────────┘ │  prisma migrate deploy  │ │
│                                         └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer         | Choice                                             | Why                                                |
| ------------- | -------------------------------------------------- | -------------------------------------------------- |
| Backend       | NestJS + TypeScript                                | Modular, DI-based, strong NestJS ecosystem         |
| ORM           | Prisma                                             | Type-safe queries, painless migrations             |
| Database      | PostgreSQL 16                                      | Relational data with real foreign keys             |
| Auth          | JWT access (in-memory) + refresh (httpOnly cookie) | Secure by design, not by accident                  |
| Realtime      | Socket.io via NestJS Gateway                       | Room-per-workspace, JWT-authenticated handshake    |
| Frontend      | Next.js App Router                                 | Server Components + Client Components, BFF pattern |
| State         | Zustand                                            | Lightweight, works great with optimistic updates   |
| Drag & Drop   | @dnd-kit                                           | Built for reorder + cross-container moves          |
| Charts        | Recharts + D3                                      | Standard charts + hand-rolled activity heatmap     |
| AI Assistant  | FastAPI + OpenAI embeddings + Claude + pgvector    | Workspace-scoped RAG; Nest proxies; suggest+confirm |
| Containers    | Docker (multi-stage)                               | Small production images (~150 MB)                  |
| Orchestration | Kubernetes (Helm chart)                            | StatefulSet, Ingress, HPA, init containers         |
| CI            | GitHub Actions                                     | Lint + type-check + test + Docker build on push    |

## Getting started

### Prerequisites

- Node.js 24+
- Docker Desktop

### Option 1: Docker Compose (quickest)

```
docker compose up --build
```

Backend at `http://localhost:3001`, frontend at `http://localhost:3000`.

### Option 2: Local development

```
# Start Postgres (pgvector image) + optional AI service
docker compose up -d postgres
# docker compose up -d ai-assistant   # needs OPENAI_API_KEY + ANTHROPIC_API_KEY

# Backend
cd backend
cp .env.example .env
# Set AI_ASSISTANT_URL=http://localhost:8000 when running the Python service
npm install
npx prisma migrate dev
npm run start:dev     # http://localhost:3001

# AI Assistant (separate terminal; Python 3.12 recommended)
cd ai-assistant
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # OPENAI_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev           # http://localhost:3000
```

### Option 3: Kubernetes (minikube)

```
# Start cluster and build images
minikube start --driver=docker --cpus=4 --memory=4096
eval $(minikube docker-env)
docker build -t task-tracker-backend:latest ./backend
docker build \
  --build-arg NEXT_PUBLIC_API_URL=http://task-tracker.local/api \
  --build-arg NEXT_PUBLIC_WS_URL=http://task-tracker.local \
  -t task-tracker-frontend:latest ./frontend

# Deploy
kubectl create namespace task-tracker
helm install task-tracker helm/task-tracker --namespace task-tracker

# Access (add "127.0.0.1 task-tracker.local" to /etc/hosts)
minikube tunnel
# Open http://task-tracker.local
```

For Google OAuth + real inbox mail on minikube, copy
`helm/task-tracker/values-local.yaml.example` → `values-local.yaml` (gitignored)
and run `./scripts/minikube-deploy.sh`. Use a **sending** SMTP (not Mailtrap sandbox).

### Option 4: Railway (production)

Railway does **not** use Helm `values.yaml`. Set Variables on each service in the
[Railway project](https://railway.com/). Helm equivalent placeholders live in
`helm/task-tracker/values-production.yaml.example`.

**Backend service** (Nest):

| Variable | Example / notes |
| --- | --- |
| `DATABASE_URL` | From Railway Postgres plugin |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Long random secrets |
| `FRONTEND_ORIGIN` | `https://<frontend>.up.railway.app` (exact, for CORS + email links) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client |
| `GOOGLE_CALLBACK_URL` | `https://<frontend>.up.railway.app/api/auth/google/callback` |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_FROM` | SMTP (local / Pro only — Hobby blocks SMTP) |
| `RESEND_API_KEY` | **Preferred on Railway Hobby** — HTTPS email API ([Resend](https://resend.com)); set `MAIL_FROM` too |
| `AI_ASSISTANT_URL` | Private URL of the AI service, e.g. `http://ai-assistant.railway.internal:8000` |
| `NODE_ENV` | `production` |

**Frontend service** (Next):

| Variable | Example / notes |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Backend public URL (also set as Docker **build** arg) |
| `NEXT_PUBLIC_WS_URL` | Same as API URL (Socket.io) |
| `NEXT_PUBLIC_APP_URL` | Frontend public URL |
| `APP_URL` | Same as above (runtime; preferred for OAuth redirects) |
| `BACKEND_INTERNAL_URL` | Private Railway URL to backend if available |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CALLBACK_URL` | Same callback as backend (secret stays on Nest) |
| `COOKIE_SECURE` | omit or `true` on HTTPS |

Also add the production callback URI in [Google Cloud Console](https://console.cloud.google.com/)
Authorized redirect URIs.

**AI Assistant service** (Python FastAPI, optional):

New Railway service from this repo:

1. **Root Directory:** `ai-assistant`
2. **Builder:** Dockerfile (`ai-assistant/Dockerfile`, `railway.json` included)
3. Prefer **private networking only** — Nest proxies ask/embed; no public domain required
4. Healthcheck: `GET /health/live` (ready probe hits Postgres at `/health/ready`)

| Variable | Example / notes |
| --- | --- |
| `DATABASE_URL` | Same Postgres as backend (asyncpg; `?schema=public` optional) |
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-small`) |
| `ANTHROPIC_API_KEY` | Claude answer + proposal extraction |
| `PORT` | Set by Railway automatically; image defaults to `8000` |

**Postgres / pgvector:** RAG migrations run `CREATE EXTENSION vector`. On the Railway
Postgres plugin, enable it once (SQL shell or migrate job):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

If the extension is not available on the plugin image, use a Postgres that ships
pgvector (local compose / self-hosted use `pgvector/pgvector:pg16`).

After the AI service is up and migrations are applied, enable per workspace
(cost gate — not exposed in the product UI):

```
cd backend
DATABASE_URL="<prod>" npx ts-node scripts/enable-ai-assistant.ts <workspaceId>
```

### Seed data (optional)

```
cd backend
npx ts-node prisma/seed.ts
```

Creates 5,500+ tasks across projects for realistic analytics data.

## Running tests

```
# Backend unit tests
cd backend && npm test

# Frontend unit tests
cd frontend && npm test

# AI Assistant unit tests
cd ai-assistant && .venv/bin/python -m pytest
```

## AI Assistant (RAG chat)

Workspace-scoped assistant: retrieve relevant tasks (pgvector), answer with Claude,
and propose mutations that the user must **Apply** (suggest + confirm). The Python
service never writes to the DB; Nest executes confirmed actions with normal auth/RBAC.

### What it can do

| Capability | How |
| --- | --- |
| Q&A over tasks | Vector retrieval + live project task snapshot when on a board |
| Create / update task | Proposal → existing Nest task APIs (incl. `assigneeId`) |
| Bulk update / delete tasks | Filter by keyword, assignee, status, **project id/name** |
| Create project / dedupe / delete project | Nest project APIs (`dedupe` / delete = ADMIN) |
| Navigate to a project | Client-side `router.push` on **Go** |
| Follow-ups (“yes”, “да”) | Last ~12 turns sent as `history` |
| Persist thread | `localStorage` key `tt:assistant-chat:{userId}:{workspaceId}` |

### UI

- Global FAB + right slide-over on workspace/project pages when
  `Workspace.aiAssistantEnabled` is true
- Dedicated page `/workspaces/:id/assistant` (same chat body)
- Board stays visible; task changes update live over Socket.io

### Enable for a workspace (cost gate)

Default is **off**. An operator enables paid LLM usage per workspace:

```
cd backend
npx ts-node scripts/enable-ai-assistant.ts <workspaceId>
```

Optional demo data + embeddings seed:

```
cd backend
npx ts-node scripts/seed-rag-demo.ts
```

### Security notes

- Nest verifies workspace membership before calling Python
- Retrieval / catalog SQL always filter by `workspaceId`
- Empty bulk filters rejected (no “update entire workspace” by accident)
- On a project board, bulk “all tasks” is forced to that `projectId`
- On workspace home, ambiguous “all tasks” asks which project
- Access tokens are never stored in `localStorage` (chat text only)

### Env

| Service | Variable | Notes |
| --- | --- | --- |
| Backend | `AI_ASSISTANT_URL` | e.g. `http://localhost:8000` |
| AI Assistant | `DATABASE_URL` | Same Postgres (asyncpg) |
| AI Assistant | `OPENAI_API_KEY` | Embeddings |
| AI Assistant | `ANTHROPIC_API_KEY` | Chat + proposal extraction |

## Repo structure

```
task-tracker/
├── .github/workflows/ci.yml    # GitHub Actions: test + build
├── docker-compose.yml           # Local: Postgres (pgvector) + backend + frontend + ai-assistant
├── helm/task-tracker/           # Self-authored Helm chart
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/               # 14 K8s manifests
├── ai-assistant/                # FastAPI RAG microservice (Dockerfile + railway.json)
│   ├── app/                     # retrieval, generation, workspace_context
│   └── tests/
├── backend/                     # NestJS API
│   ├── prisma/schema.prisma     # Data model source of truth (+ TaskEmbedding)
│   ├── scripts/                 # enable-ai-assistant, seed-rag-demo
│   └── src/
│       ├── auth/                # JWT + refresh token rotation + grace period
│       ├── assistant/           # SSE proxy, embedding reindex listener, cost gate
│       ├── workspaces/          # CRUD + RBAC guards
│       ├── projects/            # CRUD, dedupe, workspace-scoped
│       ├── tasks/               # CRUD + reorder + bulk-update/delete
│       ├── analytics/           # Status breakdown, activity, assignee load
│       ├── events/              # Socket.io Gateway (room-per-workspace)
│       └── health/              # /health/live + /health/ready (Terminus)
└── frontend/                    # Next.js App Router
    └── src/
        ├── app/
        │   ├── api/auth/        # BFF routes (login, register, refresh, logout)
        │   ├── auth/            # Login & register pages
        │   └── workspaces/      # Workspace → project → Kanban + /assistant
        ├── components/          # Board, assistant chat/panel, UI kit
        ├── lib/                 # api-client, assistant-sse, chat storage
        └── middleware.ts        # Token refresh + access token injection for RSC
```

## Engineering notes

Notes on specific engineering problems encountered during development and
how they were solved — the details worth walking through if you're curious
about the reasoning.

### Phase 1 — Refresh token replay after logout

**Problem:** After logout, a revoked refresh token could still be exchanged
for a new access token if the revocation check only deleted the DB row
without verifying it on subsequent calls.

**Fix:** Three-step validation in the `refresh` endpoint: (1) token exists,
(2) not expired, (3) not revoked (`revokedAt IS NULL`). Each failure returns
a distinct error message. Additionally implemented a 30-second grace period
with `replacedByHash` chain traversal for parallel Server Component requests
that hit the same token during rotation.

### Phase 2 — RBAC bypass via direct API call

**Problem:** The frontend hides the "Remove Member" button for non-admins,
but a `member` could call `DELETE /workspaces/:id/members/:userId` directly
via curl and succeed — UI hiding is UX, not security.

**Fix:** Custom `WorkspaceRolesGuard` with `@Roles('admin')` decorator
re-checks the caller's workspace role server-side on every mutating endpoint.
Tested by calling the endpoint with a member's token and confirming 403.

### Phase 3 — Concurrent reorder race condition

**Problem:** Two simultaneous drag-and-drop operations in the same column
read the same `order` values before either write completes, causing order
collisions and cards jumping to wrong positions.

**Fix:** Fractional indexing (order stored as `Float`) combined with a
`Serializable` Prisma transaction that re-reads and computes the midpoint
atomically. Retry logic on `P2034` serialization errors. Trade-off: chose
fractional indexing over full re-index because it's O(1) per move instead
of O(n).

### Phase 4 — Stale board after WebSocket reconnect

**Problem:** When a client loses connection (e.g. laptop sleep) and
reconnects, it silently misses all events that occurred while disconnected,
leaving the board stale until manual page refresh.

**Fix:** Full `board:sync` event emitted on every `workspace:join`, including
reconnects. The client receives the complete board state and replaces its
local store, ensuring consistency regardless of missed events.

### Phase 5 — Optimistic update rollback on API failure

**Problem:** When a card is dragged and the backend request fails (e.g.
server down), the card stays in the wrong column with no indication of
failure — the UI lies about the server state.

**Fix:** `board-store` saves a snapshot before every optimistic move. On API
error, it rolls back to the snapshot and surfaces an error message. Tested
by simulating API failures in the store tests.

### Phase 6 — Sequential scan on activity query

**Problem:** The `activity-over-time` endpoint with `date_trunc` and
`generate_series` performed a sequential scan on the `tasks` table. With
5,500+ seeded tasks, `EXPLAIN ANALYZE` showed the query scanning every row.

**Fix:** Added `@@index([projectId, createdAt])` composite index to the
Task model. The planner now uses an Index Scan when the table is large
enough for it to be cost-effective. Documented before/after in the commit.

### Phase 7 — Health probe that lies

**Problem:** `/health/ready` returned 200 unconditionally — even when
Postgres was down. Kubernetes would keep routing traffic to a pod that
can't serve requests.

**Fix:** Integrated `@nestjs/terminus` with `PrismaHealthIndicator` that
runs `SELECT 1` against the database. Verified by stopping the Postgres
container and confirming `/health/ready` returns 503 while `/health/live`
still returns 200.

### Phase 8 — Crash-loop on Kubernetes startup

**Problem:** Backend pods crash-loop trying to connect to Postgres before
the StatefulSet is ready. Kubernetes restarts them with exponential backoff,
causing 2-3 minute delays before the app becomes available.

**Fix:** `busybox` init container on backend, frontend, and migrate pods
that polls `nc -z postgres 5432` every 2 seconds. The main container only
starts after Postgres accepts TCP connections. This is one of the most
common real-world K8s problems — not contrived.

### Phase 8 (deeper) — Backend serves traffic before migrations complete

**Problem:** On first deploy to a clean cluster, the migrate-job runs as a
`post-install` Helm hook while the backend Deployment is already creating
pods. The backend init-container only checks TCP port (`nc -z postgres 5432`),
which opens as soon as Postgres starts — before the schema exists. The
readiness probe (`/health/ready`) does `SELECT 1`, which also succeeds on
an empty database. Result: backend pods become Ready and start receiving
traffic before migrations finish, causing `relation "workspaces" does not exist` errors.

**Fix:** Added a second init-container `wait-for-migrations` that runs
`prisma migrate status` in a loop and waits until it reports "Database
schema is up to date." The backend's main container only starts after both
Postgres TCP connectivity AND schema readiness are confirmed. This is a
deeper version of the same class of problem — TCP port open ≠ schema exists.

## Bugs found during development

Real bugs discovered during development — genuine mistakes caught through
manual testing and code review.

### IDOR in task reorder endpoint

**How I found it:** While testing the API in Postman, I noticed that
`PATCH /workspaces/:workspaceId/tasks/:id/reorder` accepted any `taskId`
regardless of which workspace was in the URL. A user could reorder tasks
belonging to another workspace by simply knowing the task UUID.

**Root cause:** Every other task method (`findOne`, `update`, `remove`) had
a `task.project.workspaceId !== workspaceId` check, but `reorder` was written
separately (with its own transactional flow) and the ownership check was
never added. The controller didn't even pass `workspaceId` to the service.

**Fix:** Added `workspaceId` parameter to `reorder` → `reorderInTransaction`,
included `project: { select: { workspaceId: true } }` in the task lookup
inside the Serializable transaction, and added the same `ForbiddenException`
guard. Added a dedicated IDOR unit test that was missing.

**Takeaway:** IDOR bugs hide in endpoints that were implemented at a different
time or by a different flow path. A shared `validateTaskOwnership` helper
would have prevented this — DRY isn't just about saving lines, it's about
ensuring security checks can't be forgotten.

### Cross-project task events leaking onto the wrong board

**How I found it:** Opened two projects in the same workspace in two browser
tabs and created a task in one. It briefly appeared on the other project's
board too, grouped into a column by its status even though it belonged to a
different project entirely.

**Root cause:** The WebSocket gateway broadcasts task events to a
`workspace:{id}` room, not scoped per project — every member connected to
any project within that workspace receives every task event for the whole
workspace. The frontend's socket handlers (`task:created`, `task:updated`,
`task:moved`, `task:deleted`, `board:sync`) applied every incoming event to
the board store unconditionally, with no check that the event actually
belonged to the project currently being viewed.

**Fix:** Added a `projectId` guard clause to all five socket event handlers
in `kanban-board.tsx` — each handler now ignores events whose `projectId`
doesn't match the board currently open. This is the pragmatic fix; the more
thorough version would scope the server-side room itself to
`workspace:{id}:project:{id}`, which would also cut down on unnecessary
network traffic to clients viewing unrelated projects — noted as a possible
follow-up.

**Takeaway:** Not every bug found this way is a security hole — this one was
purely a data-correctness bug, since all workspace members already have
legitimate REST access to every project in it. But it's exactly the kind of
thing that only shows up when you actually use the app the way a real user
would (two tabs, two projects, real-time), not from reading the code in
isolation.

## License

MIT
