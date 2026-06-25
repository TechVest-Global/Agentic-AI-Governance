"""Synthesis Agent — Layer 4, first pass.

Reads all specialist findings and metric results for the run and produces
a unified narrative memo. The memo is passed verbatim to the Devil's
Advocate; the Verdict Agent reads it directly (not through the objections).

Structured output contract (JSON):
  narrative     str   — 3-5 sentence unified finding summary
  risk_summary  str   — 1-2 sentence headline of the dominant risk signal
  dimensions    list  — risk dimensions covered, e.g. ["fairness", "robustness"]
  sample_sizes  dict  — {agent_name: probe_count} for adequacy cross-check
  conflicts     list  — detected cross-finding conflicts, empty if none
  iteration     int   — which remediation pass produced this memo
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.configs.prompt_registry import PromptRegistry, render
from app.models.enums import Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ID = "synthesis_agent.council_memo"
_PHASE_HASH = "19028d831194c8c6b49dea8a78ad5f4ebf6028ca914a4441f62d29e8ca27b194"

_SEVERITY_WEIGHT = {
    Severity.info: 1,
    Severity.low: 2,
    Severity.medium: 3,
    Severity.high: 4,
    Severity.critical: 5,
}


@dataclass
class SynthesisMemo:
    narrative: str
    risk_summary: str
    dimensions: list[str]
    sample_sizes: dict[str, int]
    conflicts: list[str]
    iteration: int
    raw_response: str


def _format_findings(findings: list[Finding], iteration: int) -> str:
    if not findings:
        return "  (none)"
    # For re-probe iterations, the caller passes only the latest-per-agent findings.
    lines = []
    for f in findings:
        lines.append(
            f"  [{f.agent_name or 'unknown'} | {f.severity} | {f.dimension}] "
            f"{f.title}: {f.summary}"
        )
        if f.recommended_action:
            lines.append(f"    → Recommended action: {f.recommended_action}")
    return "\n".join(lines)


def _format_metrics(metrics: list[MetricResult]) -> str:
    if not metrics:
        return "  (none)"
    lines = []
    for m in metrics:
        status_str = f"status={m.status}"
        score_str = f"score={m.normalized_score:.3f}" if m.normalized_score is not None else "score=N/A"
        passed_str = f"passed={m.passed}"
        lines.append(f"  [{m.metric_id} | {m.dimension}] {status_str}, {score_str}, {passed_str}")
    return "\n".join(lines)


def _parse_memo(content: str, iteration: int) -> SynthesisMemo:
    """Extract structured memo from governance model response."""
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start == -1 or end == 0:
            raise ValueError("No JSON object found")
        data = json.loads(content[start:end])
        return SynthesisMemo(
            narrative=str(data.get("narrative", "Evidence synthesis not available.")),
            risk_summary=str(data.get("risk_summary", "Risk level indeterminate.")),
            dimensions=list(data.get("dimensions", [])),
            sample_sizes={str(k): int(v) for k, v in data.get("sample_sizes", {}).items()},
            conflicts=list(data.get("conflicts", [])),
            iteration=int(data.get("iteration", iteration)),
            raw_response=content,
        )
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        logger.warning("SynthesisAgent: could not parse governance response: %s", exc)
        return _fallback_memo(iteration, content)


def _fallback_memo(iteration: int, raw: str) -> SynthesisMemo:
    return SynthesisMemo(
        narrative=(
            "Governance model returned a non-structured response. "
            "Evidence review was attempted but structured synthesis is unavailable. "
            "Manual review recommended."
        ),
        risk_summary="Risk level indeterminate — governance model response unparseable.",
        dimensions=[],
        sample_sizes={},
        conflicts=["Synthesis agent returned non-JSON; evidence may be incomplete."],
        iteration=iteration,
        raw_response=raw,
    )


class SynthesisAgent:
    """Council Synthesis Agent.

    Accepts the latest-iteration findings (caller must apply
    'latest per agent' read rule) and all metric results, then
    produces a SynthesisMemo via the governance LLM.
    Falls back to a DEGRADED memo if the LLM fails completely.
    """

    name = "synthesis_agent"

    def __init__(
        self,
        governance_client: GovernanceModelClient,
        registry: PromptRegistry | None = None,
    ) -> None:
        self._governance = governance_client
        self._registry = registry or PromptRegistry.from_directory()

    def synthesize(
        self,
        *,
        findings: list[Finding],
        metric_results: list[MetricResult],
        iteration: int,
    ) -> SynthesisMemo:
        findings_text = _format_findings(findings, iteration)
        metrics_text = _format_metrics(metric_results)

        template = self._registry.get(_TEMPLATE_ID, _PHASE_HASH)
        prompt = render(template, {
            "iteration": str(iteration),
            "findings_text": findings_text,
            "metrics_text": metrics_text,
        })

        try:
            response = self._governance.complete(
                GovernanceModelRequest(
                    task="council_synthesis",
                    prompt=prompt,
                    context={
                        "iteration": iteration,
                        "finding_count": len(findings),
                        "metric_count": len(metric_results),
                        "agents": list({f.agent_name for f in findings if f.agent_name}),
                    },
                )
            )
            return _parse_memo(response.content, iteration)
        except Exception as exc:
            logger.error("SynthesisAgent: governance call failed: %s", exc)
            return _fallback_memo(iteration, str(exc))
