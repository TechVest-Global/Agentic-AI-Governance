"""A finding must say who actually wrote it.

``payload["generated_by"]`` is the provenance discriminator an auditor uses to
tell a rule-derived conclusion from a model-written one. The two are very
different evidentiary claims: a deterministic finding is reproducible from the
metric results alone, while a governance-model finding is an LLM's prose
judgement that a reviewer may need to challenge.

The ``finding()`` helper hardcoded ``"deterministic_agent"`` and no caller could
override it, so EVERY LLM-authored finding on the ``_findings_from_governance``
path claimed deterministic provenance it did not have. Found on a live Marketing
Campaign Generator run: drift_agent's critical "All Drift Metrics Skipped"
finding was written by the governance model — its title matches neither
deterministic template — yet was stored as ``deterministic_agent``.

Parametrised over every agent's governance path so the next agent added cannot
repeat it, and paired with a default-preservation test so the fix cannot drift
the other way and start labelling the genuinely deterministic paths as
model-authored.
"""

from uuid import uuid4

import pytest
from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus, RiskTier, Severity
from app.models.evidence import MetricResult
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding
from app.services.agents.model_backed import (
    bias_agent,
    compliance_mapper,
    drift_agent,
    explainability_agent,
    misuse_agent,
    quality_agent,
    risk_scorer,
)

# Every module exposing a governance-JSON path. The signatures differ only in
# whether the agent passes tool_calls through, so `takes_tool_calls` adapts the
# call rather than duplicating the test body.
GOVERNANCE_PATHS = [
    ("bias_agent", bias_agent, True),
    ("drift_agent", drift_agent, False),
    ("quality_agent", quality_agent, False),
    ("compliance_mapper", compliance_mapper, False),
    ("explainability_agent", explainability_agent, True),
    ("misuse_agent", misuse_agent, True),
    ("risk_scorer", risk_scorer, False),
]

# A minimal well-formed governance-model reply. metric_id is null on purpose:
# that is the common real case (the LLM cites an id matching nothing) and it
# keeps this test independent of each agent's owned metric ids.
_LLM_ITEM = {
    "title": "Model-authored concern",
    "summary": "The governance model wrote this sentence, not a rule.",
    "severity": "high",
    "confidence": 0.77,
    "recommended_action": "Review manually.",
    "metric_id": None,
}


def _context() -> AgentContext:
    metric = MetricResult(
        run_id=uuid4(),
        metric_id="CM-999",
        dimension="robustness",
        tool_name="deepeval",
        status=MetricResultStatus.failed,
        raw_score=0.1,
        normalized_score=0.1,
        threshold=0.7,
        passed=False,
        evidence_ids=[],
    )
    return AgentContext(
        ai_system=AISystem(
            name="Marketing Campaign Generator",
            owner="techvest",
            system_type="content_generation",
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
    ("name", "module", "takes_tool_calls"),
    GOVERNANCE_PATHS,
    ids=[name for name, _, _ in GOVERNANCE_PATHS],
)
def test_governance_authored_findings_are_labelled_governance_model(
    name, module, takes_tool_calls
) -> None:
    context = _context()
    args = ([_LLM_ITEM], context, []) if takes_tool_calls else ([_LLM_ITEM], context)

    results = module._findings_from_governance(*args, reviewed_metrics=context.metric_results)

    assert results, f"{name} dropped a well-formed governance finding"
    for f in results:
        assert f.payload.get("generated_by") == "governance_model", (
            f"{name} stored an LLM-authored finding as "
            f"{f.payload.get('generated_by')!r} — an auditor cannot tell it from a "
            f"reproducible, rule-derived conclusion"
        )


def test_finding_helper_still_defaults_to_deterministic() -> None:
    """The deterministic fallbacks and structural checks are the majority of
    callers and pass nothing, so the default must stay as it was — otherwise
    this fix would mislabel them in the opposite direction."""
    f = finding(
        finding_type="drift",
        title="Drift metric failed: CM-030",
        summary="Derived from the metric result alone.",
        severity=Severity.high,
        dimension="robustness",
        agent_name="drift_agent",
        recommended_action="Retrain.",
    )

    assert f.payload["generated_by"] == "deterministic_agent"
