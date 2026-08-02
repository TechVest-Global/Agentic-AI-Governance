"""Remediation Loop Router — Layer 4, deterministic.

Implements the three-exit deterministic router described in the
Deliberation Council Remediation Loop architecture addendum.

Exit priority order (must be checked in this order):
  1. sufficient=True                   → "action"   (proceed to Layer 5)
  2. iteration_count >= MAX_ITERATIONS → "exhausted" (human review, uncertainty memo)
  3. insufficient + under cap          → "remediate" (re-enter pipeline)

The router also classifies the re-entry point from the VerdictOutput:
  re_deliberate → re-enter at SynthesisAgent (same findings, new narrative)
  re_probe      → re-enter at the named specialist agent (more samples needed)
  re_plan       → activate a dormant specialist for a dimension named by an
                  upheld objection but not yet covered this run

Loop control rules (from spec Section 5):
  - Maximum three loop-backs of ANY type, total (one counter governs all).
  - Counter is passed in from the caller, which persists it to the DB.
  - Forced dissent fires on every iteration (enforced by the Council orchestrator).
  - Append-only: each iteration's artifacts carry an iteration index.
  - Graceful exit: on third failure, force a verdict at current confidence and
    escalate with an explicit uncertainty memo.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.services.deliberation_council.verdict_agent import VerdictOutput

MAX_ITERATIONS = 3


class RouterExit(StrEnum):
    action = "action"
    exhausted = "exhausted"
    remediate = "remediate"


class RemediationType(StrEnum):
    re_deliberate = "re_deliberate"
    re_probe = "re_probe"
    re_plan = "re_plan"


@dataclass(frozen=True)
class RouterDecision:
    exit: RouterExit
    remediation_type: RemediationType | None
    target_agent: str | None
    iteration: int
    reason: str


def route(
    verdict: VerdictOutput,
    iteration: int,
) -> RouterDecision:
    """Apply the three-exit routing logic.

    Args:
        verdict:   Output from the VerdictAgent for this iteration.
        iteration: 1-based counter of how many Council passes have run.
                   Persisted to the DB by the caller; never reset.

    Returns:
        RouterDecision describing which exit was taken and why.
    """
    # Exit 1: sufficient — evidence is strong enough, proceed to action tier
    if verdict.sufficient:
        return RouterDecision(
            exit=RouterExit.action,
            remediation_type=None,
            target_agent=None,
            iteration=iteration,
            reason=(
                f"Evidence sufficient (confidence={verdict.confidence_score:.3f} "
                f">= threshold) after {iteration} iteration(s)."
            ),
        )

    # Exit 1b: insufficient, but CONCLUSIVELY so — decide now rather than loop.
    #
    # Sufficiency is gated on there being no failed metric, and no remediation
    # path re-runs metric execution, so once a metric has failed the gate can
    # never be satisfied (see _remediation_can_change_outcome). Iterating to the
    # cap then exited via `exhausted`, which attaches an uncertainty memo saying
    # the Council "lacked enough evidence to decide" — the opposite of the truth:
    # the evidence was conclusive and the verdict was already `blocked`.
    #
    # This exit routes to the action tier the verdict itself carries. That is not
    # a weakening: action_tier is always derived from the label via
    # _safe_action_tier, and `blocked` maps to human_review — the same tier the
    # exhaustion path forced, reached in one iteration instead of three.
    if not verdict.remediable:
        return RouterDecision(
            exit=RouterExit.action,
            remediation_type=None,
            target_agent=None,
            iteration=iteration,
            reason=(
                f"Evidence insufficient by threshold (confidence="
                f"{verdict.confidence_score:.3f}) but CONCLUSIVE: a failed metric "
                "cannot be cleared by any remediation path, so no further "
                f"iteration can change this verdict. Deciding at iteration "
                f"{iteration} as '{verdict.label}' instead of looping to the cap "
                "and reporting settled evidence as unresolved uncertainty."
            ),
        )

    # Exit 2: exhaustion — cap reached, escalate to human review
    if iteration >= MAX_ITERATIONS:
        return RouterDecision(
            exit=RouterExit.exhausted,
            remediation_type=None,
            target_agent=None,
            iteration=iteration,
            reason=(
                f"Loop cap reached ({iteration}/{MAX_ITERATIONS} iterations). "
                "Evidence still insufficient. Escalating to human review with "
                "uncertainty memo."
            ),
        )

    # Exit 3: remediate — classify re-entry point from verdict
    raw_type = verdict.remediation_type or "re_deliberate"
    try:
        remediation_type = RemediationType(raw_type)
    except ValueError:
        remediation_type = RemediationType.re_deliberate

    reason = _remediation_reason(remediation_type, verdict, iteration)
    return RouterDecision(
        exit=RouterExit.remediate,
        remediation_type=remediation_type,
        target_agent=verdict.target_agent if remediation_type == RemediationType.re_probe else None,
        iteration=iteration,
        reason=reason,
    )


def build_exhaustion_memo(
    last_verdict: VerdictOutput,
    iteration: int,
) -> dict[str, object]:
    """Build the uncertainty memo emitted on loop exhaustion.

    This memo distinguishes loop exhaustion from the low-confidence
    human-review tier in Layer 5. A reviewer must not mistake unresolved
    uncertainty for a settled low-risk verdict.
    """
    return {
        "exhaustion_type": "loop_exhaustion",
        "distinction": (
            "LOOP EXHAUSTION — could not reach sufficient evidence quality after "
            f"{iteration} Council iteration(s). "
            "This is NOT a low-confidence verdict on a settled finding. "
            "It is unresolved uncertainty: the Council lacked enough evidence to decide."
        ),
        "final_confidence": last_verdict.confidence_score,
        "iteration_count": iteration,
        "last_label": last_verdict.label,
        "last_reasoning": last_verdict.reasoning,
        "objections_upheld": last_verdict.objections_upheld,
        "recommended_human_action": (
            "Human reviewer should examine the upheld objections above, "
            "assess whether additional specialist probes are feasible, "
            "and either approve a manual verdict or request targeted re-evaluation."
        ),
    }


def _remediation_reason(
    remediation_type: RemediationType,
    verdict: VerdictOutput,
    iteration: int,
) -> str:
    if remediation_type == RemediationType.re_deliberate:
        return (
            f"Iteration {iteration}: evidence sound but reasoning insufficient "
            f"(confidence={verdict.confidence_score:.3f}). "
            "Re-entering at Synthesis Agent for a fresh narrative pass."
        )
    if remediation_type == RemediationType.re_probe:
        agent = verdict.target_agent or "(unspecified)"
        return (
            f"Iteration {iteration}: specific finding is under-sampled. "
            f"Re-entering at specialist agent '{agent}' for additional probes."
        )
    # re_plan: activates a dormant specialist for a dimension named by an
    # upheld objection, if one both matches a real dimension and hasn't
    # already run this iteration — see deliberation._resolve_re_plan_target.
    return (
        f"Iteration {iteration}: an upheld objection suggests a risk dimension "
        "was never probed. Re-entering to activate a dormant specialist for "
        "that dimension, if one can be resolved from the objection text."
    )
