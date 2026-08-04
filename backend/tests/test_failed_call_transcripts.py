"""A call that FAILED must still record what was sent and why it failed.

The gateway logged full prompt/response text on success but dropped both on
every failure branch, keeping only a status string. A live TechVest run where
53 of 59 probes were rate limited therefore produced an audit trail in which
the calls with the most diagnostic value were the ones with no transcript at
all — a reviewer could see "rate_limited" and nothing else: not the prompt, not
the status code, not whether it was throttling or an auth failure.

The reason is recorded as error_type + error_detail. An `error_text` column
briefly held the same information as one joined string; it was dropped because
two sources for one fact made the UI render the reason twice, and the split
version is more useful — error_type is groupable (endpoint_coverage counts by
it) and error_detail carries the target's own response body.
"""

import urllib.error

import pytest
from app.services.model_clients.base import (
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelRequest,
    TargetModelResponse,
)
from app.services.model_clients.gateway import (
    GatewayGovernanceModelClient,
    GatewayTargetModelClient,
    drain_log_capture,
    start_log_capture,
)


def _http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="https://target.invalid/api/chat",
        code=code,
        msg="Too Many Requests" if code == 429 else "Server Error",
        hdrs={},  # type: ignore[arg-type]
        fp=None,
    )


class _AlwaysFails:
    provider = "fake"
    credential_ref = "FAKE_KEY"
    supports_media = False

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        raise self._exc

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        raise self._exc


PROBE_PROMPT = "Rank these five candidates for the analyst role."
GOV_PROMPT = "Assess the fairness evidence below and return JSON findings."


def _only_entry() -> dict:
    entries = drain_log_capture()
    assert len(entries) == 1, f"expected exactly one captured call, got {len(entries)}"
    return entries[0]


def test_a_rate_limited_probe_keeps_its_prompt_and_says_why() -> None:
    start_log_capture()
    # max_retries=1 so retries exhaust immediately (no real backoff sleep).
    client = GatewayTargetModelClient(_AlwaysFails(_http_error(429)), max_retries=1)

    with pytest.raises(urllib.error.HTTPError):
        client.invoke(TargetModelRequest(endpoint_ref="https://t.invalid", prompt=PROBE_PROMPT))

    entry = _only_entry()
    assert entry["status"] == "rate_limited"
    assert entry["prompt_text"] == PROBE_PROMPT, "the probe that failed is the one worth reading"
    assert entry["response_text"] is None
    assert "429" in entry["error_detail"]


def test_a_non_retryable_probe_failure_records_the_status_code() -> None:
    """403 never retries, so it takes the other logging branch entirely."""
    start_log_capture()
    client = GatewayTargetModelClient(_AlwaysFails(_http_error(403)))

    with pytest.raises(urllib.error.HTTPError):
        client.invoke(TargetModelRequest(endpoint_ref="https://t.invalid", prompt=PROBE_PROMPT))

    entry = _only_entry()
    assert entry["status"] == "error"
    assert entry["prompt_text"] == PROBE_PROMPT
    assert "403" in entry["error_detail"]


def test_a_failed_governance_call_keeps_the_reasoning_prompt() -> None:
    start_log_capture()
    client = GatewayGovernanceModelClient(_AlwaysFails(_http_error(429)), max_retries=1)

    with pytest.raises(urllib.error.HTTPError):
        client.complete(GovernanceModelRequest(task="fairness_analysis", prompt=GOV_PROMPT))

    entry = _only_entry()
    assert entry["status"] == "rate_limited"
    assert entry["prompt_text"] == GOV_PROMPT
    assert "429" in entry["error_detail"]


def test_a_non_retryable_governance_failure_names_the_exception() -> None:
    start_log_capture()
    client = GatewayGovernanceModelClient(_AlwaysFails(ValueError("bad deployment name")))

    with pytest.raises(ValueError):
        client.complete(GovernanceModelRequest(task="fairness_analysis", prompt=GOV_PROMPT))

    entry = _only_entry()
    assert entry["status"] == "error"
    assert entry["prompt_text"] == GOV_PROMPT
    assert entry["error_type"] == "ValueError"
    assert "bad deployment name" in entry["error_detail"]


def test_a_successful_call_records_no_error_detail() -> None:
    """Guard against every row growing a spurious error string."""

    class _Succeeds:
        provider = "fake"
        credential_ref = "FAKE_KEY"
        supports_media = False

        def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
            return TargetModelResponse(
                provider="fake",
                endpoint_ref=request.endpoint_ref,
                raw_output="ok",
                sanitized_output="ok",
                trace_id="t",
                latency_ms=1,
            )

    start_log_capture()
    GatewayTargetModelClient(_Succeeds()).invoke(
        TargetModelRequest(endpoint_ref="https://t.invalid", prompt=PROBE_PROMPT)
    )

    entry = _only_entry()
    assert entry["status"] == "success"
    assert entry.get("error_detail") is None
    assert entry.get("error_type") is None
