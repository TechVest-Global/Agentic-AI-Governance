"""Synthesis provenance: claims must cite real findings, and coverage must be honest.

The Council's memo used to be prose a reader could not trace back to evidence.
These tests pin the properties that make the new claims/unused_findings contract
worth trusting: every edge resolves to a real finding, invented ones are dropped
rather than displayed, and what the model failed to account for is reported
rather than hidden.
"""

from __future__ import annotations

import json
from uuid import uuid4

from app.models.enums import Severity
from app.models.finding import Finding
from app.services.deliberation_council.synthesis_agent import (
    SynthesisAgent,
    _validate_provenance,
)


def _finding(**overrides) -> Finding:
    defaults = dict(
        id=uuid4(),
        run_id=uuid4(),
        finding_type="observation",
        title="Disclosure omitted under paraphrase",
        summary="The system dropped its AI-disclosure line when asked indirectly.",
        severity=Severity.high,
        dimension="transparency",
        agent_name="compliance_mapper",
    )
    defaults.update(overrides)
    return Finding(**defaults)


class _StubClient:
    """Governance client returning one canned response."""

    def __init__(self, content: str) -> None:
        self._content = content
        self.calls = 0

    def complete(self, request):  # noqa: ANN001 - test double
        self.calls += 1
        return type("R", (), {"content": self._content})()


class _FlakyClient:
    """Returns each queued response in turn — models an intermittent bad parse."""

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.calls = 0

    def complete(self, request):  # noqa: ANN001 - test double
        content = self._responses[min(self.calls, len(self._responses) - 1)]
        self.calls += 1
        return type("R", (), {"content": content})()


def _memo_json(claims: list[dict], unused: list[dict] | None = None) -> str:
    return json.dumps(
        {
            "narrative": "Transparency controls fail under paraphrase pressure.",
            "risk_summary": "Disclosure is not robust.",
            "dimensions": ["transparency"],
            "sample_sizes": {},
            "conflicts": [],
            "claims": claims,
            "unused_findings": unused or [],
            "iteration": 1,
        }
    )


def test_claims_cite_findings_with_a_usage_role() -> None:
    """The whole point: which findings were used, and how."""
    primary, corroborating = _finding(), _finding(agent_name="bias_auditor")
    agent = SynthesisAgent(
        _StubClient(
            _memo_json(
                [
                    {
                        "claim_id": "c1",
                        "statement": "Disclosure fails under paraphrase.",
                        "citations": [
                            {"finding_id": str(primary.id), "role": "primary_evidence"},
                            {"finding_id": str(corroborating.id), "role": "corroboration"},
                        ],
                    }
                ]
            )
        )
    )

    memo = agent.synthesize(
        findings=[primary, corroborating], metric_results=[], iteration=1
    )

    assert len(memo.claims) == 1
    claim = memo.claims[0]
    assert {(c.finding_id, c.role) for c in claim.citations} == {
        (str(primary.id), "primary_evidence"),
        (str(corroborating.id), "corroboration"),
    }
    assert memo.coverage.is_complete
    assert memo.coverage.cited == 2


def test_a_citation_naming_no_real_finding_is_dropped() -> None:
    """A fabricated citation is worse than a missing one — it survives review."""
    real = _finding()
    invented = uuid4()
    agent = SynthesisAgent(
        _StubClient(
            _memo_json(
                [
                    {
                        "claim_id": "c1",
                        "statement": "Disclosure fails.",
                        "citations": [
                            {"finding_id": str(real.id), "role": "primary_evidence"},
                            {"finding_id": str(invented), "role": "primary_evidence"},
                        ],
                    }
                ]
            )
        )
    )

    memo = agent.synthesize(findings=[real], metric_results=[], iteration=1)

    cited = [c.finding_id for c in memo.claims[0].citations]
    assert cited == [str(real.id)]
    assert any(str(invented) in entry for entry in memo.coverage.invalid_citations)


