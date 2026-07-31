"""Unit tests for conversation history helpers."""

from app.generation import (
    effective_question_for_guards,
    format_conversation_history,
    is_short_confirmation,
    retrieval_query,
)


def test_short_confirmation_detection():
    assert is_short_confirmation("yes")
    assert is_short_confirmation("Да")
    assert is_short_confirmation("go ahead")
    assert not is_short_confirmation("yes, but only TODO")


def test_effective_question_folds_prior_user_ask():
    history = [
        {"role": "user", "content": "assign Vadim to all tasks"},
        {
            "role": "assistant",
            "content": "Shall I assign Vadim to all 5 tasks?",
        },
    ]
    assert (
        effective_question_for_guards("yes", history)
        == "assign Vadim to all tasks\nyes"
    )


def test_retrieval_query_enriches_yes():
    history = [
        {"role": "user", "content": "assign Vadim to all Auth tasks"},
        {"role": "assistant", "content": "Confirm?"},
    ]
    q = retrieval_query("yes", history)
    assert "assign Vadim" in q
    assert "yes" in q


def test_format_conversation_history():
    block = format_conversation_history(
        [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
    )
    assert "<conversation_history>" in block
    assert "User: hi" in block
    assert "Assistant: hello" in block
