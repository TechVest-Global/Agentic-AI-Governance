"""Langfuse-backed metric evaluator — transparency dimension (CM-039 only).

Four metrics are catalogued under ``tool: langfuse`` (CM-039 trace_completeness,
CM-040 escalation_f1_score, CM-041 human_override_rate, CM-044
review_queue_hit_rate). Only CM-039 is scored here. Langfuse traces LLM calls
this app makes — it has no idea whether a human reviewed a decision, whether an
escalation was warranted, or whether an item reached a review queue. Scoring
the other three from Langfuse data would mean fabricating a number with no real
relationship to what the metric claims to measure, which is worse than an
honest skip (see registry.py's ``_AutoRoutingEvaluator`` docstring for why this
codebase skips rather than fabricates). All three already carry
``secondary_tool: workflow_db`` in their own catalog entry — that is the
integration they actually need, and it does not exist anywhere in this
application. They get a specific reason instead of the auto-router's generic
"no real evaluator integrated for tool 'langfuse'", since the real gap is
workflow_db, not langfuse.

CM-039 (trace_completeness) IS honestly measurable: langfuse_tracer.py counts,
for the current run, how many LLM calls were attempted and how many were
actually emitted as a Langfuse trace without error. That is real, observed data
about this run, not an estimate.

Scope limitation, stated plainly: this metric evaluates during the
metric-execution phase, which runs BEFORE the specialist-agent and
deliberation-council phases make their own LLM calls. The count available here
can only ever cover calls made up through metric-execution — see the
``scope`` field in the returned payload. A metric that claimed whole-run
completeness while only having seen part of the run would be exactly the kind
of partial-coverage-presented-as-complete result this pipeline works hard
elsewhere to avoid.
"""

from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult
from app.services.tracing import langfuse_tracer

_SUPPORTED_FORMULAS = {"trace_completeness"}

# formula -> why it needs workflow_db, an integration this app does not have.
_WORKFLOW_DB_FORMULAS = {
    "escalation_f1_score": (
        "needs ground-truth escalation labels (which cases SHOULD have "
        "escalated) — no such record exists for the audited system"
    ),
    "human_override_rate": (
        "needs a log of humans overriding the AUDITED SYSTEM's own production "
        "decisions — not to be confused with this governance tool's own "
        "Verdict.human_override_* columns, which record a human overriding "
        "THIS AUDIT'S verdict, a different thing entirely"
    ),
    "review_queue_hit_rate": (
        "needs a review-queue system recording which cases needed review and "
        "whether they reached one — no such system is integrated"
    ),
}

_TRACE_COMPLETENESS_SCOPE = (
    "Covers LLM calls captured up through the metric-execution phase of this "
    "run only. Specialist-agent and deliberation-council calls happen in "
    "later phases and are not counted — this metric evaluates before they "
    "occur."
)


class LangfuseEvaluator:
    name = "langfuse"

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        metric = evaluation_input.metric
        formula = str(metric.scoring_config.get("formula", ""))

        if formula in _WORKFLOW_DB_FORMULAS:
            return _skip_result(
                metric,
                reason=(
                    f"{formula} {_WORKFLOW_DB_FORMULAS[formula]}. Its catalogued "
                    "secondary_tool 'workflow_db' has no real integration in this "
                    "application."
                ),
            )
        if formula not in _SUPPORTED_FORMULAS:
            return _skip_result(metric, reason=f"unsupported formula: {formula}")

        if not langfuse_tracer.is_configured():
            return _skip_result(
                metric,
                reason=(
                    "Langfuse is not configured for this deployment — set "
                    "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY to enable "
                    "trace-completeness scoring"
                ),
            )
        if not langfuse_tracer.is_active():
            return _skip_result(
                metric, reason="Langfuse client failed to initialize despite being configured"
            )

        run_id = evaluation_input.run_id
        counts = langfuse_tracer.completeness_for_run(run_id) if run_id else None
        if counts is None or counts[0] == 0:
            return _skip_result(
                metric,
                reason=(
                    "no LLM calls have been logged for this run yet at the point "
                    "this metric was evaluated"
                ),
            )

        attempted, succeeded = counts
        normalized_score = succeeded / attempted
        threshold = _minimum_threshold(
            metric.threshold_rules, evaluation_input.ai_system.selected_frameworks
        )
        passed = (
            normalized_score >= threshold if threshold is not None else succeeded == attempted
        )
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed else MetricResultStatus.failed
        )

        return MetricEvaluationResult(
            source_type="langfuse_trace_completeness",
            tool_name="langfuse",
            raw_score=normalized_score,
            normalized_score=normalized_score,
            threshold=threshold,
            passed=passed,
            status=status,
            payload={
                "metric_id": metric.metric_id,
                "formula": formula,
                "traced_calls": succeeded,
                "total_calls": attempted,
                "scope": _TRACE_COMPLETENESS_SCOPE,
            },
        )


def _minimum_threshold(
    threshold_rules: dict, selected_frameworks: list[str] | None
) -> float | None:
    from app.services.evaluators.threshold import _minimum_threshold as shared_minimum_threshold

    return shared_minimum_threshold(threshold_rules, selected_frameworks=selected_frameworks)


def _skip_result(metric, *, reason: str) -> MetricEvaluationResult:
    return MetricEvaluationResult(
        source_type="langfuse_trace_completeness",
        tool_name="langfuse",
        raw_score=None,
        normalized_score=None,
        threshold=None,
        passed=None,
        status=MetricResultStatus.skipped,
        payload={"metric_id": metric.metric_id, "skipped_reason": reason},
    )
