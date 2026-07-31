"""
This test exists specifically to prevent the cross-workspace retrieval leak
described in retrieval.py's docstring — the same class of bug as the IDOR
in the task reorder endpoint, now verified for the AI assistant's
data-access path too.
"""

import pytest
from app.retrieval import retrieve_relevant_tasks


@pytest.mark.asyncio
async def test_retrieval_excludes_tasks_from_other_workspaces(
    seeded_two_workspaces,  # fixture: workspace_a with task "Fix login bug",
                             # workspace_b with task "Renew SSL certificate"
):
    workspace_a_id = seeded_two_workspaces["workspace_a_id"]
    fake_query_embedding = seeded_two_workspaces["ssl_task_embedding"]

    results = await retrieve_relevant_tasks(
        workspace_id=workspace_a_id,
        query_embedding=fake_query_embedding,
        limit=5,
    )

    titles = [r.title for r in results]

    assert "Renew SSL certificate" not in titles, (
        "Retrieval leaked a task from a different workspace into the "
        "context — the same class of bug as the earlier IDOR."
    )
