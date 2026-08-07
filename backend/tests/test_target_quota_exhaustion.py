"""A target that is out of quota must be stopped probing, not retried.

Observed live: an audited chatbot answered 429 with retry_after=62625 in its
JSON BODY (seconds, counting down 1:1 with the wall clock to a midnight-UTC
daily reset). The gateway read only the Retry-After *header*, saw no wait at
all, and fell back to a 1-2-4s backoff — so every probe burned three requests
against an allowance that had 17 hours left to run, and 36 of 36 probes failed.
"""

from __future__ import annotations

import io
import threading
import urllib.error

import pytest
from app.core.config import get_settings
from app.services.model_clients import target_throttle
from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.gateway import (
    GatewayTargetModelClient,
    TargetQuotaExhausted,
    _is_retryable,
    _requested_retry_after,
)
from app.services.model_clients.http_errors import enrich_http_error


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    target_throttle.reset_for_tests()
    yield
    get_settings.cache_clear()
    target_throttle.reset_for_tests()


def _http_429(*, body: bytes, headers: dict | None = None) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "http://target.invalid/probe", 429, "Too Many Requests",
        headers or {}, io.BytesIO(body),
    )


_QUOTA_BODY = (
    b'{"response": "You\'ve sent a lot of messages in a short time.", '
    b'"blocked": true, "rate_limited": true, "security_rule": "Rate Limit", '
    b'"retry_after": 62625}'
)
_BURST_BODY = b'{"response": "Slow down.", "rate_limited": true, "retry_after": 5}'


class _AlwaysRateLimited:
    provider = "quota-test"
    credential_ref = "none"
    supports_media = False

    def __init__(self, body: bytes = _QUOTA_BODY) -> None:
        self._body = body
        self.requests = 0
        self._lock = threading.Lock()

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        with self._lock:
            self.requests += 1
        raise enrich_http_error(_http_429(body=self._body))


def _request(name: str = "c") -> TargetModelRequest:
    return TargetModelRequest(
        endpoint_ref="http://target.invalid/probe", prompt="p", capability_name=name
    )


def test_a_retry_after_in_the_body_is_read() -> None:
    """The header is the standard channel; some targets use the payload instead."""
    exc = enrich_http_error(_http_429(body=_QUOTA_BODY))
    assert _requested_retry_after(exc) == 62625.0


def test_the_header_still_wins_when_present() -> None:
    exc = enrich_http_error(_http_429(body=_QUOTA_BODY, headers={"Retry-After": "12"}))
    assert _requested_retry_after(exc) == 12.0


def test_a_long_window_stops_the_probe_instead_of_retrying() -> None:
    """Retrying is what spends the rest of an allowance that is already gone."""
    inner = _AlwaysRateLimited()
    gateway = GatewayTargetModelClient(inner)

    with pytest.raises(TargetQuotaExhausted) as caught:
        gateway.invoke(_request())

    assert inner.requests == 1, "a spent quota must not be retried"
    assert caught.value.retry_after == 62625.0
    assert "17.4h" in str(caught.value)


def test_a_short_window_is_still_retried_as_a_burst_limit() -> None:
    """The repair must not fire on the case backoff genuinely handles."""
    inner = _AlwaysRateLimited(body=_BURST_BODY)
    gateway = GatewayTargetModelClient(inner, max_retries=3)

    with pytest.raises(urllib.error.HTTPError):
        gateway.invoke(_request())

    assert inner.requests == 3


def test_once_latched_no_further_probe_touches_the_network() -> None:
    """Every later probe used to spend three more requests learning the same thing."""
    inner = _AlwaysRateLimited()
    gateway = GatewayTargetModelClient(inner)

    with pytest.raises(TargetQuotaExhausted):
        gateway.invoke(_request("first"))
    assert inner.requests == 1

    for name in ("second", "third", "fourth"):
        with pytest.raises(TargetQuotaExhausted):
            gateway.invoke(_request(name))

    assert inner.requests == 1, "latched exhaustion still sent requests"


def test_the_latch_is_shared_across_concurrent_workers() -> None:
    """The quota belongs to the target, not to whichever worker discovered it."""
    inner = _AlwaysRateLimited()
    gateway = GatewayTargetModelClient(inner)
    errors: list[BaseException] = []

    def _probe() -> None:
        try:
            gateway.invoke(_request())
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=_probe) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 8
    assert all(isinstance(e, TargetQuotaExhausted) for e in errors)
    # Workers already in flight when the first 429 lands may each send one
    # request; what must not happen is 8 workers x 3 retries.
    assert inner.requests <= 8


def test_exhaustion_is_never_classified_as_retryable() -> None:
    assert _is_retryable(TargetQuotaExhausted("e", 62625.0, "2026-08-03T23:59:59+00:00")) is False


def test_a_latched_failure_is_not_recorded_as_having_sent_a_request() -> None:
    """attempts counts physical requests; the point here is that none was made."""
    from app.services.model_clients.gateway import drain_log_capture, start_log_capture

    inner = _AlwaysRateLimited()
    gateway = GatewayTargetModelClient(inner)
    start_log_capture()
    try:
        for name in ("first", "second"):
            with pytest.raises(TargetQuotaExhausted):
                gateway.invoke(_request(name))
        entries = drain_log_capture()
    finally:
        start_log_capture()
        drain_log_capture()

    assert [e["attempts"] for e in entries] == [1, 0]
    assert all(e["status"] == "rate_limited" for e in entries)
    # error_detail, not error_text: a second column briefly held the same reason
    # as one joined string and has been dropped — error_type + error_detail is
    # what the gateway writes and what endpoint_coverage groups on.
    assert entries[1]["error_type"] == "TargetQuotaExhausted"
    assert "quota exhausted" in entries[1]["error_detail"].lower()
