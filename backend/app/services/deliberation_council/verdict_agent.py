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
from app.services.agents.registry import REGISTERED_AGENT_NAMES
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
class DerivationStep:
    """One adjustment on the path from a raw assessment to the final score."""

    step: str
    detail: str
    score_before: float | None = None
    score_after: float | None = None


@dataclass
class ConfidenceDerivation:
    """Where the confidence number came from, step by step.

    Deliberately mechanical rather than narrated. Every adjustment below is
    made by code -- the iteration penalty, the clamp, the sufficiency
    threshold, the policy floor -- so the derivation can be recomputed and
    checked against the inputs. Asking the model to explain its own confidence
    would produce a fluent account with nothing holding it to what actually
    happened, which is the failure mode this whole change exists to remove.

    ``source`` says who produced the raw number before code touched it:
      governance_model  — the judge returned it
      risk_contract     — derived from the Risk Scorer's composite_score
      severity_penalty  — derived from finding severities and metric failures
    The latter two are the deterministic fallback, used when no judge was
    reachable; a reader needs to tell those apart from a real assessment.
    """

    source: str
    raw_score: float
    final_score: float
    threshold: float
    steps: list[DerivationStep] = field(default_factory=list)
    policy_floor_applied: bool = False
    sufficiency_reason: str = ""

    def record(
        self,
        step: str,
        detail: str,
        *,
        before: float | None = None,
        after: float | None = None,
    ) -> None:
        self.steps.append(
            DerivationStep(step=step, detail=detail, score_before=before, score_after=after)
        )


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
    # How this verdict's confidence_score was arrived at. Every value here was
    # already computed to produce the score; it used to be discarded, leaving
    # the number unexplained on the record.
    derivation: ConfidenceDerivation | None = None
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
        # `attacks` is rendered into the existing {objections_text} slot rather
        # than added as a template variable, so the verdict can weigh a disputed
        # inference differently from disputed evidence without a new template
        # version. What the model is asked to produce is unchanged.
        lines.append(
            f"  [{obj.objection_id} | {obj.category} | target={target} | "
            f"attacks={obj.attacks}]\n"
            f"    {obj.argument}\n"
            f"    → Fix: {obj.suggested_fix}\n"
            f"    → Hint: {obj.remediation_hint}"
        )
        if obj.target_claim_id:
            lines.append(f"    → Challenges claim: {obj.target_claim_id}")
        if obj.target_finding_ids:
            lines.append(f"    → Disputes findings: {', '.join(obj.target_finding_ids)}")
    return "\n".join(lines)


