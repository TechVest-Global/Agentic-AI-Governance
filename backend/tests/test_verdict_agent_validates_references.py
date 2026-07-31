"""Covers VerdictAgent._validated dropping hallucinated agent/objection refs.

Previously target_agent only blocked the literal "risk_scorer" substring, and
objections_addressed/objections_upheld were trusted verbatim with zero
validation — a hallucinated agent name would reach run_agents' dispatch
unguarded (caught only downstream, if at all), and a made-up objection_id
would silently pass through to the persisted Verdict record.
"""

from app.models.enums import ActionTier
from app.services.deliberation_council.devils_advocate_agent import Objection
from app.services.deliberation_council.verdict_agent import VerdictOutput, _validated


def _objection(objection_id: str) -> Objection:
    return Objection(
        objection_id=objection_id,
        target_agent=None,
        category="methodology",
        argument="test",
        suggested_fix="test",
        remediation_hint="re_deliberate",
    )


def _verdict(**overrides: object) -> VerdictOutput:
    defaults = dict(
        confidence_score=0.5,
        sufficient=False,
        label="blocked",
        action_tier=ActionTier.human_review,
        reasoning="test",
        remediation_type="re_probe",
        target_agent=None,
        objections_addressed=[],
        objections_upheld=[],
    )
    defaults.update(overrides)
    return VerdictOutput(**defaults)


def test_hallucinated_target_agent_is_dropped_and_downgraded() -> None:
    verdict = _verdict(target_agent="totally_made_up_agent", remediation_type="re_probe")

    result = _validated(verdict, objections=[])

    assert result.target_agent is None
    assert result.remediation_type == "re_deliberate"


def test_real_registered_target_agent_is_kept() -> None:
    verdict = _verdict(target_agent="bias_agent", remediation_type="re_probe")

    result = _validated(verdict, objections=[])

    assert result.target_agent == "bias_agent"
    assert result.remediation_type == "re_probe"


def test_hallucinated_objection_ids_are_dropped() -> None:
    real_objection = _objection("da-001")
    verdict = _verdict(
        objections_addressed=["da-001", "da-999-hallucinated"],
        objections_upheld=["da-does-not-exist"],
    )

    result = _validated(verdict, objections=[real_objection])

    assert result.objections_addressed == ["da-001"]
    assert result.objections_upheld == []
