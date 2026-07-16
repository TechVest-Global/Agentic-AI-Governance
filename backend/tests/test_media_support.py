"""Media (vision/audio) support wiring.

Regression guard for the bug where NO real TargetModelClient implementation
read `TargetModelRequest.media` or populated `TargetModelResponse.media`, so
audio/vision evaluators either fabricated a score against media the target
never received, or silently fell back to a baseline probe and reported it as
a genuine "passed" real-tool result. Fixed by:
  - generic_http.py / mock.py actually attaching + echoing media
  - a `supports_media` capability flag clients declare (default False)
  - audio/vision evaluators checking that flag and reporting SKIPPED instead
    of scoring against media that was never actually transmitted.
"""

import json
from unittest.mock import patch
from uuid import uuid4

from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.audio_evaluator import AudioEvaluator
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.vision_evaluator import VisionEvaluator
from app.services.model_clients.base import MediaAsset, TargetModelRequest
from app.services.model_clients.generic_http import GenericHTTPTargetModelClient
from app.services.model_clients.mock import MockTargetModelClient


class _FakeHTTPResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_generic_http_client_attaches_media_to_outbound_request():
    """A TargetModelRequest with media set must actually be transmitted, not
    silently dropped, by the generic HTTP adapter."""
    client = GenericHTTPTargetModelClient(
        endpoint="https://example-system.test",
        api_key="test-key",
    )
    assert client.supports_media is True

    probe = MediaAsset(
        kind="audio",
        mime_type="audio/wav",
        data_base64="ZmFrZS1hdWRpby1ieXRlcw==",
        reference_text="hello world",
    )

    captured_requests = []

    def fake_urlopen(req, timeout=None):
        captured_requests.append(req)
        return _FakeHTTPResponse(json.dumps({"response": "ok", "media": []}).encode())

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        client.invoke(
            TargetModelRequest(
                endpoint_ref="probe",
                prompt="Transcribe the attached audio verbatim.",
                media=[probe],
            )
        )

    assert len(captured_requests) == 1
    outbound_body = json.loads(captured_requests[0].data.decode())
    assert "media" in outbound_body
    assert outbound_body["media"][0]["kind"] == "audio"
    assert outbound_body["media"][0]["data_base64"] == probe.data_base64
    assert outbound_body["media"][0]["reference_text"] == "hello world"


def test_generic_http_client_populates_response_media_from_target_json():
    """Media the target returns in its JSON body must be surfaced on
    TargetModelResponse.media, not silently dropped."""
    client = GenericHTTPTargetModelClient(
        endpoint="https://example-system.test",
        api_key="test-key",
    )

    response_body = json.dumps(
        {
            "response": "here is your image",
            "media": [
                {"kind": "image", "mime_type": "image/png", "data_base64": "aW1hZ2VieXRlcw=="}
            ],
        }
    ).encode()

    def fake_urlopen(req, timeout=None):
        return _FakeHTTPResponse(response_body)

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        response = client.invoke(
            TargetModelRequest(endpoint_ref="probe", prompt="Generate an image.")
        )

    assert len(response.media) == 1
    assert response.media[0].kind == "image"
    assert response.media[0].data_base64 == "aW1hZ2VieXRlcw=="


def test_mock_target_client_declares_and_echoes_media_support():
    client = MockTargetModelClient(provider="mock-target")
    assert client.supports_media is True

    probe = MediaAsset(kind="image", mime_type="image/png", data_base64="Zm9v")
    response = client.invoke(
        TargetModelRequest(endpoint_ref="probe", prompt="hello", media=[probe])
    )
    assert response.media == [probe]


class _NoMediaTargetClient:
    """Stand-in for a real text-only production client (techvest, hr_gateway,
    azure_openai, litellm_proxy) that never wires media."""

    provider = "text_only_target"
    credential_ref = None
    supports_media = False

    def invoke(self, request: TargetModelRequest):
        from app.services.model_clients.base import TargetModelResponse

        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output="bare text response, no media transmitted",
            sanitized_output="bare text response, no media transmitted",
            trace_id=f"target-{uuid4()}",
            latency_ms=0,
        )


def _ai_system(**metadata_json) -> AISystem:
    return AISystem(
        name="Media Test System",
        owner="AI Governance",
        system_type="chatbot",
        target_endpoint_ref="https://example-system.test",
        metadata_json=metadata_json,
    )


def _metric(metric_id: str, formula: str) -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id=metric_id,
        name=metric_id,
        dimension="robustness",
        version="1",
        scoring_config={"formula": formula},
        threshold_rules={},
    )


def test_audio_evaluator_skips_rather_than_fabricates_score_against_unsupported_client():
    ai_system = _ai_system(
        audio_probes=[
            {
                "mime_type": "audio/wav",
                "data_base64": "ZmFrZQ==",
                "reference_text": "the quick brown fox",
            }
        ]
    )
    evaluation_input = MetricEvaluationInput(
        metric=_metric("CM-034", "asr_robustness"),
        mock_score=0.9,
        force_status=None,
        source_name="test",
        session=None,  # type: ignore[arg-type]
        ai_system=ai_system,
        target_client=_NoMediaTargetClient(),
    )

    result = AudioEvaluator().evaluate(evaluation_input)

    assert result.status == MetricResultStatus.skipped
    assert result.raw_score is None
    assert result.passed is None
    assert "supports_media" in result.payload["skipped_reason"]


def test_vision_evaluator_skips_rather_than_fabricates_score_against_unsupported_client(monkeypatch):
    from app.services.evaluators import vision_evaluator

    monkeypatch.setattr(vision_evaluator, "_judge_ready", lambda: True)

    ai_system = _ai_system()
    evaluation_input = MetricEvaluationInput(
        metric=_metric("CM-032", "visual_content_safety_rate"),
        mock_score=0.9,
        force_status=None,
        source_name="test",
        session=None,  # type: ignore[arg-type]
        ai_system=ai_system,
        target_client=_NoMediaTargetClient(),
    )

    result = VisionEvaluator().evaluate(evaluation_input)

    assert result.status == MetricResultStatus.skipped
    assert result.raw_score is None
    assert result.passed is None
    assert "supports_media" in result.payload["skipped_reason"]
