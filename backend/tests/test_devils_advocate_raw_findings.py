"""Covers the Devil's Advocate seeing raw findings, not just the memo prose.

Previously object_to(memo) received only the Synthesis memo's summarized
fields — if Synthesis omitted or mischaracterized a finding, the "adversarial"
agent had no way to notice, since it could only critique the story it was
handed. object_to now also receives the raw findings so the prompt lets it
cross-check the narrative against ground truth.
"""

from uuid import uuid4

from app.configs.prompt_registry import PromptRegistry
from app.models.enums import Severity
from app.models.finding import Finding
from app.services.deliberation_council.devils_advocate_agent import DevilsAdvocateAgent
from app.services.deliberation_council.synthesis_agent import SynthesisMemo
from app.services.model_clients.base import GovernanceModelRequest, GovernanceModelResponse


class _CapturingGovernanceClient:
    provider = "test"
    credential_ref = None

    def __init__(self) -> None:
        self.last_request: GovernanceModelRequest | None = None

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        self.last_request = request
        return GovernanceModelResponse(
            provider="test",
            deployment_name=None,
            content=(
                '[{"objection_id": "da-001", "target_agent": null, '
                '"category": "scope_gap", "argument": "test", '
                '"suggested_fix": "test", "remediation_hint": "re_deliberate"}]'
            ),
            trace_id="trace-1",
            latency_ms=1,
        )


def _memo() -> SynthesisMemo:
    return SynthesisMemo(
        narrative="Everything looks fine.",
        risk_summary="Low risk.",
        dimensions=["bias"],
        sample_sizes={"bias_agent": 10},
        conflicts=[],
        iteration=1,
        raw_response="{}",
    )


def test_devils_advocate_prompt_includes_raw_findings_not_just_the_memo() -> None:
    client = _CapturingGovernanceClient()
    agent = DevilsAdvocateAgent(client, PromptRegistry.from_directory())
    finding = Finding(
        id=uuid4(),
        run_id=uuid4(),
        finding_type="bias",
        title="Disparate outcome detected",
        summary="Candidate B was rated lower despite identical qualifications.",
        severity=Severity.high,
        dimension="bias",
        agent_name="bias_agent",
    )

    agent.object_to(_memo(), [finding])

    assert client.last_request is not None
    prompt = client.last_request.prompt
    # The raw finding — omitted from the memo's rosy narrative above — must
    # reach the prompt so the DA can catch the discrepancy.
    assert "Disparate outcome detected" in prompt
    assert str(finding.id) in prompt
    assert "RAW FINDINGS" in prompt


def test_devils_advocate_prompt_handles_no_findings() -> None:
    client = _CapturingGovernanceClient()
    agent = DevilsAdvocateAgent(client, PromptRegistry.from_directory())

    agent.object_to(_memo(), [])

    assert client.last_request is not None
    assert "(none)" in client.last_request.prompt
