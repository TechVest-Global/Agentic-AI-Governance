"""The Council must not iterate on a failure it can never clear.

No remediation path re-runs metric execution — ``re_probe`` re-runs one
specialist agent, ``re_deliberate`` only re-synthesises, ``re_plan`` is inert —
so metric verdicts are frozen for the life of a deliberation. A metric that
conclusively failed will still be failed at the loop cap, and the deterministic
sufficiency rule (``score >= threshold AND failed == 0``) can never be satisfied.

Before this fix the loop ran to its cap regardless and exited via ``exhausted``,
which stamps the verdict with "unresolved uncertainty: the Council lacked enough
evidence to decide". That inverts what happened: the evidence was conclusive and
the verdict was already ``blocked``.

Note the two sufficiency policies are NOT identical: the ``failed == 0`` term
lives in the deterministic fallback, while the LLM template's contract is only
"confidence >= threshold AND objections resolved". So the model can return
``approved`` with ``sufficient=false`` where the deterministic path would refuse
to approve at all — which is why the early exit forces ``blocked`` /
human_review rather than trusting the verdict's own label.

These tests pin the corrected behaviour and, just as importantly, pin the two
cases that must still iterate: findings-driven shortfalls, and errored metrics
(missing evidence, not negative evidence).
"""

from app.models.enums import ActionTier, MetricResultStatus, Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.services.deliberation_council.remediation_router import (
    MAX_ITERATIONS,
    RouterExit,
    route,
)
from app.services.deliberation_council.verdict_agent import (
    VerdictAgent,
    VerdictOutput,
    _deterministic_fallback,
    _remediation_can_change_outcome,
)
from fastapi.testclient import TestClient


def _metric(metric_id: str, *, status: MetricResultStatus, passed: bool | None) -> MetricResult:
    return MetricResult(
        metric_id=metric_id,
        dimension="quality",
        status=status,
        passed=passed,
        normalized_score=0.4 if passed is False else 0.95,
        tool_name="deepeval",
    )


def _insufficient_verdict(label: str = "blocked") -> VerdictOutput:
    return VerdictOutput(
        confidence_score=0.41,
        sufficient=False,
        label=label,
        action_tier=ActionTier.human_review,
        reasoning="",
        remediation_type="re_probe",
        target_agent="quality_agent",
    )


# --------------------------------------------------------------------------
# The mechanical fact the fix rests on
# --------------------------------------------------------------------------


def test_failed_metric_makes_the_outcome_unchangeable() -> None:
    failed = [_metric("CM-003", status=MetricResultStatus.failed, passed=False)]
    assert _remediation_can_change_outcome(_insufficient_verdict(), failed) is False


def test_errored_metric_is_NOT_conclusive() -> None:
    """An evaluator crash is MISSING evidence, not negative evidence.

    Conflating the two would let a broken tool block the audited system, and would
    suppress the uncertainty memo in the one case where it is truthful. An errored
    metric must stay remediable so the loop can still escalate as real uncertainty.
    """
    errored = [_metric("CM-003", status=MetricResultStatus.error, passed=None)]
    assert _remediation_can_change_outcome(_insufficient_verdict(), errored) is True


def test_shortfall_from_findings_alone_is_still_remediable() -> None:
    """Regression guard: this is the case the loop genuinely exists for.

    With every metric passing, the score shortfall comes from finding severities.
    A re_probe replaces that agent's finding under the latest-per-agent read rule,
    so the score really can move — the loop must NOT be short-circuited here.
    """
    passing = [_metric("CM-003", status=MetricResultStatus.passed, passed=True)]
    assert _remediation_can_change_outcome(_insufficient_verdict(), passing) is True


def test_sufficient_verdict_is_never_marked_unremediable() -> None:
    verdict = _insufficient_verdict()
    verdict.sufficient = True
    failed = [_metric("CM-003", status=MetricResultStatus.failed, passed=False)]
    assert _remediation_can_change_outcome(verdict, failed) is True


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------


