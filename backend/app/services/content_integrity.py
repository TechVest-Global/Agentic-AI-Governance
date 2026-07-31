"""Content-integrity digests for evidence the audit ledger summarizes.

The ledger's hash chain (see ``audit_ledger.verify_ledger_chain``) proves the
ledger ROWS themselves were not altered, deleted, or reordered — it says
nothing about whether the ``Finding``/``MetricResult`` rows a ledger entry
*summarizes* were changed afterward, since those live in ordinary mutable
tables. This module computes a canonical digest over the exact records a
ledger entry references at write time, so a later re-check against the
current rows can catch post-hoc tampering that the chain alone would miss.
"""

import hashlib
import json
from uuid import UUID

from sqlmodel import Session, select

from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.models.ledger import AuditLedgerEntry

_FINDING_EVENT_TYPE = "agent_execution.completed"
_METRIC_EVENT_TYPE = "metric_execution.completed"


def _canonical_hash(records: list[dict[str, object]]) -> str:
    canonical = json.dumps(records, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def finding_content_digest(findings: list[Finding]) -> str:
    records = [
        {
            "id": str(f.id),
            "title": f.title,
            "summary": f.summary,
            "severity": str(f.severity),
            "dimension": f.dimension,
            "evidence_ids": sorted(f.evidence_ids or []),
            "agent_name": f.agent_name,
        }
        for f in sorted(findings, key=lambda f: str(f.id))
    ]
    return _canonical_hash(records)


def metric_result_content_digest(metric_results: list[MetricResult]) -> str:
    records = [
        {
            "id": str(m.id),
            "metric_id": m.metric_id,
            "status": str(m.status),
            "raw_score": m.raw_score,
            "normalized_score": m.normalized_score,
            "passed": m.passed,
            "evidence_ids": sorted(m.evidence_ids or []),
        }
        for m in sorted(metric_results, key=lambda m: str(m.id))
    ]
    return _canonical_hash(records)


def verify_content_integrity(session: Session, *, run_id: UUID) -> dict[str, object]:
    """Recompute digests from CURRENT rows and compare to what was ledgered.

    Only checks the specific records referenced by each event's recorded ID
    list, not "every Finding/MetricResult for this run" — later remediation
    passes legitimately add more findings, which must not read as tampering.
    Returns ``{"valid": bool, "checks": [...]}``; an event type with no
    recorded digest yet (run hasn't reached that phase) is skipped, not
    treated as a failure.
    """
    checks: list[dict[str, object]] = []
    overall_valid: bool | None = None

    for event_type, id_key, digest_fn, model in (
        (_FINDING_EVENT_TYPE, "finding_ids", finding_content_digest, Finding),
        (_METRIC_EVENT_TYPE, "metric_result_ids", metric_result_content_digest, MetricResult),
    ):
        entry = session.exec(
            select(AuditLedgerEntry)
            .where(AuditLedgerEntry.run_id == run_id)
            .where(AuditLedgerEntry.event_type == event_type)
            .order_by(AuditLedgerEntry.sequence_number.desc())
        ).first()
        if entry is None or not (entry.payload or {}).get("content_digest"):
            continue

        recorded_ids: list[str] = entry.payload.get(id_key) or []
        recorded_digest = entry.payload.get("content_digest")
        rows: list = []
        if recorded_ids:
            rows = list(
                session.exec(
                    select(model).where(model.id.in_([UUID(i) for i in recorded_ids]))
                ).all()
            )
        missing_ids = sorted(set(recorded_ids) - {str(row.id) for row in rows})
        current_digest = digest_fn(rows)
        valid = current_digest == recorded_digest and not missing_ids
        overall_valid = valid if overall_valid is None else (overall_valid and valid)
        checks.append(
            {
                "event_type": event_type,
                "valid": valid,
                "missing_ids": missing_ids,
                "reason": (
                    None
                    if valid
                    else ("missing_records" if missing_ids else "digest_mismatch")
                ),
            }
        )

    return {"valid": overall_valid, "checks": checks}