def test_an_unknown_role_is_dropped_rather_than_coerced() -> None:
    """Coercing would invent a relationship the model never expressed."""
    finding = _finding()
    memo = _validate_provenance(
        _build_memo(
            [
                {
                    "claim_id": "c1",
                    "statement": "Disclosure fails.",
                    "citations": [{"finding_id": str(finding.id), "role": "vibes"}],
                }
            ]
        ),
        [finding],
    )

    assert memo.claims[0].citations == []
    assert "unknown role" in memo.coverage.invalid_citations[0]
    # Dropping the edge must make the finding visibly unaccounted, not silently fine.
    assert memo.coverage.unaccounted == [str(finding.id)]


def test_uncited_findings_are_reported_not_hidden() -> None:
    """A tidy panel over incomplete accounting is worse than the prose it replaced."""
    used, ignored = _finding(), _finding(agent_name="drift_analyst")
    agent = SynthesisAgent(
        _StubClient(
            _memo_json(
                [
                    {
                        "claim_id": "c1",
                        "statement": "Disclosure fails.",
                        "citations": [
                            {"finding_id": str(used.id), "role": "primary_evidence"}
                        ],
                    }
                ]
            )
        )
    )

    memo = agent.synthesize(findings=[used, ignored], metric_results=[], iteration=1)

    assert memo.coverage.total_findings == 2
    assert memo.coverage.cited == 1
    assert memo.coverage.unaccounted == [str(ignored.id)]
    assert not memo.coverage.is_complete


def test_declaring_a_finding_unused_counts_as_accounting_for_it() -> None:
    """'Ignored' becomes a recorded decision with a reason, not an absence."""
    used, passed_over = _finding(), _finding(agent_name="drift_analyst")
    agent = SynthesisAgent(
        _StubClient(
            _memo_json(
                [
                    {
                        "claim_id": "c1",
                        "statement": "Disclosure fails.",
                        "citations": [
                            {"finding_id": str(used.id), "role": "primary_evidence"}
                        ],
                    }
                ],
                unused=[{"finding_id": str(passed_over.id), "reason": "out_of_scope"}],
            )
        )
    )

    memo = agent.synthesize(findings=[used, passed_over], metric_results=[], iteration=1)

    assert memo.coverage.is_complete
    assert memo.unused_findings[0].reason == "out_of_scope"


def test_a_degraded_memo_still_carries_a_coverage_record() -> None:
    """Otherwise 'no claims' and 'claims never checked' look identical downstream."""
    finding = _finding()
    agent = SynthesisAgent(_StubClient("not json at all"))

    memo = agent.synthesize(findings=[finding], metric_results=[], iteration=1)

    assert memo.claims == []
    assert memo.coverage is not None
    assert memo.coverage.total_findings == 1
    assert memo.coverage.unaccounted == [str(finding.id)]


def test_an_unparseable_response_is_retried_before_giving_up() -> None:
    """One malformed response must not cost the run its whole provenance.

    Observed live: the same 34-finding input parsed cleanly on one call and
    came back malformed on another, so the failure is intermittent rather than
    systematic — exactly what a single retry is for.
    """
    finding = _finding()
    good = _memo_json(
        [
            {
                "claim_id": "c1",
                "statement": "Disclosure fails.",
                "citations": [{"finding_id": str(finding.id), "role": "primary_evidence"}],
            }
        ]
    )
    client = _FlakyClient(["{ this is not valid json", good])

    memo = SynthesisAgent(client).synthesize(
        findings=[finding], metric_results=[], iteration=1
    )

    assert client.calls == 2
    assert len(memo.claims) == 1
    assert memo.coverage.is_complete


def test_two_bad_responses_degrade_rather_than_raise() -> None:
    finding = _finding()
    client = _FlakyClient(["nope", "still nope"])

    memo = SynthesisAgent(client).synthesize(
        findings=[finding], metric_results=[], iteration=1
    )

    assert client.calls == 2
    assert memo.claims == []
    assert memo.coverage.total_findings == 1


def _build_memo(claims: list[dict]):
    """Parse a memo straight from claim dicts, bypassing the LLM call."""
    from app.services.deliberation_council.synthesis_agent import _parse_memo

    return _parse_memo(_memo_json(claims), 1)
