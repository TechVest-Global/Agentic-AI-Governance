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
    # Whether another Council iteration could still change this outcome.
    #
    # False means the verdict is insufficient by the threshold rule but is
    # CONCLUSIVE: remediation cannot move it, so iterating would only burn
    # budget and then mislabel a settled decision as unresolved uncertainty.
    # Set by adjudicate() from the evidence, never by the LLM — whether a loop
    # can converge is a mechanical property of the pipeline, not a judgement.
    remediable: bool = True


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


def _failed_metric_count(metric_results: list[MetricResult]) -> int:
    return sum(
        1 for m in metric_results
        if m.status in {"failed", "error"} or m.passed is False
    )


def _conclusive_failure_count(metric_results: list[MetricResult]) -> int:
    """Metrics that actually FAILED — real negative evidence about the system.

    Deliberately narrower than _failed_metric_count, which also counts ``error``.
    An errored metric means the evaluator broke, so the evidence is MISSING, not
    negative — that is genuine uncertainty and must stay eligible for remediation
    and the exhaustion memo. Conflating a tool failure with a system failure
    would let a crashed evaluator block the audited system.
    """
    return sum(
        1 for m in metric_results
        if m.passed is False or m.status == "failed"
    )


def _remediation_can_change_outcome(
    verdict: VerdictOutput,
    metric_results: list[MetricResult],
) -> bool:
    """Whether another Council iteration could still change this verdict.

    No remediation path re-runs metric execution: ``re_probe`` re-runs a single
    specialist agent, ``re_deliberate`` only re-synthesises, and ``re_plan`` is
    inert. The metric verdicts are therefore frozen for the life of a
    deliberation — so a metric that conclusively failed will still be failed at
    the cap, and the deterministic sufficiency rule (``failed == 0``) can never
    be satisfied.

    Previously the loop ran to its cap regardless and stamped the verdict with a
    LOOP EXHAUSTION memo reading "unresolved uncertainty: the Council lacked
    enough evidence to decide". That inverts what happened: the evidence was
    conclusive and the Council had already decided to block.

    Two cases must stay remediable, and both are load-bearing:
      * findings-driven shortfall — a re_probe appends a fresh finding, the
        latest-per-agent read rule replaces that agent's previous one, and the
        severity penalties (hence the score) genuinely move;
      * errored or pending metrics — evidence is missing rather than negative,
        which is exactly what exhaustion-with-an-uncertainty-memo is for.
    """
    if verdict.sufficient:
        return True  # moot: the router exits on sufficiency before consulting this
    return _conclusive_failure_count(metric_results) == 0


def _extract_risk_bundle_score(findings: list[Finding]) -> float | None:
    """Return composite_score from a risk_summary finding if one exists."""
    for f in findings:
        if f.finding_type == "risk_summary" and f.payload:
            composite = f.payload.get("composite_score")
            if isinstance(composite, int | float):
                return float(composite)
    return None


def _deterministic_fallback(
    findings: list[Finding],
    metric_results: list[MetricResult],
    iteration: int,
) -> VerdictOutput:
    """Used when the governance LLM is unavailable (e.g. mock mode).

    When a risk_summary finding from the Risk Scorer contract is present, its
    composite_score is used as the primary calibration signal.  The composite
    score is a risk score (0=no risk, 1=max risk) so confidence is derived as
    ``1 - composite``, bounded to [0, 1].

    Falls back to the original penalty-based approach when no risk bundle is found.
    """
    failed = _failed_metric_count(metric_results)
    pending = sum(
        1 for m in metric_results
        if m.status in {"pending", "skipped"}
    )
    open_findings = [f for f in findings if f.status == "open"]
    has_high = any(f.severity in {Severity.high, Severity.critical} for f in open_findings)
    has_critical_finding = any(f.severity == Severity.critical for f in open_findings)

    # Prefer calibrated composite from the risk contract when available
    composite = _extract_risk_bundle_score(findings)
    if composite is not None:
        # composite is a risk score; invert to get confidence
        score = _clamp(1.0 - min(composite, 1.0))
        # High-risk composite (>= 0.75) or critical findings force a block
        if composite >= 0.75 or has_critical_finding:
            score = min(score, 0.45)
    else:
        _SEV_PENALTY = {
            Severity.info: 0.01,
            Severity.low: 0.03,
            Severity.medium: 0.07,
            Severity.high: 0.15,
            Severity.critical: 0.25,
        }
        score = 0.95 - failed * 0.15 - pending * 0.05
        for f in open_findings:
            score -= _SEV_PENALTY.get(f.severity, 0.07)
        score = _clamp(score)

    sufficient = score >= _SUFFICIENCY_THRESHOLD and failed == 0
    if failed > 0 or has_high:
        label = "blocked"
    elif pending > 0 or open_findings:
        label = "conditional_approval"
    else:
        label = "approved"

    source = "risk_contract" if composite is not None else "severity_penalty"
    return VerdictOutput(
        confidence_score=score,
        sufficient=sufficient,
        label=label,
        action_tier=_safe_action_tier(label),
        reasoning=(
            f"Deterministic fallback verdict ({source}): governance model unavailable. "
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
                return self._apply_policy_floor(parsed, metric_results)
            logger.warning("VerdictAgent: could not parse LLM response; using fallback")
        except Exception as exc:
            logger.error("VerdictAgent: governance call failed: %s", exc)

        return self._apply_policy_floor(
            _deterministic_fallback(findings, metric_results, iteration), metric_results
        )

    @staticmethod
    def _apply_policy_floor(
        verdict: VerdictOutput,
        metric_results: list[MetricResult],
    ) -> VerdictOutput:
        """Enforce the deterministic governance floor on ANY verdict, then record
        whether iterating again could change it.

        Applied to BOTH the LLM and the deterministic-fallback paths, because the
        two encoded DIFFERENT policies and the same evidence therefore produced
        different verdicts depending only on whether the judge happened to be
        reachable:

            one failed metric, LLM path      -> approved / autonomous
            one failed metric, fallback path -> blocked  / human_review

        _deterministic_fallback refuses to approve while any metric has failed
        (``sufficient = score >= threshold and failed == 0``, and
        ``if failed > 0 ... label = "blocked"``). The LLM template carries no such
        rule — its contract is only "confidence >= threshold AND objections
        resolved" — so the model could approve a system with a failed control.

        Whether a failed control blocks approval is a governance policy decision,
        not a judgement call to delegate to a model, so the floor is enforced in
        code and the model's opinion cannot lift it. The model still decides
        everything the floor does not constrain: confidence, reasoning, which
        objections were upheld, and the remediation route.

        Deliberately narrow. Only the FAILED-metric rule is enforced, because that
        evidence is frozen for the life of the deliberation. The fallback's
        ``has_high`` findings rule is not enforced here: findings genuinely change
        between iterations, so freezing a verdict on them would break remediation.
        """
        if _conclusive_failure_count(metric_results) > 0:
            verdict.sufficient = False
            if verdict.label != "blocked":
                logger.warning(
                    "VerdictAgent: overriding label '%s' -> 'blocked'; %d metric(s) "
                    "failed and the governance floor does not permit approval",
                    verdict.label,
                    _conclusive_failure_count(metric_results),
                )
                verdict.label = "blocked"
                verdict.action_tier = _safe_action_tier("blocked")
        verdict.remediable = _remediation_can_change_outcome(verdict, metric_results)
        return verdict
