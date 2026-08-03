"""Image safety is scored on a sample, and the sample is reported honestly.

CM-045 sent one prompt and judged one image, so its "rate" could only ever be
1.0 or 0.0 — a coin flip that a 0.95 threshold cannot meaningfully sit above.
These tests pin the multi-probe sample and, just as importantly, that a run
which lost most of its probes says so instead of scoring on the survivor.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from app.core.config import get_settings
from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.vision_evaluator import _IMAGE_PROBE_PROMPTS, VisionEvaluator
from app.services.model_clients.base import MediaAsset, TargetModelResponse

_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


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


def _metric() -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id="CM-045",
        name="Visual content safety",
        version="1",
        dimension="safety",
        tool_name="vision",
        scoring_config={"formula": "visual_content_safety_rate"},
        threshold_rules={},
    )


class _ImageTarget:
    """Returns an image for the first ``succeed`` probes, then raises."""

    provider = "t"
    credential_ref = "none"
    supports_media = True

    def __init__(self, succeed: int = 99) -> None:
        self._succeed = succeed
        self.prompts: list[str] = []

    def invoke(self, request):  # noqa: ANN001 - test double
        self.prompts.append(request.prompt)
        if len(self.prompts) > self._succeed:
            raise RuntimeError("FLUX generation failed")
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output="ok",
            sanitized_output="ok",
            trace_id="t",
            latency_ms=1,
            media=[MediaAsset(kind="image", mime_type="image/png", data_base64=_PNG)],
        )


def _evaluate(target, verdicts):
    """Run the evaluator with the judge stubbed to the given verdict sequence."""
    calls = {"n": 0}

    def _fake_judge(_client, _deployment, _uri):
        verdict = verdicts[min(calls["n"], len(verdicts) - 1)]
        calls["n"] += 1
        return verdict

    evaluation_input = MetricEvaluationInput(
        metric=_metric(),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=_system(),
        target_client=target,
        target_endpoint_ref="http://localhost:8001/api/compliance/probe/image",
        run_id=None,
    )
    with (
        patch("app.services.evaluators.vision_evaluator._judge_ready", return_value=True),
        patch("app.services.evaluators.vision_evaluator._vision_client", return_value=(object(), "gpt-4.1")),
        patch("app.services.evaluators.vision_evaluator._judge_image", side_effect=_fake_judge),
        patch("app.services.evaluators.vision_evaluator._capability_endpoint", return_value=None),
    ):
        return VisionEvaluator().evaluate(evaluation_input)


_SAFE = {"unsafe": False, "category": "", "reason": "fine"}
_UNSAFE = {"unsafe": True, "category": "violence", "reason": "bad"}


def test_several_distinct_prompts_are_sent() -> None:
    """One prompt cannot distinguish 'never asked' from 'guardrails hold'."""
    target = _ImageTarget()

    result = _evaluate(target, [_SAFE])

    assert len(target.prompts) == 4
    assert len(set(target.prompts)) == 4, "probes must vary, not repeat one prompt"
    assert result.payload["probes_attempted"] == 4
    assert result.payload["image_count"] == 4


def test_the_rate_is_now_a_real_fraction() -> None:
    """The whole point: 1 unsafe of 4 is 0.75, not 0.0."""
    result = _evaluate(_ImageTarget(), [_SAFE, _UNSAFE, _SAFE, _SAFE])

    assert result.payload["unsafe_count"] == 1
    assert result.payload["unsafe_rate"] == 0.25
    assert result.normalized_score == 0.75


def test_lost_probes_are_reported_rather_than_scored_around() -> None:
    """Scoring 1.0 on the one image that came back is not four clean images."""
    target = _ImageTarget(succeed=1)

    result = _evaluate(target, [_SAFE])

    assert result.payload["probes_attempted"] == 4
    assert result.payload["image_count"] == 1
    assert len(result.payload["probe_failures"]) == 3
    assert result.normalized_score == 1.0  # honest about the survivor...
    assert result.payload["image_source"] == "target_media"  # ...and about its origin


def test_the_probe_count_is_configurable_for_rate_limited_targets(monkeypatch) -> None:
    """Each probe is a real generation request; some targets cannot absorb four."""
    monkeypatch.setenv("VISION_IMAGE_PROBE_COUNT", "2")
    get_settings.cache_clear()
    target = _ImageTarget()

    _evaluate(target, [_SAFE])

    assert len(target.prompts) == 2


def test_a_target_producing_nothing_falls_back_and_labels_it() -> None:
    """A baseline-probe score says the pipeline works, not that output is safe."""
    result = _evaluate(_ImageTarget(succeed=0), [_SAFE])

    assert result.payload["image_source"] == "baseline_probe"
    assert result.payload["probes_attempted"] == 4
    assert len(result.payload["probe_failures"]) == 4
    assert result.status is MetricResultStatus.passed


def test_every_probe_prompt_is_distinct() -> None:
    assert len(set(_IMAGE_PROBE_PROMPTS)) == len(_IMAGE_PROBE_PROMPTS)
