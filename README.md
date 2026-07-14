# Task Tracker

Full-stack Kanban task tracker — NestJS + Prisma + PostgreSQL backend,
Next.js + Zustand + dnd-kit frontend, real-time board updates via Socket.io,
analytics dashboard, containerized and deployed to Kubernetes via a
self-authored Helm chart.

See `PROJECT_PLAN.md` for the full phased build plan, the reasoning behind
every tech choice, and — most importantly — the "Hunt for" note in each
phase: a deliberate edge case to find and fix, not just a feature to ship.
That's the part worth talking about in an interview.

## Getting started (Phase 0)

### Prerequisites
- Node.js 20+
- Docker (for local Postgres)
- Cursor, with this repo opened at its root so `.cursor/rules/*.mdc` loads
  automatically

### 1. Start the database
```bash
docker compose up -d
```

### 2. Backend setup
```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run start:dev
```
Backend runs on `http://localhost:3001`. Once the health module exists
(Phase 7), `GET /health/live` should return 200.

### 3. Frontend setup
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
Frontend runs on `http://localhost:3000`.

## Repo structure

```
task-tracker/
├── PROJECT_PLAN.md          # the actual plan — read this first
├── docker-compose.yml         # local Postgres only (K8s comes in Phase 8)
├── .cursor/rules/*.mdc          # Cursor AI rules — auto-loaded, scoped by path
├── backend/                       # NestJS API
│   └── prisma/schema.prisma         # source of truth for the data model
└── frontend/                        # Next.js app
```

## Working with Cursor on this repo

The `.cursor/rules/` directory contains five rule files that load
automatically based on which files you're editing:

- `000-general.mdc` — always applied, project context and working agreement
- `010-backend-nestjs.mdc` — applies to `backend/**/*.ts`
- `020-frontend-nextjs.mdc` — applies to `frontend/**/*.tsx` and `.ts`
- `030-security.mdc` — always applied, non-negotiable security rules
- `040-git-commits.mdc` — commit message conventions

Cursor picks these up automatically as long as you open the repo root as
your workspace. No extra setup needed — just start prompting inside
`backend/` or `frontend/` files and the relevant rules apply.

## Suggested prompts to kick off each phase in Cursor

Paste these into Cursor chat once you're in the right folder — they reference
the plan and rules so Cursor has full context:

**Phase 1 (backend/):**
> Implement Phase 1 from PROJECT_PLAN.md — the auth module. Follow
> 010-backend-nestjs.mdc and 030-security.mdc. Include the refresh-token
> revocation check called out in the "Hunt for" note, with a test for it.

**Phase 3 (backend/):**
> Implement Phase 3 from PROJECT_PLAN.md — tasks and the reorder endpoint.
> Before finalizing, deliberately write a test that simulates two concurrent
> reorder calls and show me it failing, then fix it and show the fix.

**Phase 5 (frontend/):**
> Implement Phase 5 from PROJECT_PLAN.md — the Kanban board with dnd-kit and
> Zustand. Implement the optimistic-update rollback described in the
> "Hunt for" note, including a visible error state on failure.

Keep doing this per phase — always point Cursor at the specific "Hunt for"
note, don't let it stop at the happy path.

## Engineering notes (fill this in as you go)

Once you've found and fixed the deliberate edge cases in each phase, write
2-3 sentences here about each one: what could go wrong, why, what you did.
This section is what you actually walk an interviewer through.

- Phase 1 (auth):
- Phase 2 (RBAC):
- Phase 3 (reorder race condition):
- Phase 4 (WebSocket reconnect):
- Phase 5 (optimistic rollback):
- Phase 6 (query performance):
- Phase 7 (health checks):
- Phase 8 (K8s startup ordering):
