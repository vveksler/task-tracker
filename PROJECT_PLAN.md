# Task Tracker — Development Plan

Phased plan for building a full-stack Kanban task tracker to production
standards: NestJS backend, Next.js frontend, real-time updates, analytics
dashboard, and a self-authored Kubernetes deployment.

## Tech stack & why

| Layer | Choice | Why |
|---|---|---|
| Backend | NestJS + TypeScript | Modular, DI-based architecture with a strong NestJS ecosystem |
| ORM | Prisma | Type-safe queries, painless migrations |
| Database | PostgreSQL | Relational data with real foreign keys |
| Auth | JWT (access in memory) + refresh token (httpOnly cookie) | Secure by design — short-lived access token, revocable refresh |
| Realtime | Socket.io via NestJS Gateway | Room-per-workspace board updates |
| Frontend | Next.js (App Router) | Server Components for data pages, Client Components for the board |
| State (client) | Zustand | Lightweight UI state for drag and optimistic updates |
| Drag & drop | @dnd-kit/core + @dnd-kit/sortable | Reorder and cross-container moves |
| Charts | Recharts (+ one hand-rolled D3 widget) | Standard charts plus a custom activity heatmap |
| Containers | Docker (multi-stage builds) | Small production-style images |
| Orchestration | Kubernetes (self-authored Helm chart) | Liveness/readiness probes, HPA, Ingress, ConfigMap/Secret |
| CI | GitHub Actions | Test-on-push, Docker image build |

## Phases

### Phase 0 — Environment setup
- Repo skeleton, Cursor rules, Prisma schema, docker-compose for local Postgres.
- **Done when:** `docker compose up`, `npx prisma migrate dev`, backend boots,
  `/health/live` returns 200.

### Phase 1 — Auth module
- Register, login, JWT access token (body), refresh token (httpOnly Secure
  SameSite=Strict cookie), logout (revoke refresh token), NestJS Guards.
- Refresh must reject revoked/expired tokens; support a short grace period for
  concurrent Server Component refresh races during rotation.

### Phase 2 — Workspaces, Projects, RBAC
- Workspace CRUD, invite members, roles (`admin` / `member`), custom `@Roles()`
  guard.
- Every mutating endpoint re-checks authorization server-side — UI hiding is
  UX, not security.

### Phase 3 — Tasks & Kanban API
- Task CRUD, status field, `order` field for board position, dedicated
  `PATCH /tasks/:id/reorder` (not a generic PATCH).
- Concurrent reorders must not collide: fractional indexing + Serializable
  transaction with retry on `P2034`.

### Phase 4 — Realtime (WebSocket Gateway)
- Socket.io Gateway, task events, room-per-workspace so events don't leak
  across workspaces.
- On reconnect / rejoin, send full `board:sync` so the client never keeps a
  stale view after a dropped connection.

### Phase 5 — Frontend core
- Auth pages, workspace/project list (Server Components), Kanban board
  (Client Component), dnd-kit, Zustand store for board UI state.
- Optimistic updates with rollback and a visible error when the API fails.

### Phase 6 — Analytics dashboard
- `/workspaces/:id/analytics/*` (status breakdown, activity over time, load by
  assignee), Prisma `groupBy` + raw SQL for time-bucketed activity, Recharts,
  one D3 heatmap.
- Index the activity query path (`projectId`, `createdAt`) after validating
  with `EXPLAIN ANALYZE` on seeded data.

### Phase 7 — Containerization
- Multi-stage Dockerfiles, `/health/live` and `/health/ready` (`@nestjs/terminus`
  with a real DB check), `docker-compose.yml` for local full stack.

### Phase 8 — Kubernetes
- Self-authored Helm chart: Deployments (frontend + backend), Service, Ingress,
  ConfigMap + Secret, HPA, PostgreSQL StatefulSet + PVC. Run on `minikube`.
- Init containers wait for Postgres TCP and for migrations to finish before
  the backend serves traffic.

### Phase 9 — CI
- GitHub Actions: run backend + frontend tests on push, build Docker images.

## Definition of done

- Full-stack app runnable via Docker Compose and demoable on minikube.
- README with architecture diagram and engineering notes covering the main
  edge cases found and fixed during development.
