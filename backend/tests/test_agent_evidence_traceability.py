"""Covers evidence_ids traceability on the governance-JSON finding path.

Previously ``finding()`` only set evidence_ids from a single matched
MetricResult; the governance-JSON path (used whenever an agent's LLM call
succeeds) had no other source, so a finding whose cited metric_id didn't
match anything real — the common case for a hallucinated/omitted metric_id —
silently got empty evidence_ids, breaking traceability from a verdict back to
a specific evidence record. ``finding()`` now accepts an explicit override,
and each agent's ``_findings_from_governance`` falls back to the combined
evidence of the metrics it actually reviewed.
"""

from uuid import uuid4

from app.models.enums import MetricResultStatus
from app.models.evidence import MetricResult
from app.services.agents.base import AgentContext
from app.services.agents.model_backed.bias_agent import _findings_from_governance


def _metric_result(metric_id: str, evidence_id: str) -> MetricResult:
    return MetricResult(
        run_id=uuid4(),
        metric_id=metric_id,
        dimension="fairness",
        tool_name="deepeval",
        status=MetricResultStatus.passed,
        raw_score=0.9,
        normalized_score=0.9,
        threshold=0.8,
        passed=True,
        evidence_ids=[evidence_id],
    )


def _context(metric_results: list[MetricResult]) -> AgentContext:
    return AgentContext(
        ai_system=None,
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=metric_results,
        existing_findings=[],
    )


def test_finding_evidence_ids_come_from_the_matched_metric() -> None:
    metric = _metric_result("CM-017", "evidence-1")
    context = _context([metric])

    findings = _findings_from_governance(
        [{"title": "Fairness gap", "summary": "...", "metric_id": "CM-017"}],
        context,
        tool_calls_payload=[],
        reviewed_metrics=[metric],
    )

    assert findings[0].evidence_ids == ["evidence-1"]


def test_finding_evidence_ids_fall_back_to_reviewed_metrics_when_metric_id_unmatched() -> None:
    reviewed = [_metric_result("CM-017", "evidence-1"), _metric_result("CM-018", "evidence-2")]
    context = _context(reviewed)

    # The LLM cites no metric_id (or one that doesn't exist) — this is the
    # common case that used to produce empty evidence_ids.
    findings = _findings_from_governance(
        [{"title": "Fairness gap", "summary": "...", "metric_id": None}],
        context,
        tool_calls_payload=[],
        reviewed_metrics=reviewed,
    )

    assert findings[0].evidence_ids == ["evidence-1", "evidence-2"]