def test_router_decides_at_first_iteration_when_shortfall_is_conclusive() -> None:
    verdict = _insufficient_verdict()
    verdict.remediable = False

    decision = route(verdict, iteration=1)

    assert decision.exit is RouterExit.action
    assert decision.remediation_type is None
    assert "CONCLUSIVE" in decision.reason
    # The whole point: it did not burn the loop budget first.
    assert decision.iteration == 1 < MAX_ITERATIONS


def test_router_still_remediates_when_shortfall_is_remediable() -> None:
    verdict = _insufficient_verdict()
    verdict.remediable = True

    decision = route(verdict, iteration=1)

    assert decision.exit is RouterExit.remediate
    assert decision.remediation_type is not None


def test_router_still_exhausts_at_the_cap_for_remediable_shortfalls() -> None:
    """Exhaustion must remain reachable — it is the honest outcome when evidence
    really was missing and repeated remediation could not supply it."""
    verdict = _insufficient_verdict()
    verdict.remediable = True

    decision = route(verdict, iteration=MAX_ITERATIONS)

    assert decision.exit is RouterExit.exhausted


def test_sufficiency_still_wins_over_the_conclusive_exit() -> None:
    verdict = _insufficient_verdict(label="approved")
    verdict.sufficient = True
    verdict.confidence_score = 0.9
    verdict.remediable = False  # must be ignored when sufficient

    assert route(verdict, iteration=1).exit is RouterExit.action


# --------------------------------------------------------------------------
# Safety: deciding early must not soften the action tier
# --------------------------------------------------------------------------


def test_conclusive_block_still_routes_to_human_review() -> None:
    """Exiting early must reach the SAME tier the exhaustion path forced.

    action_tier is always derived from the label via _safe_action_tier, so a
    blocked verdict cannot be downgraded to autonomous/supervised by skipping
    iterations. Asserted here because it is the safety property that makes the
    early exit acceptable at all.
    """
    findings = [
        Finding(
            finding_type="quality",
            title="failure",
            summary="s",
            severity=Severity.high,
            confidence=0.9,
            dimension="quality",
            agent_name="quality_agent",
        )
    ]
    failed = [_metric("CM-003", status=MetricResultStatus.failed, passed=False)]

    verdict = _deterministic_fallback(findings, failed, iteration=1)

    assert verdict.sufficient is False
    assert verdict.label == "blocked"
    assert verdict.action_tier is ActionTier.human_review
    assert route(
        VerdictAgent._apply_policy_floor(verdict, failed), iteration=1
    ).exit is RouterExit.action


def test_policy_floor_applies_to_the_fallback_path() -> None:
    """The router must behave the same whether the LLM or the fallback decided."""
    failed = [_metric("CM-003", status=MetricResultStatus.failed, passed=False)]
    verdict = _deterministic_fallback([], failed, iteration=1)

    assert VerdictAgent._apply_policy_floor(verdict, failed).remediable is False


# --------------------------------------------------------------------------
# The governance floor: one policy, whichever path decided
# --------------------------------------------------------------------------


def test_a_failed_metric_cannot_be_approved_by_the_model() -> None:
    """The two paths encoded different policies; the same evidence gave
    approved/autonomous via the LLM and blocked/human_review via the fallback.

    _deterministic_fallback refuses to approve while any metric has failed. The
    LLM template has no such rule, so the model could approve a system with a
    failed control — making the verdict depend on whether the judge happened to
    be reachable. Whether a failed control blocks approval is policy, not a
    judgement to delegate, so it is enforced in code.
    """
    failed = [_metric("CM-003", status=MetricResultStatus.failed, passed=False)]

    approving = VerdictOutput(
        confidence_score=0.9,
        sufficient=True,
        label="approved",
        action_tier=ActionTier.autonomous,
        reasoning="model thought it looked fine",
        remediation_type=None,
        target_agent=None,
    )
    floored = VerdictAgent._apply_policy_floor(approving, failed)

    assert floored.sufficient is False
    assert floored.label == "blocked"
    assert floored.action_tier is ActionTier.human_review
    # And having been floored, it is also conclusive — so it decides immediately.
    assert route(floored, iteration=1).exit is RouterExit.action


