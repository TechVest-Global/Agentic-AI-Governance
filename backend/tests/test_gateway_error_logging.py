"""Gateway audit trail for non-retryable model-client errors.

Regression guard for the bug where `GatewayGovernanceModelClient.complete()`
and `GatewayTargetModelClient.invoke()` re-raised non-retryable exceptions
(e.g. BadRequestError, AuthenticationError — anything other than
RateLimitError/APIConnectionError/APITimeoutError) via a bare
`except Exception: raise` WITHOUT calling `_append_log(...)` first, unlike
the "retries exhausted" path right below it. A non-retryable failure left
zero trace in LLMCallLog even though a real call attempt was made. Fixed by
logging a failure entry (status="error") before re-raising in both wrappers.
"""

import pytest
from app.services.model_clients.base import GovernanceModelRequest, TargetModelRequest
from app.services.model_clients.gateway import (
    GatewayGovernanceModelClient,
    GatewayTargetModelClient,
    drain_log_capture,
    start_log_capture,
)


class _NonRetryableGovernanceClient:
    """Stands in for a real client raising e.g. openai.BadRequestError —
    anything NOT in (RateLimitError, APIConnectionError, APITimeoutError)."""

    provider = "fake_governance"
    credential_ref = "FAKE_CRED"
    deployment_name = "fake-deployment"

    def complete(self, request: GovernanceModelRequest):
        raise ValueError("simulated non-retryable failure (e.g. bad request)")


class _NonRetryableTargetClient:
    provider = "fake_target"
    credential_ref = "FAKE_CRED"

    def invoke(self, request: TargetModelRequest):
        raise ValueError("simulated non-retryable failure (e.g. bad request)")


def test_governance_gateway_logs_non_retryable_error_before_raising():
    start_log_capture()
    client = GatewayGovernanceModelClient(_NonRetryableGovernanceClient())

    with pytest.raises(ValueError, match="simulated non-retryable failure"):
        client.complete(
            GovernanceModelRequest(task="summarize_findings", prompt="hello")
        )

    entries = drain_log_capture()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["call_type"] == "governance"
    assert entry["status"] == "error"
    assert entry["task"] == "summarize_findings"
    assert entry["request_chars"] == len("hello")


def test_target_gateway_logs_non_retryable_error_before_raising():
    start_log_capture()
    client = GatewayTargetModelClient(_NonRetryableTargetClient())

    with pytest.raises(ValueError, match="simulated non-retryable failure"):
        client.invoke(
            TargetModelRequest(endpoint_ref="probe", prompt="hello", capability_name="probe_capability")
        )

    entries = drain_log_capture()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["call_type"] == "target"
    assert entry["status"] == "error"
    assert entry["task"] == "probe_capability"
    assert entry["request_chars"] == len("hello")


def test_no_capture_buffer_bound_does_not_raise_a_second_error():
    # Without start_log_capture(), _append_log must no-op quietly (buffer is
    # None) rather than raising a SECOND exception that masks the original.
    client = GatewayGovernanceModelClient(_NonRetryableGovernanceClient())

    with pytest.raises(ValueError, match="simulated non-retryable failure"):
        client.complete(GovernanceModelRequest(task="x", prompt="y"))
