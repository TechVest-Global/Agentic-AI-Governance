"""A video generation is not an LLM call and must not share its 60s budget.

CM-033 Temporal Consistency probed the target through the shared
LLM_CALL_TIMEOUT_SECONDS (default 60s). A Sora-class render runs for minutes, so
the probe could not succeed: every run recorded
"target did not return a video: timed out" and the metric was skipped without the
target ever having had a chance to answer. Across the whole run history CM-033
had never produced a score.
"""

from __future__ import annotations

import json
from unittest.mock import patch
from uuid import uuid4

import pytest
from app.core.config import get_settings
from app.models.ai_system import AISystem
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.vision_evaluator import _evaluate_temporal_consistency
from app.services.model_clients.base import TargetModelRequest
from app.services.model_clients.generic_http import GenericHTTPTargetModelClient


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _metric() -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id="CM-033",
        name="Temporal Consistency",
        version="1",
        dimension="robustness",
        tool_name="vision",
        scoring_config={"formula": "temporal_consistency"},
        threshold_rules={},
    )


class _CapturingTarget:
    provider = "t"
    credential_ref = "none"
    supports_media = True

    def __init__(self) -> None:
        self.requests: list[TargetModelRequest] = []

    def invoke(self, request):  # noqa: ANN001 - test double
        self.requests.append(request)
        raise TimeoutError("timed out")


def test_the_video_probe_asks_for_the_video_budget_not_the_llm_one() -> None:
    target = _CapturingTarget()
    evaluation_input = MetricEvaluationInput(
        metric=_metric(),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=AISystem(
            id=uuid4(),
            name="Marketing Campaign Generator",
            owner="o",
            system_type="content_generation",
            deployment_environment="dev",
            model_provider="openai",
            target_endpoint_ref="http://localhost:8001",
            selected_frameworks=[],
        ),
        target_client=target,
        target_endpoint_ref="http://localhost:8001/api/compliance/probe/video",
        run_id=None,
    )

    with (
        patch("app.services.evaluators.vision_evaluator._judge_ready", return_value=True),
        patch("app.services.evaluators.vision_evaluator._capability_endpoint", return_value=None),
    ):
        result = _evaluate_temporal_consistency(evaluation_input, _metric(), "temporal_consistency")

    settings = get_settings()
    assert len(target.requests) == 1
    sent = target.requests[0].timeout_seconds
    assert sent == settings.video_generation_timeout_seconds
    assert sent != settings.llm_call_timeout_seconds, "video must not reuse the LLM budget"
    assert sent >= 300, "a video render needs minutes, not seconds"
    # The skip now says what the budget actually was, so a real timeout is
    # distinguishable from a too-short clock.
    assert f"{settings.video_generation_timeout_seconds:.0f}s" in result.payload["skipped_reason"]


def test_the_http_adapter_honors_a_per_probe_timeout() -> None:
    """The override is worthless if the client keeps using its constructor value."""
    client = GenericHTTPTargetModelClient(endpoint="http://localhost:8001", api_key=None, timeout=60.0)
    seen: dict[str, float] = {}

    class _Resp:
        def read(self):
            return json.dumps({"response": "ok"}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def _fake_urlopen(req, timeout=None):  # noqa: ANN001 - test double
        seen["timeout"] = timeout
        return _Resp()

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        client.invoke(
            TargetModelRequest(
                endpoint_ref="http://localhost:8001/api/compliance/probe/video",
                prompt="render a clip",
                timeout_seconds=600.0,
            )
        )
    assert seen["timeout"] == 600.0

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        client.invoke(
            TargetModelRequest(
                endpoint_ref="http://localhost:8001/api/compliance/probe/text",
                prompt="hello",
            )
        )
    assert seen["timeout"] == 60.0, "an ordinary probe keeps the client default"
