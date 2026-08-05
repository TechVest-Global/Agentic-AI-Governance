"""A metric that never produced a real result must never be reported the same
way as one that ran and genuinely failed.

Found on a live Marketing Campaign Generator run: presidio's CM-022–025 hit a
dead target connection (status=error) and misuse_agent's deterministic
fallback reported "Security metric failed... may not adequately resist
adversarial prompt injection" — a critical finding implying an observed PII
leak, manufactured from zero probes that ever reached anything. The same
conflation hits every agent whose owned metrics include a permanently-skipped
tool integration: risk_scorer's oversight dimension carries three metrics
(CM-040/041/044) that can NEVER produce a real score (tool: langfuse, but
their formulas need a workflow_db integration that doesn't exist — see
langfuse_evaluator.py), so every deterministic-fallback call on that dimension
used to report 3 of 5 metrics as "requires review" from no evidence at all.

``metric_failed()``/``metric_pending()`` deliberately group failed+error and
pending+skipped for deciding WHETHER an agent has anything to act on — correct
there. ``split_attention_metrics`` splits them back apart for what to SAY:
only a genuinely-failed metric gets the agent's normal severity/"did not
pass" language; a skipped/errored/pending metric gets an info-severity
coverage_gap finding instead, naming exactly which metric and why.

Parametrised over every dimension agent, mirroring
test_unprobed_dimension_is_recorded.py, so the next agent added can't
reintroduce the conflation.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus, RiskTier
from app.models.evidence import MetricResult
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import metric_not_evaluated_finding, split_attention_metrics
from app.services.agents.model_backed.bias_agent import BiasAuditorAgent
from app.services.agents.model_backed.compliance_mapper import ComplianceMapperAgent
from app.services.agents.model_backed.drift_agent import DriftAnalystAgent
from app.services.agents.model_backed.explainability_agent import ExplainabilityAgent
from app.services.agents.model_backed.misuse_agent import MisuseDetectorAgent
from app.services.agents.model_backed.quality_agent import QualityEvaluatorAgent
from app.services.agents.model_backed.risk_scorer import RiskScorerAgent

# ── pure unit tests of the shared helper ─────────────────────────────────────


def _metric(status: MetricResultStatus, *, passed=None, metric_id="CM-001") -> MetricResult:
    return MetricResult(
        run_id=uuid4(), metric_id=metric_id, dimension="quality", tool_name="deepeval",
        status=status, raw_score=0.5, normalized_score=0.5, threshold=0.8,
        passed=passed, evidence_ids=[],
    )


def test_split_separates_failed_from_never_evaluated():
    failed = _metric(MetricResultStatus.failed, passed=False, metric_id="F")
    skipped = _metric(MetricResultStatus.skipped, metric_id="S")
    errored = _metric(MetricResultStatus.error, metric_id="E")
    pending = _metric(MetricResultStatus.pending, metric_id="P")

    genuinely_failed, never_evaluated = split_attention_metrics(
        [failed, skipped, errored, pending]
    )

    assert [m.metric_id for m in genuinely_failed] == ["F"]
    assert {m.metric_id for m in never_evaluated} == {"S", "E", "P"}


def test_explicit_passed_false_overrides_status_either_way():
    """An evaluator that set passed=False made a real claim, whatever its
    status string — must never be silently reclassified as 'not evaluated'."""
    weird = _metric(MetricResultStatus.skipped, passed=False, metric_id="W")

    genuinely_failed, never_evaluated = split_attention_metrics([weird])

    assert [m.metric_id for m in genuinely_failed] == ["W"]
    assert never_evaluated == []


@pytest.mark.parametrize(
    ("status", "expected_phrase"),
    [
        (MetricResultStatus.skipped, "skipped"),
        (MetricResultStatus.error, "errored"),
        (MetricResultStatus.pending, "has not completed"),
    ],
)
def test_not_evaluated_finding_names_the_real_reason(status, expected_phrase):
    metric = _metric(status, metric_id="CM-040")

    f = metric_not_evaluated_finding(agent_name="risk_scorer", metric=metric)

    assert f.finding_type == "coverage_gap", "must be evidence-exempt like every other coverage gap"
    assert f.severity.value == "info", "absence of evidence is not a compliance verdict"
    assert "CM-040" in f.title
    assert expected_phrase in f.summary
    assert f.payload["metric_id"] == "CM-040"


# ── integration: each agent's deterministic fallback, mixed metric statuses ─


class _CleanTarget:
    provider = "test"
    credential_ref = None
    supports_media = False

    def invoke(self, request):  # noqa: ANN001, ANN201
        return SimpleNamespace(
            sanitized_output="A generic, unremarkable reply.",
            raw_output="A generic, unremarkable reply.",
            media=[], trace_id="t", latency_ms=1, metadata={}, provider="test",
            endpoint_ref=request.endpoint_ref,
        )


class _NonJSONGovernance:
    """Forces every agent onto its deterministic-fallback path — the one that
    had the conflation bug — rather than the governance-JSON path."""

    provider = "test"
    credential_ref = None

    def complete(self, request):  # noqa: ANN001, ANN201
        return SimpleNamespace(
            content="I'm not able to return structured JSON right now.",
            provider="test", deployment_name=None, trace_id="t", latency_ms=1, metadata={},
        )


# (agent_class, metric_id_to_fail, metric_id_to_skip, dimension)
DIMENSION_AGENTS = [
    (QualityEvaluatorAgent, "CM-001", "CM-002", "task_fulfilment"),
    (ExplainabilityAgent, "CM-006", "CM-009", "groundedness"),
    (BiasAuditorAgent, "CM-017", "CM-019", "fairness"),
    (MisuseDetectorAgent, "CM-013", "CM-024", "safety"),
    (DriftAnalystAgent, "CM-031", "CM-030", "robustness"),
    (ComplianceMapperAgent, "CM-035", "CM-039", "transparency"),
    (RiskScorerAgent, "CM-042", "CM-040", "oversight"),
]


def _failed_metric(metric_id: str, dimension: str) -> MetricResult:
    return MetricResult(
        run_id=uuid4(), metric_id=metric_id, dimension=dimension, tool_name="deepeval",
        status=MetricResultStatus.failed, raw_score=0.2, normalized_score=0.2,
        threshold=0.8, passed=False, evidence_ids=[],
    )


def _skipped_metric(metric_id: str, dimension: str) -> MetricResult:
    return MetricResult(
        run_id=uuid4(), metric_id=metric_id, dimension=dimension, tool_name="langfuse",
        status=MetricResultStatus.skipped, raw_score=None, normalized_score=None,
        threshold=None, passed=None, evidence_ids=[],
    )


def _medium_risk_context(*metrics: MetricResult) -> AgentContext:
    return AgentContext(
        ai_system=AISystem(
            name="Test System", owner="o", system_type="chatbot",
            risk_tier=RiskTier.medium, selected_frameworks=["eu_ai_act"],
        ),
        context_profile=None,
        capabilities=[],
        evidence=[],
        metric_results=list(metrics),
        existing_findings=[],
    )


@pytest.mark.parametrize(
    ("agent_class", "failed_id", "skipped_id", "dimension"),
    DIMENSION_AGENTS,
    ids=[cls.name for cls, *_ in DIMENSION_AGENTS],
)
def test_agent_never_reports_a_skipped_metric_as_a_failure(
    agent_class, failed_id, skipped_id, dimension
) -> None:
    agent = agent_class(_CleanTarget(), _NonJSONGovernance())
    context = _medium_risk_context(
        _failed_metric(failed_id, dimension), _skipped_metric(skipped_id, dimension)
    )

    findings: list[FindingCreate] = agent.evaluate(context)

    coverage_gaps = [f for f in findings if f.finding_type == "coverage_gap"]
    skip_notes = [f for f in coverage_gaps if f.payload.get("metric_id") == skipped_id]
    assert skip_notes, (
        f"{agent_class.name} produced {[(f.finding_type, f.payload.get('metric_id')) for f in findings]} "
        f"but no coverage_gap naming the skipped metric {skipped_id}"
    )
    assert skip_notes[0].severity.value == "info"
    # The skipped metric must appear in exactly that one coverage_gap finding
    # and nowhere else — it must not ALSO show up in a non-coverage_gap finding
    # as if it had produced real evidence.
    assert not any(
        f.finding_type != "coverage_gap" and f.payload.get("metric_id") == skipped_id
        for f in findings
    )

    # The genuinely failed metric must still be reported, and NOT suppressed
    # or reclassified as a coverage_gap — the fix must not hide a real finding.
    failed_metric_findings = [
        f for f in findings
        if f.finding_type != "coverage_gap" and f.payload.get("metric_id") == failed_id
    ]
    assert failed_metric_findings, (
        f"{agent_class.name} dropped the genuinely failed metric {failed_id} entirely"
    )


def test_the_never_evaluated_metric_never_gets_the_agents_severity_language() -> None:
    """Concrete regression: risk_scorer used to write "Oversight metric
    requires review: CM-040 ... did not pass" for a metric that never ran."""
    agent = RiskScorerAgent(_CleanTarget(), _NonJSONGovernance())
    context = _medium_risk_context(
        _failed_metric("CM-042", "oversight"), _skipped_metric("CM-040", "oversight")
    )

    findings = agent.evaluate(context)

    cm040_findings = [f for f in findings if f.payload.get("metric_id") == "CM-040"]
    assert len(cm040_findings) == 1
    assert cm040_findings[0].finding_type == "coverage_gap"
    assert "did not pass" not in cm040_findings[0].summary
    assert "requires review" not in cm040_findings[0].title
