"""Video probes must be serialised, and a tunnelled upstream error understood.

All three defects here were found in one live Marketing Campaign Generator run
(FLUX+Sora+GPT-4o), where every video probe failed:

  1. Sora refused with "Too many running tasks" — a limit on how many jobs run AT
     ONCE, not per minute. The process-wide cap counted requests and was sized
     for text (6), so several 10-minute renders overlapped freely. A request
     count cannot express a concurrency limit on a long job, so video needs its
     own pool.

  2. That 429 reached us as the TARGET's own 502 with the real status quoted in
     the body ("Sora create failed [429]: ..."). Every rate-limit path keyed on
     ``exc.code``, so it was classified as a generic server error: no shared
     cooldown was published, and the other five workers kept firing into the
     same limit and retrying on a blind 1-2-4s backoff.

  3. Other probes came back ``moderation_blocked`` — a deterministic refusal of
     the prompt itself. Being a 502, it was treated as transient and retried
     three times, burning 35s and 77s to be refused identically each time.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error

import pytest
from app.core.config import get_settings
from app.services import concurrency_settings
from app.services.model_clients import target_modality, target_throttle
from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.gateway import (
    GatewayTargetModelClient,
    _is_rate_limit,
    _is_retryable,
)
from app.services.model_clients.http_errors import enrich_http_error

# The two bodies observed live, verbatim apart from shortening the job id.
_TOO_MANY_TASKS = (
    "Sora generation failed: Sora create failed [429]: {'error': {'message': "
    "'Too many running tasks', 'type': 'video_generation_user_error', "
    "'param': None, 'code': None}}"
)
_MODERATION_BLOCKED = (
    "Sora generation failed: Sora job video_6a72eaedff8c ended with status "
    "'failed': {'code': 'moderation_blocked', 'message': 'Your request was "
    "blocked by our moderation system.'}"
)


@pytest.fixture(autouse=True)
def _clean_state():
    get_settings.cache_clear()
    target_throttle.reset_for_tests()
    target_modality.reset_for_tests()
    yield
    get_settings.cache_clear()
    target_throttle.reset_for_tests()
    target_modality.reset_for_tests()


class _Capability:
    def __init__(self, endpoint_ref: str, modality: str) -> None:
        self.endpoint_ref = endpoint_ref
        self.modality = modality
        self.name = endpoint_ref


def _http_error(code: int, body: dict) -> urllib.error.HTTPError:
    class _Body:
        def read(self):
            return json.dumps(body).encode()

    exc = urllib.error.HTTPError(
        "http://localhost:8001/api/compliance/probe/video",
        code,
        "Bad Gateway",
        {},  # type: ignore[arg-type]
        None,
    )
    exc.read = _Body().read  # type: ignore[method-assign]
    return exc


# ── 1. the video concurrency pool ────────────────────────────────────────────


def test_video_inflight_knob_is_configurable(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT_VIDEO", "2")
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "6")
    get_settings.cache_clear()

    assert concurrency_settings.target_max_inflight_video() == 2


def test_video_cap_defaults_to_one() -> None:
    assert concurrency_settings.target_max_inflight_video() == 1


def test_video_cap_can_never_exceed_the_general_cap(monkeypatch) -> None:
    """Video requests are a subset of all requests, so a larger video cap is
    meaningless — and would let video escape the process-wide ceiling."""
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "2")
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT_VIDEO", "9")
    get_settings.cache_clear()

    assert concurrency_settings.target_max_inflight_video() == 2


def test_only_one_video_request_runs_at_a_time(monkeypatch) -> None:
    """The regression: with a single request-counting cap of 6, six renders ran
    concurrently and Sora refused all but the first few."""
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "6")
    get_settings.cache_clear()
    target_throttle.reset_for_tests()

    concurrent = 0
    peak = 0
    lock = threading.Lock()

    def _work() -> None:
        nonlocal concurrent, peak
        with target_throttle.target_slot("video"):
            with lock:
                concurrent += 1
                peak = max(peak, concurrent)
            time.sleep(0.05)
            with lock:
                concurrent -= 1

    threads = [threading.Thread(target=_work) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert peak == 1, f"{peak} video renders ran at once; Sora allows far fewer"


def test_text_requests_keep_the_wider_cap(monkeypatch) -> None:
    """Serialising video must not serialise everything else — that would undo
    the parallelism the general cap exists to permit."""
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "4")
    get_settings.cache_clear()
    target_throttle.reset_for_tests()

    concurrent = 0
    peak = 0
    lock = threading.Lock()
    released = threading.Event()

    def _work() -> None:
        nonlocal concurrent, peak
        with target_throttle.target_slot(None):
            with lock:
                concurrent += 1
                peak = max(peak, concurrent)
            released.wait(1.0)
            with lock:
                concurrent -= 1

    threads = [threading.Thread(target=_work) for _ in range(4)]
    for t in threads:
        t.start()
    while peak < 4 and any(t.is_alive() for t in threads):
        time.sleep(0.01)
    released.set()
    for t in threads:
        t.join()

    assert peak == 4, "text probes must still run concurrently up to the general cap"


def test_the_gateway_classifies_a_video_endpoint_from_the_registered_capability() -> None:
    """The caller that broke this — deepeval posting free text to whatever ref it
    was handed — never knew it was calling video, so the modality has to come
    from the registered capability rather than from the request."""
    target_modality.register_capability_modalities([
        _Capability("http://localhost:8001/api/compliance/probe/video", "video"),
        _Capability("http://localhost:8001/api/compliance/probe/text", "text"),
    ])

    assert target_modality.modality_for(
        "http://localhost:8001/api/compliance/probe/video"
    ) == "video"
    assert target_modality.modality_for(
        "http://localhost:8001/api/compliance/probe/text"
    ) == "text"
    # Trailing slash and case must not create a second, uncapped identity.
    assert target_modality.modality_for(
        "http://localhost:8001/api/compliance/probe/Video/"
    ) == "video"


def test_an_unregistered_endpoint_keeps_the_general_cap() -> None:
    """A system registered without capabilities must behave exactly as before,
    not be silently serialised by a fix aimed at video."""
    assert target_modality.modality_for("http://localhost:8001/anything") == "text"


# ── 2. the tunnelled upstream 429 ────────────────────────────────────────────


def test_a_429_quoted_inside_a_502_is_recognised_as_rate_limiting() -> None:
    enriched = enrich_http_error(_http_error(502, {"detail": _TOO_MANY_TASKS}))

    assert enriched.upstream_status == 429
    assert _is_rate_limit(enriched) is True, (
        "the target's 502 hid a provider 429, so no shared cooldown was published "
        "and every other worker kept firing into the same limit"
    )


def test_the_received_status_is_still_reported_as_itself() -> None:
    """Reading the upstream status must not rewrite ``code``: the audit record
    should say what the target actually returned."""
    enriched = enrich_http_error(_http_error(502, {"detail": _TOO_MANY_TASKS}))

    assert enriched.code == 502
    assert "429" in str(enriched)


def test_a_tunnelled_429_publishes_a_shared_cooldown() -> None:
    """The point of classifying it: one worker's discovery has to bound every
    other worker on this target, not just its own next attempt."""
    calls: list[int] = []

    class _Target:
        provider = "t"
        credential_ref = None
        supports_media = False

        def invoke(self, request):  # noqa: ANN001, ANN201
            calls.append(1)
            if len(calls) == 1:
                raise enrich_http_error(_http_error(502, {"detail": _TOO_MANY_TASKS}))
            return TargetModelResponse(
                provider="t",
                endpoint_ref=request.endpoint_ref,
                raw_output="ok",
                sanitized_output="ok",
                trace_id="x",
                latency_ms=1,
            )

    client = GatewayTargetModelClient(_Target(), max_retries=3)
    client.invoke(
        TargetModelRequest(
            endpoint_ref="http://localhost:8001/api/compliance/probe/video",
            prompt="render a clip",
        )
    )

    assert client._cooldown_until > 0.0, "a rate limit must be published to every worker"


def test_an_ordinary_502_is_not_treated_as_a_rate_limit() -> None:
    """A genuine upstream crash must keep its existing retry behaviour."""
    enriched = enrich_http_error(_http_error(502, {"detail": "GPT-4o call failed: boom"}))

    assert _is_rate_limit(enriched) is False
    assert _is_retryable(enriched) is True


def test_an_unrelated_bracketed_number_is_not_read_as_a_rate_limit() -> None:
    enriched = enrich_http_error(_http_error(502, {"detail": "failed at line [404] of config"}))

    assert _is_rate_limit(enriched) is False


# ── 3. the deterministic refusal ─────────────────────────────────────────────


def test_a_moderation_block_is_not_retried() -> None:
    enriched = enrich_http_error(_http_error(502, {"detail": _MODERATION_BLOCKED}))

    assert enriched.terminal_refusal is True
    assert _is_retryable(enriched) is False, (
        "the same prompt is refused identically every time — three attempts burned "
        "35s and 77s on live runs to learn nothing"
    )


def test_the_moderation_block_is_attempted_exactly_once() -> None:
    attempts: list[int] = []

    class _Blocked:
        provider = "t"
        credential_ref = None
        supports_media = False

        def invoke(self, request):  # noqa: ANN001, ANN201
            attempts.append(1)
            raise enrich_http_error(_http_error(502, {"detail": _MODERATION_BLOCKED}))

    client = GatewayTargetModelClient(_Blocked(), max_retries=3)
    with pytest.raises(urllib.error.HTTPError):
        client.invoke(
            TargetModelRequest(
                endpoint_ref="http://localhost:8001/api/compliance/probe/video",
                prompt="something the policy refuses",
            )
        )

    assert len(attempts) == 1, f"retried a deterministic refusal {len(attempts)} times"


def test_the_targets_own_explanation_survives_the_fast_failure() -> None:
    """Failing fast must not cost the reason — an auditor needs to see that the
    target's moderation system worked, not a bare status line."""
    enriched = enrich_http_error(_http_error(502, {"detail": _MODERATION_BLOCKED}))

    assert "moderation_blocked" in str(enriched)
