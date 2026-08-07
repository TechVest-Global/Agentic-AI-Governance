"""A metric that judges grounding says so when there is nothing to ground against.

CM-001 (task_success_rate) and CM-004 (action_completion_rate) put
RETRIEVAL_CONTEXT in their GEval evaluation_params, and deepeval rejects a test
case whose retrieval_context is None *before* it calls the judge. On a system
with no seeded knowledge base that is every test case, so the metric raised
MissingTestCaseParamsError mid-score and surfaced as an opaque
"scoring failed: 'retrieval_context' cannot be None for the
'ActionCompletion [GEval]' metric" — observed on a live audit of the Marketing
Campaign Generator, which is an image/video generator with no retrieval corpus.

Worse than the message: the probe had already been sent. The target was asked a
question whose answer could never be scored.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import CapabilityType, MetricResultStatus, Modality
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.deepeval_evaluator import DeepEvalEvaluator

_CONTEXT_AWARE = [("CM-001", "task_success_rate"), ("CM-004", "action_completion_rate")]


def _system() -> AISystem:
    return AISystem(
        id=uuid4(),
        name="Marketing Campaign Generator",
        owner="o",
        system_type="content_generation",
        deployment_environment="dev",
        model_provider="openai",
        target_endpoint_ref="http://localhost:8001",
        selected_frameworks=[],
    )


def _metric(metric_id: str, formula: str) -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id=metric_id,
        name=formula,
        version="1",
        dimension="task_fulfilment",
        tool_name="deepeval",
        scoring_config={"formula": formula},
        threshold_rules={},
    )


class _RecordingTarget:
    """Fails loudly if probed — nothing should reach the target on a skip."""

    provider = "t"
    credential_ref = "none"
    supports_media = False

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def invoke(self, request):  # noqa: ANN001 - test double
        self.prompts.append(request.prompt)
        raise AssertionError("target was probed for a metric that cannot be scored")


def _retrieval_capability() -> AISystemCapability:
    return AISystemCapability(
        id=uuid4(),
        ai_system_id=uuid4(),
        name="brandContext",
        capability_type=CapabilityType.retrieval,
        modality=Modality.text,
        endpoint_ref="http://localhost:8001/api/compliance/probe/grounded-text",
        enabled=True,
    )


def _evaluate(metric_id: str, formula: str, *, docs: list[str], target=None, capabilities=()):
    evaluation_input = MetricEvaluationInput(
        metric=_metric(metric_id, formula),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=_system(),
        target_client=target or _RecordingTarget(),
        target_endpoint_ref="http://localhost:8001/api/compliance/probe/text",
        capabilities=capabilities,
        run_id=None,
    )
    with (
        patch(
            "app.services.evaluators.deepeval_evaluator._build_judge_client",
            return_value=object(),
        ),
        patch(
            "app.services.evaluators.deepeval_evaluator._wrap_judge_llm",
            return_value=object(),
        ),
        patch(
            "app.services.evaluators.deepeval_evaluator._build_metric",
            return_value=object(),
        ),
        patch(
            "app.services.evaluators.deepeval_evaluator._fetch_context_for_judge",
            return_value=docs,
        ),
        patch(
            "app.services.evaluators.deepeval_evaluator._design_prompt",
            return_value="designed in-domain request",
        ),
    ):
        return DeepEvalEvaluator().evaluate(evaluation_input)


@pytest.mark.parametrize(("metric_id", "formula"), _CONTEXT_AWARE)
def test_skips_with_a_reason_when_no_context_is_seeded(metric_id: str, formula: str) -> None:
    result = _evaluate(metric_id, formula, docs=[])

    assert result.status is MetricResultStatus.skipped
    reason = result.payload["skipped_reason"]
    assert "knowledge base" in reason
    # The old behaviour: deepeval's own internal message, leaked to the report.
    assert "scoring failed" not in reason
    assert "cannot be None" not in reason


@pytest.mark.parametrize(("metric_id", "formula"), _CONTEXT_AWARE)
def test_a_system_with_no_retrieval_capability_is_told_not_to_seed(
    metric_id: str, formula: str
) -> None:
    """Grounding does not apply to an endpoint that reads no corpus.

    Seeding documents here would score answers against a corpus the endpoint
    never received — a manufactured failure describing the audit setup.
    """
    result = _evaluate(metric_id, formula, docs=[], capabilities=())

    reason = result.payload["skipped_reason"]
    assert "declares no retrieval capability" in reason
    assert "Do NOT seed documents" in reason


@pytest.mark.parametrize(("metric_id", "formula"), _CONTEXT_AWARE)
def test_a_retrieval_system_missing_its_corpus_is_told_to_seed_it(
    metric_id: str, formula: str
) -> None:
    """The opposite case: grounding IS in scope and the corpus is missing."""
    result = _evaluate(
        metric_id, formula, docs=[], capabilities=(_retrieval_capability(),)
    )

    reason = result.payload["skipped_reason"]
    assert "declares a retrieval capability" in reason
    assert "seed the corpus" in reason
    assert "unverified, not clean" in reason


@pytest.mark.parametrize(("metric_id", "formula"), _CONTEXT_AWARE)
def test_the_target_is_never_probed_for_an_unscoreable_metric(
    metric_id: str, formula: str
) -> None:
    """The probe used to be sent first and thrown away when scoring blew up."""
    target = _RecordingTarget()

    _evaluate(metric_id, formula, docs=[], target=target)

    assert target.prompts == []


@pytest.mark.parametrize(("metric_id", "formula"), _CONTEXT_AWARE)
def test_a_seeded_system_still_gets_scored(metric_id: str, formula: str) -> None:
    """The guard must not turn a working RAG audit into a skip."""

    class _Target(_RecordingTarget):
        def invoke(self, request):  # noqa: ANN001 - test double
            self.prompts.append(request.prompt)
            raise RuntimeError("probe reached the target")

    target = _Target()

    result = _evaluate(metric_id, formula, docs=["a seeded policy document"], target=target)

    assert target.prompts, "a system with a knowledge base must still be probed"
    # It got past the guard and failed at the (stubbed) probe instead.
    assert "knowledge base" not in result.payload["skipped_reason"]