def _format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "  (none)"
    # finding_id/evidence_ids included so a verdict's objections_addressed
    # can cite a specific finding by ID instead of only prose — see
    # synthesis_agent._format_findings for the matching rationale.
    return "\n".join(
        f"  [finding_id={f.id} | {f.agent_name or 'unknown'} | {f.severity} | {f.dimension}] "
        f"{f.title}: {f.summary}"
        + (f"\n    → Evidence: {', '.join(f.evidence_ids)}" if f.evidence_ids else "")
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

        derivation = ConfidenceDerivation(
            source="governance_model",
            raw_score=raw_score,
            final_score=adjusted_score,
            threshold=_SUFFICIENCY_THRESHOLD,
        )
        derivation.record(
            "model_assessment",
            "The governance model assessed evidence quality at this confidence.",
            after=raw_score,
        )
        if penalty:
            derivation.record(
                "iteration_penalty",
                f"Deducted {penalty:.3f} to record that this confidence was reached "
                f"only after re-deliberation, not on the first pass.",
                before=raw_score,
                after=_clamp(raw_score - penalty),
            )
        if not 0.0 <= raw_score - penalty <= 1.0:
            derivation.record(
                "clamped",
                "The adjusted score fell outside 0.0-1.0 and was clamped into range.",
                before=raw_score - penalty,
                after=adjusted_score,
            )

        # Guard: if score is below threshold, force sufficient=False
        if adjusted_score < _SUFFICIENCY_THRESHOLD:
            if sufficient:
                derivation.record(
                    "threshold_guard",
                    f"The model called the evidence sufficient at {adjusted_score:.3f}, "
                    f"below the {_SUFFICIENCY_THRESHOLD} threshold. Sufficiency is a "
                    f"threshold rule, not the model's to waive, so it was overruled.",
                )
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
            derivation=derivation,
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


def _sufficiency_reason(verdict: VerdictOutput, failed_metrics: int) -> str:
    """One sentence on why the evidence was or was not called sufficient.

    The sufficiency flag drives whether the pipeline exits or remediates, so
    "why" should not have to be inferred from a score and a threshold.
    """
    if verdict.sufficient:
        return (
            f"Confidence {verdict.confidence_score:.3f} meets the "
            f"{_SUFFICIENCY_THRESHOLD} threshold with no failed metrics."
        )
    if failed_metrics:
        return (
            f"{failed_metrics} metric(s) failed; the governance floor does not "
            f"call evidence sufficient while a control is failing."
        )
    if verdict.confidence_score < _SUFFICIENCY_THRESHOLD:
        return (
            f"Confidence {verdict.confidence_score:.3f} is below the "
            f"{_SUFFICIENCY_THRESHOLD} threshold."
        )
    return "The model judged the evidence insufficient to decide."


def _validated(verdict: VerdictOutput, *, objections: list[Objection]) -> VerdictOutput:
    """Cross-check LLM-supplied references against what's actually real.

    ``target_agent`` and ``objections_addressed``/``objections_upheld`` are
    free-text LLM output with no guarantee they name a real agent or a real
    objection from this iteration — previously only "risk_scorer" was
    blocked, and hallucinated/invalid entries reached ``run_agents``' agent
    dispatch or the persisted Verdict record unexamined. Invalid entries are
    dropped and logged rather than trusted.
    """
    if verdict.target_agent is not None and verdict.target_agent not in REGISTERED_AGENT_NAMES:
        logger.warning(
            "VerdictAgent: target_agent '%s' is not a registered agent; dropping",
            verdict.target_agent,
        )
        verdict.target_agent = None
        if verdict.remediation_type == "re_probe":
            verdict.remediation_type = "re_deliberate"

    valid_objection_ids = {obj.objection_id for obj in objections}
    for field_name in ("objections_addressed", "objections_upheld"):
        raw_ids = getattr(verdict, field_name)
        filtered = [oid for oid in raw_ids if oid in valid_objection_ids]
        dropped = [oid for oid in raw_ids if oid not in valid_objection_ids]
        if dropped:
            logger.warning(
                "VerdictAgent: %s referenced unknown objection_id(s) %s; dropping",
                field_name, dropped,
            )
        setattr(verdict, field_name, filtered)

    return verdict


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
    derivation: ConfidenceDerivation | None = None
    if composite is not None:
        # composite is a risk score; invert to get confidence
        score = _clamp(1.0 - min(composite, 1.0))
        derivation = ConfidenceDerivation(
            source="risk_contract",
            raw_score=score,
            final_score=score,
            threshold=_SUFFICIENCY_THRESHOLD,
        )
        derivation.record(
            "no_governance_model",
            "No governance model was reachable, so this confidence was computed "
            "from the evidence rather than assessed by a judge.",
        )
        derivation.record(
            "risk_composite_inverted",
            f"The Risk Scorer's composite risk score was {composite:.3f}; "
            f"confidence is its inverse.",
            after=score,
        )
        # High-risk composite (>= 0.75) or critical findings force a block
        if composite >= 0.75 or has_critical_finding:
            capped = min(score, 0.45)
            reason = (
                "a critical finding is open"
                if has_critical_finding
                else f"composite risk {composite:.3f} is at or above 0.75"
            )
            derivation.record(
                "high_risk_cap",
                f"Confidence capped at 0.45 because {reason}.",
                before=score,
                after=capped,
            )
            score = capped
    else:
        _SEV_PENALTY = {
            Severity.info: 0.01,
            Severity.low: 0.03,
            Severity.medium: 0.07,
            Severity.high: 0.15,
            Severity.critical: 0.25,
        }
        base = 0.95 - failed * 0.15 - pending * 0.05
        severity_total = sum(_SEV_PENALTY.get(f.severity, 0.07) for f in open_findings)
        score = _clamp(base - severity_total)
        derivation = ConfidenceDerivation(
            source="severity_penalty",
            raw_score=score,
            final_score=score,
            threshold=_SUFFICIENCY_THRESHOLD,
        )
        derivation.record(
            "no_governance_model",
            "No governance model was reachable, and no Risk Scorer composite was "
            "available, so confidence was computed from metric and finding counts.",
        )
        derivation.record(
            "metric_deductions",
            f"Started at 0.95, less {failed * 0.15:.3f} for {failed} failed "
            f"metric(s) and {pending * 0.05:.3f} for {pending} pending.",
            after=_clamp(base),
        )
        if severity_total:
            derivation.record(
                "finding_severity_deductions",
                f"Less {severity_total:.3f} across {len(open_findings)} open finding(s), "
                f"weighted by severity.",
                before=_clamp(base),
                after=score,
            )

    sufficient = score >= _SUFFICIENCY_THRESHOLD and failed == 0
    if failed > 0 or has_high:
        label = "blocked"
    elif pending > 0 or open_findings:
        label = "conditional_approval"
    else:
        label = "approved"

    source = "risk_contract" if composite is not None else "severity_penalty"
    derivation.final_score = score
    if not sufficient and score >= _SUFFICIENCY_THRESHOLD and failed:
        derivation.record(
            "failed_metric_blocks_sufficiency",
            f"Confidence of {score:.3f} clears the {_SUFFICIENCY_THRESHOLD} threshold, "
            f"but {failed} metric(s) failed and the fallback does not call evidence "
            f"sufficient while a control is failing.",
        )
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
        derivation=derivation,
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
                # Both guards apply, in this order: _validated strips LLM
                # references that name no real agent or objection, then the
                # policy floor overrides the decision itself where a failed
                # metric forbids approval.
                return self._apply_policy_floor(
                    _validated(parsed, objections=objections), metric_results
                )
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
        failed = _conclusive_failure_count(metric_results)
        if failed > 0:
            verdict.sufficient = False
            if verdict.label != "blocked":
                logger.warning(
                    "VerdictAgent: overriding label '%s' -> 'blocked'; %d metric(s) "
                    "failed and the governance floor does not permit approval",
                    verdict.label,
                    failed,
                )
                if verdict.derivation is not None:
                    # Recorded, not just logged. A reader looking at a blocked
                    # verdict otherwise cannot tell a decision the judge reached
                    # from one policy imposed over its objection.
                    verdict.derivation.policy_floor_applied = True
                    verdict.derivation.record(
                        "policy_floor",
                        f"The model returned '{verdict.label}'. {failed} metric(s) "
                        f"failed, and whether a failed control permits approval is a "
                        f"policy decision enforced in code, so the label was "
                        f"overridden to 'blocked'.",
                    )
                verdict.label = "blocked"
                verdict.action_tier = _safe_action_tier("blocked")
        verdict.remediable = _remediation_can_change_outcome(verdict, metric_results)

        if verdict.derivation is not None:
            verdict.derivation.final_score = verdict.confidence_score
            verdict.derivation.sufficiency_reason = _sufficiency_reason(verdict, failed)
        return verdict
