"""Service layer for reading and writing LLM call logs."""

import logging
from uuid import UUID

from sqlmodel import Session, select

from app.db import session as db_session
from app.models.llm_call_log import LLMCallLog
from app.schemas.governance import LLMCallLogRead, LLMCallLogSummary
from app.services.run_validation import get_run_or_raise

logger = logging.getLogger(__name__)


def persist_call_log_entry(run_id: UUID, entry: dict) -> None:
    """Append one captured gateway call to llm_call_logs, on its own session.

    Called from the gateway the moment a call finishes, so a long phase's
    probes are queryable while it is still running rather than only after it
    drains. Its own short-lived session on purpose: the caller is usually a
    worker thread whose phase session is busy, and this write must be durable
    independently of whether that phase later commits or rolls back — an audit
    log of what was actually sent should survive the failure of the work that
    sent it.
    """
    # `_persisted` is bookkeeping the gateway adds AFTER a successful write; it
    # is never a column. Guarded anyway so a retry of an already-flagged entry
    # can't raise a TypeError deep inside a worker.
    fields = {k: v for k, v in entry.items() if not k.startswith("_")}
    with Session(db_session.engine) as session:
        session.add(LLMCallLog(run_id=run_id, **fields))
        session.commit()


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
