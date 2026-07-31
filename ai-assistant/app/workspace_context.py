"""
Workspace-scoped reads for AI proposal context (not for RAG ranking).

Every query filters by workspace_id inside SQL — same IDOR class of bug
as retrieval.py if the filter were omitted.
"""

from __future__ import annotations

from typing import Optional

from app.db import get_pool


async def fetch_workspace_projects(workspace_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, name
        FROM projects
        WHERE "workspaceId" = $1
        ORDER BY "createdAt" ASC
        """,
        workspace_id,
    )
    return [{"id": r["id"], "name": r["name"]} for r in rows]


async def fetch_workspace_members(workspace_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT u.id, u.name, u.email
        FROM workspace_members wm
        JOIN users u ON u.id = wm."userId"
        WHERE wm."workspaceId" = $1
        ORDER BY u.name ASC
        """,
        workspace_id,
    )
    return [
        {"userId": r["id"], "name": r["name"], "email": r["email"]}
        for r in rows
    ]


async def fetch_project_tasks(
    workspace_id: str,
    project_id: str,
    limit: int = 100,
) -> list[dict]:
    """
    Live task list for the board the user is viewing.
    Statuses come from Postgres (not embeddings) so the model cannot
    invent "all DONE" when an IN_PROGRESS row still exists.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT t.id, t."projectId", p.name AS project_name,
               t.title, t.description, t.status,
               t."assigneeId", u.name AS assignee_name
        FROM tasks t
        JOIN projects p ON p.id = t."projectId"
        LEFT JOIN users u ON u.id = t."assigneeId"
        WHERE p."workspaceId" = $1
          AND t."projectId" = $2
        ORDER BY t.status ASC, t."order" ASC
        LIMIT $3
        """,
        workspace_id,
        project_id,
        limit,
    )
    return [
        {
            "id": r["id"],
            "projectId": r["projectId"],
            "projectName": r["project_name"],
            "title": r["title"],
            "description": r["description"] or "",
            "status": r["status"],
            "assigneeName": r["assignee_name"],
        }
        for r in rows
    ]


def _status_counts(tasks: list[dict]) -> dict[str, int]:
    counts = {"TODO": 0, "IN_PROGRESS": 0, "IN_REVIEW": 0, "DONE": 0}
    for t in tasks:
        status = t.get("status")
        if status in counts:
            counts[status] += 1
    return counts


async def search_tasks_by_keywords(
    workspace_id: str,
    keywords: list[str],
    limit: int = 50,
) -> list[dict]:
    """ILIKE search on title/description for mutation proposals."""
    cleaned = [k.strip() for k in keywords if k and k.strip()]
    if not cleaned:
        return []

    pool = await get_pool()
    # Build OR of title/description ILIKE for each keyword.
    clauses: list[str] = []
    args: list[object] = [workspace_id]
    for kw in cleaned[:5]:
        args.append(f"%{kw}%")
        idx = len(args)
        clauses.append(f'(t.title ILIKE ${idx} OR t.description ILIKE ${idx})')

    where_extra = " OR ".join(clauses)
    args.append(limit)
    limit_idx = len(args)

    rows = await pool.fetch(
        f"""
        SELECT t.id, t."projectId", p.name AS project_name,
               t.title, t.description, t.status,
               t."assigneeId", u.name AS assignee_name, u.email AS assignee_email
        FROM tasks t
        JOIN projects p ON p.id = t."projectId"
        LEFT JOIN users u ON u.id = t."assigneeId"
        WHERE p."workspaceId" = $1
          AND ({where_extra})
        ORDER BY t."updatedAt" DESC
        LIMIT ${limit_idx}
        """,
        *args,
    )

    return [
        {
            "id": r["id"],
            "projectId": r["projectId"],
            "projectName": r["project_name"],
            "title": r["title"],
            "description": r["description"] or "",
            "status": r["status"],
            "assigneeId": r["assigneeId"],
            "assigneeName": r["assignee_name"],
            "assigneeEmail": r["assignee_email"],
        }
        for r in rows
    ]


def extract_keywords(question: str) -> list[str]:
    """Lightweight keyword hints for SQL search (not NLP)."""
    stop = {
        "the",
        "a",
        "an",
        "and",
        "or",
        "to",
        "in",
        "on",
        "all",
        "tasks",
        "task",
        "project",
        "projects",
        "move",
        "set",
        "make",
        "please",
        "with",
        "from",
        "into",
        "that",
        "this",
        "are",
        "is",
        "of",
        "for",
        "user",
        "users",
        "duplicate",
        "duplicates",
        "delete",
        "remove",
        "keep",
        "only",
        "one",
        "leave",
        "find",
        "same",
        "name",
        "names",
        "progress",
        "completed",
        "done",
        "todo",
        "review",
        "status",
        "open",
        "go",
        "navigate",
    }
    tokens = []
    for raw in question.replace('"', " ").replace("'", " ").split():
        t = raw.strip().lower()
        t = "".join(ch for ch in t if ch.isalnum() or ch in "-_")
        if len(t) < 3 or t in stop:
            continue
        if t not in tokens:
            tokens.append(t)
    return tokens[:8]


async def build_workspace_catalog(
    workspace_id: str,
    question: str,
    current_project_id: Optional[str] = None,
) -> str:
    """Catalog used by BOTH answer and proposal LLM calls."""
    projects = await fetch_workspace_projects(workspace_id)
    members = await fetch_workspace_members(workspace_id)
    keywords = extract_keywords(question)
    keyword_tasks = await search_tasks_by_keywords(workspace_id, keywords)

    current_project_tasks: list[dict] = []
    if current_project_id:
        current_project_tasks = await fetch_project_tasks(
            workspace_id, current_project_id
        )

    lines = ["<workspace_catalog>"]

    if current_project_id:
        current = next(
            (p for p in projects if p["id"] == current_project_id),
            None,
        )
        if current:
            lines.append(
                f'<current_project id="{current["id"]}" name="{current["name"]}" />'
            )
        else:
            lines.append(
                f'<current_project id="{current_project_id}" name="(unknown)" />'
            )

        counts = _status_counts(current_project_tasks)
        lines.append(
            "current_project_task_counts: "
            + " ".join(f"{k}={v}" for k, v in counts.items())
            + f" total={len(current_project_tasks)}"
        )
        lines.append("current_project_tasks:")
        if current_project_tasks:
            for t in current_project_tasks:
                lines.append(
                    f'- id={t["id"]} [{t["status"]}] {t["title"]}: '
                    f'{t["description"]} '
                    f'(assignee={t["assigneeName"] or "none"})'
                )
        else:
            lines.append("- (none)")

    lines.append("projects:")
    if projects:
        for p in projects:
            lines.append(f'- id={p["id"]} name={p["name"]}')
    else:
        lines.append("- (none)")

    lines.append("members:")
    if members:
        for m in members:
            lines.append(
                f'- userId={m["userId"]} name={m["name"]} email={m["email"]}'
            )
    else:
        lines.append("- (none)")

    lines.append("keyword_matched_tasks:")
    if keyword_tasks:
        for t in keyword_tasks:
            lines.append(
                f'- id={t["id"]} projectId={t["projectId"]} '
                f'projectName={t["projectName"]} [{t["status"]}] '
                f'{t["title"]}: {t["description"]} '
                f'(assignee={t["assigneeName"] or "none"})'
            )
    else:
        lines.append("- (none)")
    lines.append("</workspace_catalog>")
    return "\n".join(lines)


# Back-compat alias used by older imports / tests.
async def build_proposal_context(workspace_id: str, question: str) -> str:
    return await build_workspace_catalog(workspace_id, question)
