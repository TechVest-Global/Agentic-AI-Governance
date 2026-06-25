"""Service layer for querying LLM call logs."""

from uuid import UUID

from sqlmodel import Session, select

from app.models.llm_call_log import LLMCallLog
from app.schemas.governance import LLMCallLogRead, LLMCallLogSummary
from app.services.run_validation import get_run_or_raise


def get_llm_call_log_summary(session: Session, *, run_id: UUID) -> LLMCallLogSummary:
    get_run_or_raise(session, run_id)
    calls = list(
        session.exec(
            select(LLMCallLog)
            .where(LLMCallLog.run_id == run_id)
            .order_by(LLMCallLog.created_at.asc())
        ).all()
    )

    total_prompt = sum(c.prompt_tokens or 0 for c in calls)
    total_completion = sum(c.completion_tokens or 0 for c in calls)
    total_tokens = sum(c.total_tokens or 0 for c in calls)
    total_cost = sum(c.estimated_cost_usd or 0.0 for c in calls)

    return LLMCallLogSummary(
        run_id=run_id,
        call_count=len(calls),
        total_prompt_tokens=total_prompt,
        total_completion_tokens=total_completion,
        total_tokens=total_tokens,
        estimated_total_cost_usd=round(total_cost, 8),
        live_call_count=sum(1 for c in calls if c.client_mode == "live"),
        mock_call_count=sum(1 for c in calls if c.client_mode == "mock"),
        error_count=sum(1 for c in calls if c.status != "success"),
        calls=[LLMCallLogRead.model_validate(c) for c in calls],
    )
