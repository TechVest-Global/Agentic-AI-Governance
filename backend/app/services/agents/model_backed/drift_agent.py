"""Drift Analyst — model-backed specialist agent (P018).

Asks the governance model to reason about drift metric trends and assess whether
the system shows evidence of concept or data drift that warrants escalation.
No target probing is needed — drift analysis operates on monitoring metrics only.
Falls back to deterministic metric-failure detection in mock mode.
"""

from app.models.enums import DriftSource, Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import (
    coverage_gap_finding,
    finding,
    metric_not_evaluated_finding,
    split_attention_metrics,
)
from app.services.agents.model_backed.base import ModelBackedAgent

_DRIFT_METRIC_IDS = {"CM-030", "CM-031", "CM-032", "CM-033", "CM-034"}
_DRIFT_KEYWORDS = ("robustness", "consistency", "perturbation", "drift", "asr")

_GOVERNANCE_PROMPT_TEMPLATE = """\
You are a model monitoring specialist evaluating an AI system for drift.

AI System: {system_name} (type: {system_type}, risk tier: {risk_tier})

Drift and stability metrics:
{metric_summary}

Prior run scores (metric_id: prior_score — null if no prior run):
{prior_summary}

Context profile summary:
{context_summary}

Assess whether the metric results indicate significant drift or monitoring gaps.
For each finding return a JSON object with these exact keys:
  "title": short description of the drift concern
  "summary": 2-3 sentence explanation of the risk and trend
  "severity": one of critical / high / medium / low
  "confidence": float 0.0-1.0
  "recommended_action": concrete remediation step (e.g. retrain, rollback, alert)
  "metric_id": the metric ID that triggered this (or null)
  "drift_source": one of model / context / data / environment / unknown
    - model: the AI model weights or version changed
    - context: the prompt template, system prompt, or RAG context changed
    - data: the input or production data distribution shifted
    - environment: infrastructure, config, or deployment changed
    - unknown: cannot determine root cause from available evidence
  "regression_flag": true if the current score is worse than the prior run score
    by more than 0.05, false otherwise

Return ONLY a valid JSON array.
"""


class DriftAnalystAgent(ModelBackedAgent):
    name = "drift_agent"
    probe_dimension = "drift"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        owned_metrics = self._owned_metrics(
            context, metric_ids=_DRIFT_METRIC_IDS, keywords=_DRIFT_KEYWORDS
        )
        if not owned_metrics:
            return [
                coverage_gap_finding(
                    agent_name=self.name,
                    dimension=self.probe_dimension,
                    reason="no_metrics_planned",
                )
            ]

        # High-risk verification mode: analyze trends even when metrics passed —
        # a passing score can still be a regression against the prior run.
        drift_metrics, attention_metrics = self._metrics_for_review(context, owned=owned_metrics)

        if not drift_metrics:
            return self._unprobed_dimension_findings(
                context, metric_ids=_DRIFT_METRIC_IDS, keywords=_DRIFT_KEYWORDS
            )

        metric_summary = "\n".join(
            f"  - {m.metric_id} ({m.dimension}): "
            f"status={m.status}, passed={m.passed}, score={m.normalized_score}, "
            f"tool={m.tool_name}"
            for m in drift_metrics
        )

        prior = context.prior_metric_scores
        prior_summary = "\n".join(
            f"  - {m.metric_id}: prior={prior.get(m.metric_id, 'null')}"
            for m in drift_metrics
        ) or "  No prior run data available."

        context_summary = "No context profile available."
        if context.context_profile is not None:
            profile = context.context_profile
            context_summary = (
                f"Model config: {profile.model_configuration}. "
                f"Integration: {profile.integration_context}."
            )

        parsed = self._ask_governance_with_json_retry(
            task="drift_analysis",
            prompt=_GOVERNANCE_PROMPT_TEMPLATE.format(
                system_name=context.ai_system.name,
                system_type=context.ai_system.system_type,
                risk_tier=context.ai_system.risk_tier,
                metric_summary=metric_summary,
                prior_summary=prior_summary,
                context_summary=context_summary,
            ),
            context={
                "drift_metric_ids": [m.metric_id for m in drift_metrics],
                "has_context_profile": context.context_profile is not None,
                "has_prior_run": bool(prior),
            },
            agent_context=context,
        )
        if parsed is not None:
            return _findings_from_governance(parsed, context, reviewed_metrics=drift_metrics)

        # Fallback only on genuinely failed metrics — never on passes, and
        # never report a skipped/errored/pending metric as observed drift. This
        # dimension had the worst evidence-free rate of any agent (67%, 49/73
        # findings) precisely because CM-030/031/032 sat permanently skipped
        # under `tool: evidently` with no real evaluator, and every skip was
        # reported as "Drift monitoring incomplete" — a finding_type="drift"
        # row with no evidence_ids, not exempt from the evidence-citation
        # invariant. metric_not_evaluated_finding is finding_type="coverage_gap"
        # instead, which IS exempt (see audit_invariants.py).
        genuinely_failed, never_evaluated = split_attention_metrics(attention_metrics)
        return _deterministic_fallback(genuinely_failed, context.prior_metric_scores) + [
            metric_not_evaluated_finding(agent_name=self.name, metric=m) for m in never_evaluated
        ]


