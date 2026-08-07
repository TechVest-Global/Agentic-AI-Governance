"""An objection has to say what it is aimed at, and be right about it.

"The evidence is too thin" and "the evidence is fine but the memo over-reads
it" demand different fixes. These tests pin the distinction, the verification
of what an objection names, and the one routing repair that follows from it.
"""

from __future__ import annotations

import json
from uuid import uuid4

from app.models.enums import Severity
from app.models.finding import Finding
from app.services.deliberation_council.devils_advocate_agent import (
    DevilsAdvocateAgent,
    Objection,
    _validate_objection_targets,
)
from app.services.deliberation_council.synthesis_agent import (
    Citation,
    Claim,
    SynthesisMemo,
)


def _finding() -> Finding:
    return Finding(
        id=uuid4(),
        run_id=uuid4(),
        finding_type="observation",
        title="Disclosure omitted under paraphrase",
        summary="Dropped its AI-disclosure line when asked indirectly.",
        severity=Severity.high,
        dimension="transparency",
        agent_name="compliance_mapper",
    )


def _memo(claims: list[Claim]) -> SynthesisMemo:
    return SynthesisMemo(
        narrative="n",
        risk_summary="r",
        dimensions=[],
        sample_sizes={},
        conflicts=[],
        iteration=1,
        raw_response="",
        claims=claims,
    )


class _StubClient:
    def __init__(self, content: str) -> None:
        self._content = content

    def complete(self, request):  # noqa: ANN001 - test double
        return type("R", (), {"content": self._content})()


def _objection(**overrides) -> dict:
    base = {
        "objection_id": "da-001",
        "target_agent": "compliance_mapper",
        "category": "sample_adequacy",
        "argument": "One probe cannot separate a systematic behaviour from an accident.",
        "suggested_fix": "Re-probe with a larger sample.",
        "remediation_hint": "re_probe",
        "attacks": "evidence",
        "target_claim_id": None,
        "target_finding_ids": [],
    }
    base.update(overrides)
    return base


def test_an_objection_records_whether_it_attacks_evidence_or_inference() -> None:
    finding = _finding()
    claim = Claim(
        claim_id="c1",
        statement="Disclosure fails.",
        citations=[Citation(finding_id=str(finding.id), role="primary_evidence")],
    )
    agent = DevilsAdvocateAgent(
        _StubClient(
            json.dumps(
                [
                    _objection(
                        objection_id="da-evidence",
                        target_finding_ids=[str(finding.id)],
                    ),
                    _objection(
                        objection_id="da-inference",
                        attacks="inference",
                        target_claim_id="c1",
                        remediation_hint="re_deliberate",
                    ),
                ]
            )
        )
    )

    objections = agent.object_to(_memo([claim]), [finding])

    by_id = {o.objection_id: o for o in objections}
    assert by_id["da-evidence"].attacks == "evidence"
    assert by_id["da-evidence"].target_finding_ids == [str(finding.id)]
    assert by_id["da-inference"].attacks == "inference"
    assert by_id["da-inference"].target_claim_id == "c1"


def test_a_target_naming_nothing_real_is_dropped() -> None:
    """Same posture as the synthesis citation check: never store a fake target."""
    finding = _finding()
    invented = str(uuid4())
    objections = _validate_objection_targets(
        [
            Objection(
                **_objection(
                    objection_id="da-001",
                    target_finding_ids=[invented],
                    target_claim_id="c-nonexistent",
                )
            )
        ],
        _memo([]),
        [finding],
    )
    assert objections[0].target_finding_ids == []
    assert objections[0].target_claim_id is None


def test_an_inference_objection_is_not_routed_to_re_probe() -> None:
    """Re-probing gathers evidence an inference objection already conceded."""
    finding = _finding()
    agent = DevilsAdvocateAgent(
        _StubClient(
            json.dumps([_objection(attacks="inference", remediation_hint="re_probe")])
        )
    )

    objections = agent.object_to(_memo([]), [finding])

    assert objections[0].attacks == "inference"
    assert objections[0].remediation_hint == "re_deliberate"


def test_an_evidence_objection_keeps_its_re_probe_route() -> None:
    """The repair above must not fire on the case re_probe genuinely fixes."""
    finding = _finding()
    agent = DevilsAdvocateAgent(
        _StubClient(
            json.dumps([_objection(attacks="evidence", remediation_hint="re_probe")])
        )
    )

    objections = agent.object_to(_memo([]), [finding])

    assert objections[0].remediation_hint == "re_probe"


def test_an_unstated_attack_type_defaults_rather_than_failing() -> None:
    """An older or sloppier model must not cost us the objection itself."""
    finding = _finding()
    payload = _objection()
    del payload["attacks"]
    agent = DevilsAdvocateAgent(_StubClient(json.dumps([payload])))

    objections = agent.object_to(_memo([]), [finding])

    assert objections[0].attacks == "evidence"
    assert objections[0].argument  # the objection survived intact


def test_the_default_objection_still_carries_an_attack_type() -> None:
    """The forced-dissent fallback must satisfy the same contract as a real one."""
    agent = DevilsAdvocateAgent(_StubClient("not json"))

    objections = agent.object_to(_memo([]), [_finding()])

    assert len(objections) == 1
    assert objections[0].attacks in {"evidence", "inference"}
