# Task Tracker

Full-stack Kanban task tracker built to production standards: typed end-to-end,
tested, containerized, and deployed to Kubernetes. Not a tutorial clone — every
phase includes a deliberately hunted edge case (see [Engineering notes](#engineering-notes)).

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
│  │  Frontend     │   │  Backend     │   │  PostgreSQL             │ │
│  │  Next.js 15   │──▶│  NestJS      │──▶│  StatefulSet + PVC     │ │
│  │  App Router   │   │  Prisma ORM  │   │  (1 Gi persistent)     │ │
│  │  Zustand      │   │  Socket.io   │   └─────────────────────────┘ │
│  │  dnd-kit      │   │  JWT + RBAC  │                               │
│  │  Recharts/D3  │   │  Terminus    │   ┌─────────────────────────┐ │
│  └──────────────┘   └──────────────┘   │  Migrate Job            │ │
│                                         │  prisma migrate deploy  │ │
│  ┌────────────────────────────────────┐ └─────────────────────────┘ │
│  │  HPA (1→3 replicas at 70% CPU)    │                              │
│  └────────────────────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | NestJS + TypeScript | Modular, DI-based, strong NestJS ecosystem |
| ORM | Prisma | Type-safe queries, painless migrations |
| Database | PostgreSQL 16 | Relational data with real foreign keys |
| Auth | JWT access (in-memory) + refresh (httpOnly cookie) | Secure by design, not by accident |
| Realtime | Socket.io via NestJS Gateway | Room-per-workspace, JWT-authenticated handshake |
| Frontend | Next.js App Router | Server Components + Client Components, BFF pattern |
| State | Zustand | Lightweight, works great with optimistic updates |
| Drag & Drop | @dnd-kit | Built for reorder + cross-container moves |
| Charts | Recharts + D3 | Standard charts + hand-rolled activity heatmap |
| Containers | Docker (multi-stage) | Small production images (~150 MB) |
| Orchestration | Kubernetes (Helm chart) | StatefulSet, Ingress, HPA, init containers |
| CI | GitHub Actions | Lint + type-check + test + Docker build on push |

## Getting started

### Prerequisites
- Node.js 20+
- Docker Desktop

### Option 1: Docker Compose (quickest)

```bash
docker compose up --build
```

Backend at `http://localhost:3001`, frontend at `http://localhost:3000`.

### Option 2: Local development

```bash
# Start Postgres
docker compose up -d postgres

# Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run start:dev     # http://localhost:3001

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev           # http://localhost:3000
```

### Option 3: Kubernetes (minikube)

```bash
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

### Seed data (optional)

```bash
cd backend
npx ts-node prisma/seed.ts
```

Creates 5,500+ tasks across projects for realistic analytics data.

## Running tests

```bash
# Backend unit tests
cd backend && npm test

# Frontend unit tests
cd frontend && npm test
```

## Repo structure

```
task-tracker/
├── .github/workflows/ci.yml    # GitHub Actions: test + build
├── PROJECT_PLAN.md              # Phased plan with "Hunt for" notes
├── docker-compose.yml           # Local: Postgres + backend + frontend
├── helm/task-tracker/           # Self-authored Helm chart
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/               # 14 K8s manifests
├── backend/                     # NestJS API
│   ├── prisma/schema.prisma     # Data model source of truth
│   └── src/
│       ├── auth/                # JWT + refresh token rotation + grace period
│       ├── workspaces/          # CRUD + RBAC guards
│       ├── projects/            # CRUD, workspace-scoped
│       ├── tasks/               # CRUD + reorder (fractional indexing)
│       ├── analytics/           # Status breakdown, activity, assignee load
│       ├── events/              # Socket.io Gateway (room-per-workspace)
│       └── health/              # /health/live + /health/ready (Terminus)
└── frontend/                    # Next.js App Router
    └── src/
        ├── app/
        │   ├── api/auth/        # BFF routes (login, register, refresh, logout)
        │   ├── auth/            # Login & register pages
        │   └── workspaces/      # Workspace → project → Kanban board
        ├── components/          # Board columns, task cards, modals, UI kit
        ├── lib/                 # api-client, auth-context, stores
        └── middleware.ts        # Token refresh + access token injection for RSC
```

## Engineering notes

These are the deliberate edge cases hunted down in each phase — the part
worth walking through in an interview.

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

**Problem:** When a card is dragged and the backend request fails (e.g. server
down), the card stays in the wrong column with no indication of failure —
the UI lies about the server state.

**Fix:** `board-store` saves a snapshot before every optimistic move. On API
error, it rolls back to the snapshot and surfaces an error message. Tested
by simulating API failures in the store tests.

### Phase 6 — Sequential scan on activity query

**Problem:** The `activity-over-time` endpoint with `date_trunc` and
`generate_series` performed a sequential scan on the `tasks` table.
With 5,500+ seeded tasks, `EXPLAIN ANALYZE` showed the query scanning
every row.

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
traffic before migrations finish, causing `relation "workspaces" does not
exist` errors.

**Fix:** Added a second init-container `wait-for-migrations` that runs
`prisma migrate status` in a loop and waits until it reports "Database schema
is up to date." The backend's main container only starts after both Postgres
TCP connectivity AND schema readiness are confirmed. This is a deeper version
of the same class of problem — TCP port open ≠ schema exists.

## Bugs found during development

Real bugs discovered during development — not contrived "Hunt for" exercises
but genuine mistakes caught through manual testing and code review.

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

## License

MIT
