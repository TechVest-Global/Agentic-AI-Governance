"""Drift Analyst — model-backed specialist agent (P018).

Asks the governance model to reason about drift metric trends and assess whether
the system shows evidence of concept or data drift that warrants escalation.
No target probing is needed — drift analysis operates on monitoring metrics only.
Falls back to deterministic metric-failure detection in mock mode.
"""

from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding, metric_failed, metric_pending
from app.services.agents.model_backed.base import ModelBackedAgent

_DRIFT_METRIC_IDS = {"CM-030", "CM-031", "CM-032", "CM-033", "CM-034"}
_DRIFT_KEYWORDS = ("robustness", "consistency", "perturbation", "drift", "asr")

_GOVERNANCE_PROMPT_TEMPLATE = """\
You are a model monitoring specialist evaluating an AI system for drift.

AI System: {system_name} (type: {system_type}, risk tier: {risk_tier})

Drift and stability metrics:
{metric_summary}

Context profile summary:
{context_summary}

Assess whether the metric results indicate significant concept drift, data drift,
or monitoring gaps that require action. For each finding return a JSON object:
  "title": short description of the drift concern
  "summary": 2-3 sentence explanation of the risk and trend
  "severity": one of critical / high / medium / low
  "confidence": float 0.0-1.0
  "recommended_action": concrete remediation step (e.g. retrain, rollback, alert)
  "metric_id": the metric ID that triggered this (or null)

Return ONLY a valid JSON array.
"""


class DriftAnalystAgent(ModelBackedAgent):
    name = "drift_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        drift_metrics = [
            m for m in context.metric_results
            if (
                m.metric_id in _DRIFT_METRIC_IDS
                or any(k in f"{m.metric_id} {m.dimension}".lower() for k in _DRIFT_KEYWORDS)
            )
            and (metric_failed(m) or metric_pending(m))
        ]

        if not drift_metrics:
            return []

        metric_summary = "\n".join(
            f"  - {m.metric_id} ({m.dimension}): "
            f"status={m.status}, passed={m.passed}, score={m.normalized_score}, "
            f"tool={m.tool_name}"
            for m in drift_metrics
        )

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
                context_summary=context_summary,
            ),
            context={
                "drift_metric_ids": [m.metric_id for m in drift_metrics],
                "has_context_profile": context.context_profile is not None,
            },
        )
        if parsed is not None:
            return _findings_from_governance(parsed, context)

        return _deterministic_fallback(drift_metrics)


def _findings_from_governance(
    raw: list[dict[str, object]],
    context: AgentContext,
) -> list[FindingCreate]:
    results: list[FindingCreate] = []
    metric_map = {m.metric_id: m for m in context.metric_results}
    for item in raw:
        try:
            severity = Severity(str(item.get("severity", "high")).lower())
        except ValueError:
            severity = Severity.high
        metric_id = item.get("metric_id")
        metric = metric_map.get(str(metric_id)) if metric_id else None
        results.append(
            finding(
                finding_type="drift",
                title=str(item.get("title", "Drift finding identified")),
                summary=str(item.get("summary", "")),
                severity=severity,
                confidence=float(item.get("confidence", 0.76)),
                dimension=metric.dimension if metric else "reliability",
                agent_name="drift_agent",
                recommended_action=str(item.get("recommended_action", "")),
                metric=metric,
            )
        )
    return results


def _deterministic_fallback(drift_metrics: list) -> list[FindingCreate]:
    results: list[FindingCreate] = []
    for m in drift_metrics:
        if metric_failed(m):
            results.append(
                finding(
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
            )
        elif metric_pending(m):
            results.append(
                finding(
                    finding_type="drift",
                    title=f"Drift monitoring incomplete: {m.metric_id}",
                    summary=(
                        f"Metric {m.metric_id} ({m.dimension}) is pending or skipped. "
                        "Insufficient monitoring data to confirm system stability."
                    ),
                    severity=Severity.medium,
                    confidence=0.72,
                    dimension=m.dimension,
                    agent_name="drift_agent",
                    recommended_action=(
                        "Complete drift monitoring before final approval. "
                        "Ensure baseline snapshots and current distributions are available."
                    ),
                    metric=m,
                )
            )
    return results
