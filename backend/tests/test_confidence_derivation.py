"""The confidence number has to say where it came from.

A verdict used to present a score and a tier with no account of how either
was reached: whether a judge assessed it or arithmetic produced it, what was
deducted, and whether the label was the model's conclusion or a policy
override imposed over it. These tests pin that account.
"""

from __future__ import annotations

import json
from uuid import uuid4

from app.models.enums import Severity
from app.models.evidence import MetricResult
from app.models.finding import Finding
from app.services.deliberation_council.synthesis_agent import SynthesisMemo
from app.services.deliberation_council.verdict_agent import (
    _SUFFICIENCY_THRESHOLD,
    VerdictAgent,
)


def _memo() -> SynthesisMemo:
    return SynthesisMemo(
        narrative="n",
        risk_summary="r",
        dimensions=[],
        sample_sizes={},
        conflicts=[],
        iteration=1,
        raw_response="",
    )


def _metric(*, passed: bool, status: str = "completed") -> MetricResult:
    return MetricResult(
        id=uuid4(),
        run_id=uuid4(),
        metric_id="M-1",
        dimension="transparency",
        status=status,
        passed=passed,
        normalized_score=0.9 if passed else 0.1,
    )


def _finding(severity: Severity = Severity.high) -> Finding:
    return Finding(
        id=uuid4(),
        run_id=uuid4(),
        finding_type="observation",
        title="t",
        summary="s",
        severity=severity,
        dimension="transparency",
        agent_name="compliance_mapper",
    )


class _StubClient:
    def __init__(self, content: str) -> None:
        self._content = content

    def complete(self, request):  # noqa: ANN001 - test double
        return type("R", (), {"content": self._content})()


class _BrokenClient:
    def complete(self, request):  # noqa: ANN001 - test double
        raise RuntimeError("no governance model reachable")


def _verdict_json(**overrides) -> str:
    payload = {
        "confidence_score": 0.9,
        "sufficient": True,
        "label": "approved",
        "reasoning": "Evidence is clean.",
        "remediation_type": None,
        "objections_addressed": [],
        "objections_upheld": [],
        "iteration_penalty": 0.0,
    }
    payload.update(overrides)
    return json.dumps(payload)


def _adjudicate(client, *, metrics=None, findings=None, iteration=1):
    return VerdictAgent(client).adjudicate(
        memo=_memo(),
        objections=[],
        findings=findings or [],
        metric_results=metrics or [],
        iteration=iteration,
    )


def test_a_model_assessed_score_says_so() -> None:
    verdict = _adjudicate(_StubClient(_verdict_json()), metrics=[_metric(passed=True)])

    d = verdict.derivation
    assert d.source == "governance_model"
    assert d.raw_score == 0.9
    assert d.final_score == 0.9
    assert d.threshold == _SUFFICIENCY_THRESHOLD
    assert [s.step for s in d.steps] == ["model_assessment"]
    assert "meets the" in d.sufficiency_reason


def test_the_iteration_penalty_is_shown_as_a_deduction() -> None:
    """The score was hard-won; the record should say by how much."""
    verdict = _adjudicate(
        _StubClient(_verdict_json(confidence_score=0.9, iteration_penalty=0.1)),
        metrics=[_metric(passed=True)],
        iteration=2,
    )

    penalty = next(s for s in verdict.derivation.steps if s.step == "iteration_penalty")
    assert penalty.score_before == 0.9
    assert penalty.score_after == 0.8
    assert verdict.confidence_score == 0.8


def test_overruling_the_model_on_sufficiency_is_recorded() -> None:
    """Sufficiency is a threshold rule, not the model's to waive."""
    verdict = _adjudicate(
        _StubClient(_verdict_json(confidence_score=0.4, sufficient=True)),
        metrics=[_metric(passed=True)],
    )

    assert verdict.sufficient is False
    guard = next(s for s in verdict.derivation.steps if s.step == "threshold_guard")
    assert "threshold" in guard.detail
    assert "below the" in verdict.derivation.sufficiency_reason


def test_a_policy_override_is_distinguishable_from_the_models_own_verdict() -> None:
    """Otherwise a blocked verdict cannot be told from one blocked over the model."""
    verdict = _adjudicate(
        _StubClient(_verdict_json(confidence_score=0.9, label="approved")),
        metrics=[_metric(passed=False)],
    )

    assert verdict.label == "blocked"
    assert verdict.derivation.policy_floor_applied is True
    floor = next(s for s in verdict.derivation.steps if s.step == "policy_floor")
    assert "approved" in floor.detail
    assert "policy decision" in floor.detail


def test_a_computed_score_is_not_presented_as_an_assessment() -> None:
    """With no judge reachable, the number is arithmetic — the record must say so."""
    verdict = _adjudicate(
        _BrokenClient(),
        metrics=[_metric(passed=True)],
        findings=[_finding(Severity.medium)],
    )

    d = verdict.derivation
    assert d.source == "severity_penalty"
    assert d.steps[0].step == "no_governance_model"
    assert any(s.step == "finding_severity_deductions" for s in d.steps)


def test_a_risk_contract_score_names_the_composite_it_inverted() -> None:
    bundle = _finding(Severity.low)
    bundle.finding_type = "risk_summary"
    bundle.payload = {"composite_score": 0.2}

    verdict = _adjudicate(_BrokenClient(), metrics=[_metric(passed=True)], findings=[bundle])

    d = verdict.derivation
    assert d.source == "risk_contract"
    inverted = next(s for s in d.steps if s.step == "risk_composite_inverted")
    assert "0.200" in inverted.detail
    assert verdict.confidence_score == 0.8


def test_the_high_risk_cap_says_which_rule_fired() -> None:
    bundle = _finding(Severity.low)
    bundle.finding_type = "risk_summary"
    bundle.payload = {"composite_score": 0.8}

    verdict = _adjudicate(_BrokenClient(), metrics=[_metric(passed=True)], findings=[bundle])

    cap = next(s for s in verdict.derivation.steps if s.step == "high_risk_cap")
    assert "0.800" in cap.detail
    assert verdict.confidence_score <= 0.45


def test_the_final_score_on_the_derivation_matches_the_verdict() -> None:
    """The derivation is only useful if it explains the number actually published."""
    for client, metrics in (
        (_StubClient(_verdict_json(confidence_score=0.9, iteration_penalty=0.2)), [_metric(passed=True)]),
        (_StubClient(_verdict_json(confidence_score=0.9)), [_metric(passed=False)]),
        (_BrokenClient(), [_metric(passed=True)]),
    ):
        verdict = _adjudicate(client, metrics=metrics)
        assert verdict.derivation.final_score == verdict.confidence_score
