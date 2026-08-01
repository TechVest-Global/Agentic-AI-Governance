"""Every dimension agent must leave a record when it exits without probing.

A specialist agent probes only when one of its owned metrics failed or is
pending — unless the system is high-risk, in which case passes get verified
with live evidence too (ModelBackedAgent._verify_even_when_passing). So on a
medium-tier system whose metrics all passed, agents legitimately do nothing.

What they must NOT do is return silently. "Agent completed, 0 findings" reads
identically to "this dimension was probed and nothing was wrong", and only the
second is evidence of safety. dimension_not_probed_finding exists to keep those
apart, and every dimension agent has to reach for it.

Found by a live TechVest run: six agents exited on passing metrics, five
recorded a coverage_gap finding, and compliance_mapper recorded nothing at all
because it still had a bare ``return findings``. Parametrised over every
dimension agent so the next one added can't repeat it.
"""

from uuid import uuid4

import pytest
from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus, RiskTier
from app.models.evidence import MetricResult
from app.services.agents.base import AgentContext
from app.services.agents.model_backed.bias_agent import BiasAuditorAgent
from app.services.agents.model_backed.compliance_mapper import ComplianceMapperAgent
from app.services.agents.model_backed.drift_agent import DriftAnalystAgent
from app.services.agents.model_backed.explainability_agent import ExplainabilityAgent
from app.services.agents.model_backed.misuse_agent import MisuseDetectorAgent
from app.services.agents.model_backed.quality_agent import QualityEvaluatorAgent


class _ExplodingClient:
    """Any use of a model client here means the agent probed when it shouldn't."""

    provider = "test"
    credential_ref = "TEST_KEY"
    supports_media = False

    def invoke(self, request):  # noqa: ANN001, ANN201
        raise AssertionError("agent probed the target despite all owned metrics passing")

    def complete(self, request):  # noqa: ANN001, ANN201
        raise AssertionError("agent called the governance model despite all metrics passing")


# (agent class, a metric_id the agent owns, that metric's dimension)
DIMENSION_AGENTS = [
    (QualityEvaluatorAgent, "CM-001", "task_fulfilment"),
    (ExplainabilityAgent, "CM-006", "groundedness"),
    (BiasAuditorAgent, "CM-017", "fairness"),
    (MisuseDetectorAgent, "CM-024", "privacy"),
    (DriftAnalystAgent, "CM-031", "robustness"),
    (ComplianceMapperAgent, "CM-035", "transparency"),
]


def _passing_metric(metric_id: str, dimension: str) -> MetricResult:
    return MetricResult(
        run_id=uuid4(),
        metric_id=metric_id,
        dimension=dimension,
        tool_name="deepeval",
        status=MetricResultStatus.passed,
        raw_score=1.0,
        normalized_score=1.0,
        threshold=0.7,
        passed=True,
        evidence_ids=[],
    )


def _medium_risk_context(metric: MetricResult) -> AgentContext:
    return AgentContext(
        ai_system=AISystem(
            name="TechVest AI Chatbot",
            owner="techvest",
            system_type="chatbot",
            risk_tier=RiskTier.medium,
            selected_frameworks=["eu_ai_act"],
        ),
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=[metric],
        existing_findings=[],
    )


@pytest.mark.parametrize(
    ("agent_class", "metric_id", "dimension"),
    DIMENSION_AGENTS,
    ids=[cls.name for cls, _, _ in DIMENSION_AGENTS],
)
def test_agent_records_that_it_did_not_probe(agent_class, metric_id, dimension) -> None:
    agent = agent_class(_ExplodingClient(), _ExplodingClient())

    findings = agent.evaluate(_medium_risk_context(_passing_metric(metric_id, dimension)))

    assert findings, (
        f"{agent_class.name} returned NO findings after skipping its probes — the run "
        f"reads as 'dimension checked, nothing wrong' when nothing was checked"
    )
    coverage_gaps = [f for f in findings if f.finding_type == "coverage_gap"]
    assert coverage_gaps, (
        f"{agent_class.name} produced findings {[f.finding_type for f in findings]} but no "
        f"coverage_gap recording that it never probed"
    )
    gap = coverage_gaps[0]
    assert gap.payload.get("generated_by") == "unprobed_dimension_gate"
    # The reason has to say WHY, so a report can state its own coverage limit.
    assert "passed" in gap.summary.lower()
    assert gap.severity.value == "info", "a coverage limit is not a compliance verdict"


def test_the_reason_names_the_risk_tier_that_would_have_forced_probing() -> None:
    """The record is only useful if it explains what would change the outcome."""
    agent = BiasAuditorAgent(_ExplodingClient(), _ExplodingClient())

    findings = agent.evaluate(_medium_risk_context(_passing_metric("CM-017", "fairness")))

    summary = findings[0].summary
    assert "medium" in summary and "high" in summary, summary
