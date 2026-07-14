# Task Tracker — Project Plan

A full-stack Kanban-style task tracker (Jira/Linear-lite) built to demonstrate
production-grade full-stack + DevOps skills for job interviews: NestJS backend,
Next.js frontend, real-time updates, data-viz dashboard, and a self-authored
Kubernetes deployment.

## Why this project exists

Not a tutorial clone. The goal is to be able to talk in depth, in an interview,
about specific engineering decisions, trade-offs, and bugs found and fixed —
not just list technologies. Every phase below has a "Hunt for" section: a
deliberate edge case to go looking for, because AI-generated code almost never
surfaces these on its own. Find it, understand it, fix it, write one paragraph
about it. That paragraph is worth more than the feature itself.

## Tech stack & why

| Layer | Choice | Why |
|---|---|---|
| Backend | NestJS + TypeScript | Modular, DI-based — familiar coming from Spring Boot. In-demand on the Israeli market (Node.js is a "must" in most full-stack postings). |
| ORM | Prisma | Type-safe queries, painless migrations, current standard for NestJS projects. |
| Database | PostgreSQL | Relational data (users, workspaces, projects, tasks) with real foreign keys — the right tool, not a resume-driven choice. |
| Auth | JWT (access in memory) + refresh token (httpOnly cookie) | Matches the security model already researched — demonstrable on-purpose decision, not a default. |
| Realtime | Socket.io via NestJS Gateway | Real-time board updates — rare in portfolio projects, a genuine differentiator. |
| Frontend | Next.js (App Router) | Server Components for data-heavy pages, Client Components for interactive board. Full-stack-in-one-framework story. |
| State (client) | Zustand | Lightweight UI state (drag state, optimistic updates) — already used in a real feature at work. |
| Drag & drop | @dnd-kit/core + @dnd-kit/sortable | Purpose-built for reorder/move-between-containers (see earlier comparison with react-flow). |
| Charts | Recharts (+ one hand-rolled D3 widget) | Recharts for standard charts, one D3 widget to prove deeper visualization skill — directly relevant to NVIDIA-style postings. |
| Containers | Docker (multi-stage builds) | Small, production-style images. |
| Orchestration | Kubernetes (self-authored Helm chart) | Hands-on cloud-native practice — liveness/readiness probes, HPA, Ingress, ConfigMap/Secret. |
| CI | GitHub Actions | Test-on-push, optional image build. |

## Phases

### Phase 0 — Environment setup (this kit)
- Repo skeleton, Cursor rules, Prisma schema, docker-compose for local Postgres.
- **Definition of done:** `docker compose up`, `npx prisma migrate dev`, backend
  boots, `/health/live` returns 200.

### Phase 1 — Auth module
- Register, login, JWT access token (returned in body), refresh token (httpOnly
  Secure SameSite=Strict cookie), logout (revoke refresh token), NestJS Guards.
- **Hunt for:** what happens if the refresh token is reused after logout
  (replay)? Does your revocation actually block it, or does the token still
  validate because you only deleted a DB row but didn't check it? Test it
  manually — call refresh with a logged-out token and confirm you get 401,
  not a fresh access token.

### Phase 2 — Workspaces, Projects, RBAC
- Workspace CRUD, invite members, roles (`admin` / `member`), custom `@Roles()`
  guard.
- **Hunt for:** a `member` calling the "remove workspace member" endpoint
  directly via curl/Postman, bypassing the UI. Does the guard actually block
  it, or does the UI just hide the button while the API stays open? This is
  the single most common gap between "looks secure" and "is secure."

### Phase 3 — Tasks & Kanban API
- Task CRUD, status field, `order` field for board position, a dedicated
  `PATCH /tasks/:id/reorder` endpoint (not a generic PATCH).
- **Hunt for:** the race condition. Open two browser tabs, drag two different
  cards into the same column at nearly the same time. Watch what happens to
  `order` values — do they collide? Fix it with either a DB transaction that
  re-reads and shifts order values atomically, or a fractional-index scheme
  (store order as a float, insert between two existing values instead of
  reindexing everything). Write down which you chose and why.

### Phase 4 — Realtime (WebSocket Gateway)
- Socket.io Gateway, `task:move` event, room-per-workspace so events don't
  leak across workspaces.
- **Hunt for:** what happens on reconnect after a dropped connection (turn off
  wifi for 10 seconds)? Does the client silently miss the events that happened
  while disconnected, leaving the board stale until a manual refresh? Decide
  on a reconciliation strategy (refetch board state on reconnect) and
  implement it — don't leave it broken.

### Phase 5 — Frontend core
- Auth pages, workspace/project list (Server Components), Kanban board
  (Client Component), dnd-kit integration, Zustand store for board UI state.
- **Hunt for:** optimistic update rollback. When you drag a card and the
  server request fails (simulate by killing the backend mid-drag), does the
  card silently stay in the wrong column, or does it snap back with a visible
  error? Undone optimistic updates are the #1 thing that makes an app feel
  broken without an obvious bug report.

### Phase 6 — Analytics dashboard
- `/workspaces/:id/analytics/*` endpoints (status breakdown, activity over
  time, load by assignee), Prisma `groupBy` + one raw SQL query for
  time-bucketed activity, Recharts visualizations, one hand-rolled D3 widget
  (e.g. an activity heatmap).
- **Hunt for:** query cost. Seed the DB with 5,000+ tasks (write a seed
  script), run `EXPLAIN ANALYZE` on the activity-over-time query, see if it's
  doing a sequential scan. Add the missing index, re-run, note the before/after
  timing. This single exercise is a strong, concrete interview story.

### Phase 7 — Containerization
- Multi-stage Dockerfiles for backend and frontend, `/health/live` and
  `/health/ready` endpoints (`@nestjs/terminus`), `docker-compose.yml` wiring
  everything together locally.
- **Hunt for:** a readiness probe that lies. Make `/health/ready` actually
  check the DB connection, not just return 200 unconditionally — then kill
  the DB and confirm the pod would correctly report not-ready instead of
  serving broken requests.

### Phase 8 — Kubernetes
- Self-authored Helm chart: Deployments (frontend + backend), Service,
  Ingress (path-based routing), ConfigMap + Secret, HPA, PostgreSQL
  StatefulSet + PVC. Run on `minikube` locally.
- **Hunt for:** a pod that crash-loops because the app tries to connect to
  Postgres before it's ready. Fix with an init container or proper
  readiness-gated startup — and be able to explain why this is a common
  real-world problem, not a contrived one.

### Phase 9 — CI (optional but strong)
- GitHub Actions: run backend + frontend tests on push, build Docker images.

## What "done" looks like for the portfolio

- A deployed (or at least locally demoable via minikube) full-stack app.
- A README with the architecture diagram and a short "Engineering notes"
  section listing the 5–6 edge cases you hunted down, each in 2–3 sentences:
  what could have gone wrong, why, and what you did about it.
- That notes section is the actual interview asset — more valuable than the
  code itself.
