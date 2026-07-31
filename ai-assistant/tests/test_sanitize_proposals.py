"""Unit tests for proposal sanitization (no API calls)."""

from app.generation import sanitize_proposals


def test_sanitize_keeps_allowlisted_proposals():
    raw = {
        "proposals": [
            {
                "type": "update_task",
                "summary": "Move SSL",
                "taskId": "t1",
                "patch": {"status": "IN_PROGRESS", "bogus": 1},
            },
            {
                "type": "create_task",
                "summary": "Add task",
                "projectId": "p1",
                "title": "New",
                "status": "TODO",
                "assigneeId": "user-1",
            },
            {
                "type": "create_project",
                "summary": "Billing",
                "name": "Billing",
            },
            {"type": "delete_task", "summary": "nope", "taskId": "t2"},
            {
                "type": "update_task",
                "summary": "Assign Vadim",
                "taskId": "t3",
                "patch": {"assigneeId": "user-vadim"},
            },
            {
                "type": "update_task",
                "summary": "Unassign",
                "taskId": "t4",
                "patch": {"assigneeId": None},
            },
        ]
    }

    cleaned = sanitize_proposals(raw)
    assert cleaned == [
        {
            "type": "update_task",
            "summary": "Move SSL",
            "taskId": "t1",
            "patch": {"status": "IN_PROGRESS"},
        },
        {
            "type": "create_task",
            "summary": "Add task",
            "projectId": "p1",
            "title": "New",
            "status": "TODO",
            "assigneeId": "user-1",
        },
        {
            "type": "create_project",
            "summary": "Billing",
            "name": "Billing",
        },
        {
            "type": "update_task",
            "summary": "Assign Vadim",
            "taskId": "t3",
            "patch": {"assigneeId": "user-vadim"},
        },
        {
            "type": "update_task",
            "summary": "Unassign",
            "taskId": "t4",
            "patch": {"assigneeId": None},
        },
    ]


def test_sanitize_invalid_json_shape_returns_empty():
    assert sanitize_proposals(None) == []
    assert sanitize_proposals({"proposals": "x"}) == []
    assert sanitize_proposals({"proposals": [{"type": "update_task"}]}) == []


def test_sanitize_caps_at_five():
    raw = {
        "proposals": [
            {
                "type": "create_project",
                "summary": f"P{i}",
                "name": f"P{i}",
            }
            for i in range(8)
        ]
    }
    assert len(sanitize_proposals(raw)) == 5


def test_sanitize_bulk_update_and_dedupe():
    raw = {
        "proposals": [
            {
                "type": "bulk_update_tasks",
                "summary": 'Move auth tasks to IN_PROGRESS',
                "filter": {
                    "titleContains": "auth",
                    "descriptionContains": "auth",
                },
                "patch": {"status": "IN_PROGRESS"},
            },
            {
                "type": "bulk_update_tasks",
                "summary": "Assign Vadim to project tasks",
                "filter": {"projectId": "p-auth"},
                "patch": {"assigneeId": "user-vadim"},
            },
            {
                "type": "bulk_update_tasks",
                "summary": "bad empty filter",
                "filter": {},
                "patch": {"status": "DONE"},
            },
            {
                "type": "dedupe_projects",
                "summary": "Remove duplicate Auth projects",
                "keep": "oldest",
            },
        ]
    }
    cleaned = sanitize_proposals(raw)
    assert cleaned == [
        {
            "type": "bulk_update_tasks",
            "summary": 'Move auth tasks to IN_PROGRESS',
            "filter": {
                "titleContains": "auth",
                "descriptionContains": "auth",
            },
            "patch": {"status": "IN_PROGRESS"},
        },
        {
            "type": "bulk_update_tasks",
            "summary": "Assign Vadim to project tasks",
            "filter": {"projectId": "p-auth"},
            "patch": {"assigneeId": "user-vadim"},
        },
        {
            "type": "dedupe_projects",
            "summary": "Remove duplicate Auth projects",
            "keep": "oldest",
        },
    ]


