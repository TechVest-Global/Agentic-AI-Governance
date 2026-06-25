"""Verdict Agent — Layer 4, third pass.

Reads the synthesis memo, the objections, and the original findings and
metrics, then produces a verdict. This is the only agent that sets the
confidence score, the sufficient flag, and the remediation_type. The
router's deterministic logic is downstream of this output.

The Verdict Agent reads the synthesis DIRECTLY (not via the objections)
and weighs both. It never reads only the objections alone.

Structured output contract (JSON):
  confidence_score  float  — 0.0-1.0, raw assessment of evidence quality
  sufficient        bool   — true if evidence quality is high enough to decide
  label             str    — "approved" | "conditional_approval" | "blocked"
  action_tier       str    — "autonomous" | "supervised" | "human_review"
  reasoning         str    — 2-4 sentence verdict rationale
  remediation_type  str    — "re_deliberate" | "re_probe" | "re_plan" | null
                            (null when sufficient=true)
  target_agent      str    — agent to re-probe (only set when remediation_type=re_probe)
  objections_addressed list — list of objection_ids that were resolved
  objections_upheld  list  — list of objection_ids that remain valid concerns
  iteration_penalty float  — 0.0 when iteration=1; small deduction on later
                             iterations to record that confidence was hard-won
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from app.configs.prompt_registry import PromptRegistry, render
from app.models.enums import ActionTier, Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.services.deliberation_council.devils_advocate_agent import Objection
from app.services.deliberation_council.synthesis_agent import SynthesisMemo
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
)

logger = logging.getLogger(__name__)

_TEMPLATE_ID = "verdict_agent.council_verdict"
_PHASE_HASH = "588b5f7ada634a2212a1ae0f0014d7934b68bb05b29d0d457bdf15e54d938be8"

# Confidence below this threshold → evidence not sufficient to decide
_SUFFICIENCY_THRESHOLD = 0.65


@dataclass
class VerdictOutput:
    confidence_score: float
    sufficient: bool
    label: str
    action_tier: ActionTier
    reasoning: str
    remediation_type: str | None
    target_agent: str | None
    objections_addressed: list[str] = field(default_factory=list)
    objections_upheld: list[str] = field(default_factory=list)
    iteration_penalty: float = 0.0
    raw_response: str = ""


def _format_objections(objections: list[Objection]) -> str:
    if not objections:
        return "  (none)"
    lines = []
    for obj in objections:
        target = obj.target_agent or "general"
        lines.append(
            f"  [{obj.objection_id} | {obj.category} | target={target}]\n"
            f"    {obj.argument}\n"
            f"    → Fix: {obj.suggested_fix}\n"
            f"    → Hint: {obj.remediation_hint}"
        )
    return "\n".join(lines)


def _format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "  (none)"
    return "\n".join(
        f"  [{f.agent_name or 'unknown'} | {f.severity} | {f.dimension}] "
        f"{f.title}: {f.summary}"
        for f in findings
    )


def _format_metrics(metrics: list[MetricResult]) -> str:
    if not metrics:
        return "  (none)"
    lines = []
    for m in metrics:
        score = f"{m.normalized_score:.3f}" if m.normalized_score is not None else "N/A"
        lines.append(
            f"  [{m.metric_id} | {m.dimension}] "
            f"status={m.status}, score={score}, passed={m.passed}"
        )
    return "\n".join(lines)


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


def _safe_action_tier(label: str) -> ActionTier:
    mapping = {
        "approved": ActionTier.autonomous,
        "conditional_approval": ActionTier.supervised,
        "blocked": ActionTier.human_review,
    }
    return mapping.get(label, ActionTier.human_review)


def _parse_verdict(content: str, iteration: int) -> VerdictOutput | None:
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start == -1 or end == 0:
            return None
        data = json.loads(content[start:end])

        raw_score = float(data.get("confidence_score", 0.0))
        penalty = float(data.get("iteration_penalty", 0.0))
        # Apply penalty after parsing so it is recorded separately
        adjusted_score = _clamp(raw_score - penalty)
        sufficient = bool(data.get("sufficient", False))
        # Guard: if score is below threshold, force sufficient=False
        if adjusted_score < _SUFFICIENCY_THRESHOLD:
            sufficient = False

        label = str(data.get("label", "blocked"))
        if label not in {"approved", "conditional_approval", "blocked"}:
            label = "blocked"

        remediation_type = data.get("remediation_type")
        if remediation_type is not None:
            remediation_type = str(remediation_type)
            if remediation_type not in {"re_deliberate", "re_probe", "re_plan"}:
                remediation_type = "re_deliberate"
        if sufficient:
            remediation_type = None

        target_agent = data.get("target_agent")
        if target_agent is not None:
            target_agent = str(target_agent)
            # Risk Scorer is never a valid re_probe target
            if "risk" in target_agent.lower() and "scorer" in target_agent.lower():
                target_agent = None
                if remediation_type == "re_probe":
                    remediation_type = "re_deliberate"

        return VerdictOutput(
            confidence_score=adjusted_score,
            sufficient=sufficient,
            label=label,
            action_tier=_safe_action_tier(label),
            reasoning=str(data.get("reasoning", "")),
            remediation_type=remediation_type,
            target_agent=target_agent,
            objections_addressed=list(data.get("objections_addressed", [])),
            objections_upheld=list(data.get("objections_upheld", [])),
            iteration_penalty=penalty,
            raw_response=content,
        )
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        logger.warning("VerdictAgent: parse error: %s", exc)
        return None


def _deterministic_fallback(
    findings: list[Finding],
    metric_results: list[MetricResult],
    iteration: int,
) -> VerdictOutput:
    """Used when the governance LLM is unavailable (e.g. mock mode).

    Replicates the original penalty-based scoring so the pipeline
    continues to produce a useful verdict even without LLM access.
    """
    _SEV_PENALTY = {
        Severity.info: 0.01,
        Severity.low: 0.03,
        Severity.medium: 0.07,
        Severity.high: 0.15,
        Severity.critical: 0.25,
    }
    failed = sum(
        1 for m in metric_results
        if m.status in {"failed", "error"} or m.passed is False
    )
    pending = sum(
        1 for m in metric_results
        if m.status in {"pending", "skipped"}
    )
    open_findings = [f for f in findings if f.status == "open"]

    score = 0.95 - failed * 0.15 - pending * 0.05
    for f in open_findings:
        score -= _SEV_PENALTY.get(f.severity, 0.07)
    score = _clamp(score)

    sufficient = score >= _SUFFICIENCY_THRESHOLD and failed == 0
    has_high = any(f.severity in {Severity.high, Severity.critical} for f in open_findings)
    if failed > 0 or has_high:
        label = "blocked"
    elif pending > 0 or open_findings:
        label = "conditional_approval"
    else:
        label = "approved"

    return VerdictOutput(
        confidence_score=score,
        sufficient=sufficient,
        label=label,
        action_tier=_safe_action_tier(label),
        reasoning=(
            "Deterministic fallback verdict: governance model unavailable. "
            f"Metrics: {len(metric_results)} total, {failed} failed, {pending} pending. "
            f"Findings: {len(open_findings)} open."
        ),
        remediation_type=None if sufficient else "re_deliberate",
        target_agent=None,
        raw_response="[deterministic_fallback]",
    )


class VerdictAgent:
    """Council Verdict Agent.

    Reads synthesis memo + objections + original evidence. Emits a
    VerdictOutput with confidence score, sufficiency decision, and
    (when insufficient) a remediation_type for the router.
    """

    name = "verdict_agent"

    def __init__(
        self,
        governance_client: GovernanceModelClient,
        registry: PromptRegistry | None = None,
    ) -> None:
        self._governance = governance_client
        self._registry = registry or PromptRegistry.from_directory()

    def adjudicate(
        self,
        *,
        memo: SynthesisMemo,
        objections: list[Objection],
        findings: list[Finding],
        metric_results: list[MetricResult],
        iteration: int,
    ) -> VerdictOutput:
        template = self._registry.get(_TEMPLATE_ID, _PHASE_HASH)
        prompt = render(template, {
            "iteration": str(iteration),
            "narrative": memo.narrative,
            "risk_summary": memo.risk_summary,
            "dimensions": ", ".join(memo.dimensions) if memo.dimensions else "(none listed)",
            "sample_sizes": json.dumps(memo.sample_sizes) if memo.sample_sizes else "{}",
            "conflicts": "; ".join(memo.conflicts) if memo.conflicts else "(none)",
            "objections_text": _format_objections(objections),
            "findings_text": _format_findings(findings),
            "metrics_text": _format_metrics(metric_results),
            "threshold": str(_SUFFICIENCY_THRESHOLD),
        })

        try:
            response = self._governance.complete(
                GovernanceModelRequest(
                    task="council_verdict",
                    prompt=prompt,
                    context={
                        "iteration": iteration,
                        "objection_count": len(objections),
                        "finding_count": len(findings),
                        "metric_count": len(metric_results),
                        "sufficiency_threshold": _SUFFICIENCY_THRESHOLD,
                    },
                )
            )
            parsed = _parse_verdict(response.content, iteration)
            if parsed is not None:
                return parsed
            logger.warning("VerdictAgent: could not parse LLM response; using fallback")
        except Exception as exc:
            logger.error("VerdictAgent: governance call failed: %s", exc)

        return _deterministic_fallback(findings, metric_results, iteration)