def test_the_floor_does_not_touch_a_clean_run() -> None:
    """Guard against the floor blocking systems that did not fail anything."""
    passing = [_metric("CM-003", status=MetricResultStatus.passed, passed=True)]

    approving = VerdictOutput(
        confidence_score=0.9,
        sufficient=True,
        label="approved",
        action_tier=ActionTier.autonomous,
        reasoning="clean",
        remediation_type=None,
        target_agent=None,
    )
    floored = VerdictAgent._apply_policy_floor(approving, passing)

    assert floored.sufficient is True
    assert floored.label == "approved"
    assert floored.action_tier is ActionTier.autonomous


def test_the_floor_leaves_findings_driven_shortfalls_to_the_model() -> None:
    """Deliberately narrow: only the FAILED-metric rule is enforced.

    The fallback also blocks on high/critical findings, but findings genuinely
    change between iterations — freezing a verdict on them would break the
    remediation loop this same change works hard to preserve.
    """
    passing = [_metric("CM-003", status=MetricResultStatus.passed, passed=True)]
    verdict = _insufficient_verdict(label="conditional_approval")

    floored = VerdictAgent._apply_policy_floor(verdict, passing)

    assert floored.label == "conditional_approval"
    assert floored.remediable is True


# --------------------------------------------------------------------------
# End-to-end: the early exit must not become a route to a softer tier
# --------------------------------------------------------------------------


def test_llm_cannot_approve_early_via_the_conclusive_exit(
    client: TestClient, monkeypatch
) -> None:
    """The LLM path's sufficiency contract carries no failed-metric rule.

    Its template defines sufficient as "confidence >= threshold AND objections
    resolved", so the model can return label="approved" while sufficient=false —
    the deterministic path would have refused to approve with a failed metric.
    Deciding early must therefore never yield a softer outcome than looping
    would have: the persisted verdict is forced to blocked / human_review, just
    as loop exhaustion forces it.
    """
    from tests.test_council_routes import prepare_run_with_metric

    run, _ = prepare_run_with_metric(
        client,
        name="Conclusive Exit Safety System",
        metric_id="COUNCIL-CONCLUSIVE",
        control_ref="MAP-CONCLUSIVE",
        mock_score=0.5,  # below threshold -> metric FAILS -> conclusive evidence
    )

    def fake_parse_verdict(content, iteration):
        # Deliberately permissive and self-contradictory: approving, yet not
        # sufficient. Exactly the shape the code must refuse to act softly on.
        return VerdictOutput(
            confidence_score=0.5,
            sufficient=False,
            label="approved",
            action_tier=ActionTier.autonomous,
            reasoning="Model approved despite a failed metric.",
            remediation_type="re_probe",
            target_agent="bias_agent",
        )

    monkeypatch.setattr(
        "app.services.deliberation_council.verdict_agent._parse_verdict",
        fake_parse_verdict,
    )

    response = client.post(
        f"/api/v1/evaluation-runs/{run['id']}/council/deliberate",
        json={"requested_by": "test"},
    )
    assert response.status_code == 201
    verdict = response.json()["verdict"]

    assert verdict["label"] == "blocked"
    assert verdict["action_tier"] == ActionTier.human_review.value
    # Decided on the first pass rather than burning the loop budget...
    assert "[Council iterations: 1" in verdict["reasoning"]
    # ...and described truthfully, NOT as unresolved uncertainty.
    assert "DECIDED ON CONCLUSIVE EVIDENCE" in verdict["reasoning"]
    assert "LOOP EXHAUSTION" not in verdict["reasoning"]