def test_sanitize_bulk_delete_delete_project_navigate():
    raw = {
        "proposals": [
            {
                "type": "bulk_delete_tasks",
                "summary": "Delete all tasks in Auth",
                "filter": {"projectId": "p-auth"},
            },
            {
                "type": "bulk_delete_tasks",
                "summary": "bad empty",
                "filter": {},
            },
            {
                "type": "delete_project",
                "summary": "Delete Auth project",
                "projectId": "p-auth",
            },
            {
                "type": "navigate_to_project",
                "summary": "Open Payments",
                "projectId": "p-pay",
            },
            {
                "type": "bulk_update_tasks",
                "summary": "Done in project by name",
                "filter": {"projectName": "Auth & Security"},
                "patch": {"status": "DONE"},
            },
        ]
    }
    cleaned = sanitize_proposals(raw)
    assert cleaned == [
        {
            "type": "bulk_delete_tasks",
            "summary": "Delete all tasks in Auth",
            "filter": {"projectId": "p-auth"},
        },
        {
            "type": "delete_project",
            "summary": "Delete Auth project",
            "projectId": "p-auth",
        },
        {
            "type": "navigate_to_project",
            "summary": "Open Payments",
            "projectId": "p-pay",
        },
        {
            "type": "bulk_update_tasks",
            "summary": "Done in project by name",
            "filter": {"projectName": "Auth & Security"},
            "patch": {"status": "DONE"},
        },
    ]


def test_scope_guard_injects_current_project_and_strips_status_for_all_tasks():
    from app.generation import apply_scope_guards

    proposals = [
        {
            "type": "bulk_update_tasks",
            "summary": "Mark all TODO tasks as DONE across all projects",
            "filter": {"statusIn": ["TODO"]},
            "patch": {"status": "DONE"},
        }
    ]
    guarded = apply_scope_guards(
        proposals,
        question="можешь перенести в Done все задачи?",
        current_project_id="proj-auth",
    )
    assert guarded == [
        {
            "type": "bulk_update_tasks",
            "summary": "Update all tasks in the current project",
            "filter": {"projectId": "proj-auth"},
            "patch": {"status": "DONE"},
        }
    ]


def test_scope_guard_drops_ambiguous_workspace_wide_status_bulk():
    from app.generation import apply_scope_guards

    proposals = [
        {
            "type": "bulk_update_tasks",
            "summary": "Mark all TODO as DONE",
            "filter": {"statusIn": ["TODO"]},
            "patch": {"status": "DONE"},
        }
    ]
    guarded = apply_scope_guards(
        proposals,
        question="перенеси все задачи в Done",
        current_project_id=None,
    )
    assert guarded == []


def test_scope_guard_keeps_keyword_bulk_on_workspace():
    from app.generation import apply_scope_guards

    proposals = [
        {
            "type": "bulk_update_tasks",
            "summary": "Move auth to Done",
            "filter": {
                "titleContains": "auth",
                "descriptionContains": "auth",
            },
            "patch": {"status": "DONE"},
        }
    ]
    guarded = apply_scope_guards(
        proposals,
        question="move all auth tasks to Done",
        current_project_id=None,
    )
    assert len(guarded) == 1
    assert guarded[0]["filter"]["titleContains"] == "auth"


def test_sanitize_create_task_allows_project_name_without_id():
    raw = {
        "proposals": [
            {
                "type": "create_project",
                "summary": "New project",
                "name": "My test project",
            },
            {
                "type": "create_task",
                "summary": "Add setup task",
                "projectName": "My test project",
                "title": "Setup project structure",
            },
        ]
    }
    cleaned = sanitize_proposals(raw)
    assert cleaned[0]["type"] == "create_project"
    assert cleaned[1] == {
        "type": "create_task",
        "summary": "Add setup task",
        "projectName": "My test project",
        "title": "Setup project structure",
    }