def _findings_from_governance(
    raw: list[dict[str, object]],
    context: AgentContext,
    *,
    reviewed_metrics: list,
) -> list[FindingCreate]:
    results: list[FindingCreate] = []
    metric_map = {m.metric_id: m for m in context.metric_results}
    reviewed_evidence_ids = sorted(
        {eid for m in reviewed_metrics for eid in (m.evidence_ids or [])}
    )
    for item in raw:
        try:
            severity = Severity(str(item.get("severity", "high")).lower())
        except ValueError:
            severity = Severity.high
        try:
            drift_source = DriftSource(str(item.get("drift_source", "unknown")).lower())
        except ValueError:
            drift_source = DriftSource.unknown
        metric_id = item.get("metric_id")
        metric = metric_map.get(str(metric_id)) if metric_id else None
        regression_flag = bool(item.get("regression_flag", False))
        # Double-check regression against actual prior scores if available
        if metric and not regression_flag:
            prior_score = context.prior_metric_scores.get(metric.metric_id)
            current_score = metric.normalized_score
            if prior_score is not None and current_score is not None:
                regression_flag = (prior_score - current_score) > 0.05
        f = finding(
            finding_type="drift",
            title=str(item.get("title", "Drift finding identified")),
            summary=str(item.get("summary", "")),
            severity=severity,
            confidence=float(item.get("confidence", 0.76)),
            dimension=metric.dimension if metric else "reliability",
            agent_name="drift_agent",
            recommended_action=str(item.get("recommended_action", "")),
            metric=metric,
            evidence_ids=metric.evidence_ids if metric else reviewed_evidence_ids,
            generated_by="governance_model",
        )
        f.payload["drift_source"] = drift_source.value
        f.payload["regression_flag"] = regression_flag
        results.append(f)
    return results


def _deterministic_fallback(
    drift_metrics: list,
    prior_metric_scores: dict[str, float | None] | None = None,
) -> list[FindingCreate]:
    """Findings for genuinely failed drift metrics only.

    ``drift_metrics`` must already exclude skipped/pending/error metrics (see
    ``split_attention_metrics`` at the call site) — this function has no
    "incomplete monitoring" branch any more precisely so it never has a
    skipped metric to write that finding for.
    """
    prior = prior_metric_scores or {}
    results: list[FindingCreate] = []
    for m in drift_metrics:
        prior_score = prior.get(m.metric_id)
        current_score = m.normalized_score
        regression_flag = (
            prior_score is not None
            and current_score is not None
            and (prior_score - current_score) > 0.05
        )
        f = finding(
            finding_type="drift",
            title=f"Drift metric failed: {m.metric_id}",
            summary=(
                f"Metric {m.metric_id} ({m.dimension}) failed. "
                "The system shows evidence of statistically significant drift "
                "that may degrade model reliability and prediction quality."
            ),
            severity=Severity.high,
            confidence=0.80,
            dimension=m.dimension,
            agent_name="drift_agent",
            recommended_action=(
                "Review baseline distribution, investigate data pipeline changes, "
                "and consider retraining or rollback if drift exceeds threshold."
            ),
            metric=m,
        )
        f.payload["drift_source"] = DriftSource.unknown.value
        f.payload["regression_flag"] = regression_flag
        results.append(f)
    return results
