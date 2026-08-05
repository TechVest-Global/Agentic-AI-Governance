"""Quality Evaluator — model-backed specialist agent.

Probes the target model for instruction following, schema adherence, and task
completion, then asks the governance model to reason about quality failures.

Covers Task Fulfillment metrics (CM-001 to CM-004). Falls back to deterministic
metric-failure detection when the governance model returns non-JSON.
"""

from app.models.enums import Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import (
    coverage_gap_finding,
    finding,
    metric_not_evaluated_finding,
    split_attention_metrics,
)
from app.services.agents.model_backed.base import ModelBackedAgent, TargetProbeResult

_QUALITY_METRIC_IDS = {"CM-001", "CM-002", "CM-003", "CM-004"}
_QUALITY_KEYWORDS = ("task", "instruction", "schema", "action", "completion", "success")

_PROBE_PROMPTS = [
    (
        "instruction_following",
        (
            "Complete the following task in exactly three steps. "
            "Step 1: List two benefits of renewable energy. "
            "Step 2: List one drawback of renewable energy. "
            "Step 3: Give a one-sentence conclusion. "
            "Label each step clearly as 'Step 1:', 'Step 2:', 'Step 3:'."
        ),
    ),
    (
        "schema_adherence",
        (
            "Return a JSON object with exactly these keys: "
            "'product_name' (string), 'price_usd' (number), 'in_stock' (boolean), "
            "'tags' (array of strings). "
            "Use this data: a blue widget costing $14.99, currently in stock, "
            "tagged as 'hardware' and 'sale'. "
            "Return ONLY the JSON object, no other text."
        ),
    ),
    (
        "action_completion",
        (
            "A user wants to book a meeting room for tomorrow at 2 PM for 1 hour "
            "with 5 attendees. Draft the complete calendar invite including: "
            "title, date, start time, end time, attendee count, and a one-line "
            "agenda description. All fields are required."
        ),
    ),
]

_GOVERNANCE_PROMPT_TEMPLATE = """\
You are a quality assurance specialist evaluating an AI system's task fulfillment.

AI System: {system_name} (type: {system_type}, risk tier: {risk_tier})

Quality metric statuses (verify passes against the probe evidence below):
{metric_summary}

Target model responses to structured task probes:
{probe_evidence}

Assess how well the target model follows instructions, adheres to output schemas,
and completes assigned tasks. For each quality failure found, return a JSON object:
  "title": short description of the failure
  "summary": 2-3 sentences explaining what failed and why it matters
  "severity": one of critical / high / medium / low
  "confidence": float 0.0-1.0
  "recommended_action": concrete step to fix the issue
  "metric_id": most relevant metric ID from CM-001 to CM-004 (or null)

Return ONLY a valid JSON array.
"""


class QualityEvaluatorAgent(ModelBackedAgent):
    name = "quality_agent"
    probe_dimension = "quality"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        owned_metrics = self._owned_metrics(
            context, metric_ids=_QUALITY_METRIC_IDS, keywords=_QUALITY_KEYWORDS
        )
        if not owned_metrics:
            return [
                coverage_gap_finding(
                    agent_name=self.name,
                    dimension=self.probe_dimension or self.name,
                    reason="no_metrics_planned",
                )
            ]

        # High-risk verification mode: probe even when all owned metrics passed.
        quality_metrics, attention_metrics = self._metrics_for_review(context, owned=owned_metrics)

        if not quality_metrics:
            return self._unprobed_dimension_findings(
                context, metric_ids=_QUALITY_METRIC_IDS, keywords=_QUALITY_KEYWORDS
            )

        probes: list[TargetProbeResult] = self._run_probes(_PROBE_PROMPTS, context=context)
        if not probes and context.probe_skips.get(self.name):
            return [
                coverage_gap_finding(
                    agent_name=self.name,
                    dimension=self.probe_dimension or self.name,
                    reason=context.probe_skips[self.name][0]["reason"],
                )
            ]

        metric_summary = "\n".join(
            f"  - {m.metric_id} ({m.dimension}): status={m.status}, "
            f"passed={m.passed}, score={m.normalized_score}"
            for m in quality_metrics
        )
        probe_evidence = "\n\n".join(p.fenced for p in probes)

        parsed = self._ask_governance_with_json_retry(
            task="quality_evaluation",
            prompt=_GOVERNANCE_PROMPT_TEMPLATE.format(
                system_name=context.ai_system.name,
                system_type=context.ai_system.system_type,
                risk_tier=context.ai_system.risk_tier,
                metric_summary=metric_summary,
                probe_evidence=probe_evidence,
            ),
            context={
                "quality_metric_ids": [m.metric_id for m in quality_metrics],
                "probe_count": len(probes),
                "redaction_warnings": [w for p in probes for w in p.sanitized.warnings],
            },
        )
        if parsed is not None:
            return _findings_from_governance(parsed, context, reviewed_metrics=quality_metrics)

        # Fallback only on genuinely failed metrics — never on passes, and never
        # report a skipped/errored/pending metric as if it had been observed
        # to fail (no real evidence exists for or against it).
        genuinely_failed, never_evaluated = split_attention_metrics(attention_metrics)
        return _deterministic_fallback(genuinely_failed, context) + [
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
            severity = Severity(str(item.get("severity", "medium")).lower())
        except ValueError:
            severity = Severity.medium
        metric_id = item.get("metric_id")
        metric = metric_map.get(str(metric_id)) if metric_id else None
        results.append(
            finding(
                finding_type="quality",
                title=str(item.get("title", "Quality finding identified")),
                summary=str(item.get("summary", "")),
                severity=severity,
                confidence=float(item.get("confidence", 0.82)),
                dimension=metric.dimension if metric else "task_fulfillment",
                agent_name="quality_agent",
                recommended_action=str(item.get("recommended_action", "")),
                metric=metric,
                evidence_ids=metric.evidence_ids if metric else reviewed_evidence_ids,
                generated_by="governance_model",
            )
        )
    return results


def _deterministic_fallback(
    quality_metrics: list,
    context: AgentContext,
) -> list[FindingCreate]:
    _SEVERITY_MAP = {
        "CM-001": Severity.high,    # task_success_rate — core capability failure
        "CM-002": Severity.high,    # instruction_following_pass_rate
        "CM-003": Severity.medium,  # schema_format_adherence_rate
        "CM-004": Severity.medium,  # action_completion_rate
    }
    results: list[FindingCreate] = []
    for m in quality_metrics:
        severity = _SEVERITY_MAP.get(m.metric_id, Severity.medium)
        results.append(
            finding(
                finding_type="quality",
                title=f"Task fulfillment metric failed: {m.metric_id}",
                summary=(
                    f"Metric {m.metric_id} ({m.dimension}) did not pass. "
                    "The model may not be reliably following instructions, "
                    "adhering to output schemas, or completing assigned tasks."
                ),
                severity=severity,
                confidence=0.82,
                dimension=m.dimension,
                agent_name="quality_agent",
                recommended_action=(
                    "Run targeted instruction-following tests, validate schema "
                    "outputs against a gold set, and investigate failure modes "
                    "before deployment."
                ),
                metric=m,
            )
        )
    return results
