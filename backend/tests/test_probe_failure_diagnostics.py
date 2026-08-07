"""A failed probe must record WHY it failed.

`status` alone said only "error", so a 502 from the audited application, an
expired credential, a refused connection and a malformed response all rendered
as the same content-free ERROR row. The reason usually existed — an audited app
explains itself in the response body, e.g. {"detail": "GPT-4o call failed: ..."}
behind a 502 — and every adapter re-raised the bare HTTPError without ever
reading it.

Two further numbers on those rows were placeholders rather than measurements:
`latency_ms` and `response_chars` were hardcoded to 0 on both failure paths, so
a probe that spent thirty seconds timing out through two backoffs was displayed
as having taken 0 ms.
"""

import io
import urllib.error

import pytest
from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.gateway import (
    GatewayTargetModelClient,
    drain_log_capture,
    start_log_capture,
)
from app.services.model_clients.http_errors import TargetHTTPError, enrich_http_error


def _http_error(code: int, body: bytes, reason: str = "Bad Gateway") -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "http://localhost:8001/api/compliance/probe/text", code, reason, {}, io.BytesIO(body)
    )


def test_fastapi_style_detail_is_lifted_out_of_the_response_body() -> None:
    enriched = enrich_http_error(
        _http_error(502, b'{"detail": "GPT-4o call failed: quota exceeded"}')
    )
    assert isinstance(enriched, TargetHTTPError)
    assert "GPT-4o call failed: quota exceeded" in str(enriched)
    # Still an HTTPError with its status intact, so the Gateway's retry
    # classification and Retry-After handling are unaffected.
    assert isinstance(enriched, urllib.error.HTTPError)
    assert enriched.code == 502


def test_a_plain_text_body_is_preserved_verbatim() -> None:
    enriched = enrich_http_error(_http_error(500, b"upstream model unavailable"))
    assert "upstream model unavailable" in str(enriched)


def test_an_empty_body_leaves_the_error_untouched() -> None:
    original = _http_error(503, b"")
    assert enrich_http_error(original) is original


def test_a_non_http_error_is_returned_unchanged() -> None:
    original = urllib.error.URLError("connection refused")
    assert enrich_http_error(original) is original


def test_an_oversized_body_is_capped() -> None:
    enriched = enrich_http_error(_http_error(500, b"x" * 5000))
    assert isinstance(enriched, TargetHTTPError)
    assert len(enriched.body_text) <= 800


class _AlwaysFailsClient:
    provider = "failing"
    credential_ref = "none"
    supports_media = False

    def __init__(self, exc: Exception) -> None:
        self._exc = exc
        self.calls = 0

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        self.calls += 1
        raise self._exc


def _probe(gateway: GatewayTargetModelClient) -> list[dict]:
    start_log_capture()
    # The specific type varies by scenario (TargetHTTPError, URLError); what is
    # under test is the log entry it leaves behind, asserted by each caller.
    with pytest.raises(urllib.error.URLError):
        gateway.invoke(
            TargetModelRequest(
                endpoint_ref="http://localhost:8001/api/compliance/probe/text",
                prompt="probe prompt",
                capability_name="ai_generated_disclosure@http://localhost:8001/api/x",
            )
        )
    return drain_log_capture()


def test_a_failed_probe_records_the_reason_endpoint_and_attempt_count(monkeypatch) -> None:
    monkeypatch.setattr("app.services.model_clients.gateway._backoff", lambda *a, **k: None)
    inner = _AlwaysFailsClient(
        enrich_http_error(_http_error(502, b'{"detail": "GPT-4o call failed: quota exceeded"}'))
    )
    entries = _probe(GatewayTargetModelClient(inner))

    assert len(entries) == 1
    entry = entries[0]
    assert entry["status"] == "error"
    assert entry["error_type"] == "TargetHTTPError"
    assert "quota exceeded" in entry["error_detail"]
    # Which surface failed — previously unrecoverable from the audit record.
    assert entry["endpoint_ref"] == "http://localhost:8001/api/compliance/probe/text"
    # 502 is retryable, so this one logical probe cost three real requests.
    # Reporting one row without the attempt count hid two thirds of the load.
    assert entry["attempts"] == 3
    assert inner.calls == 3
    # The probe's own name, with the endpoint no longer glued onto it — that
    # suffix is what the UI was title-casing into "…@Http://Localhost:8001/…".
    assert entry["task"] == "ai_generated_disclosure"
    # The prompt of a FAILED probe is exactly what a reviewer needs; omitting it
    # is what made the transcript say "metadata only" for these rows.
    assert entry["prompt_text"] == "probe prompt"


def test_a_non_retryable_failure_is_also_diagnosed(monkeypatch) -> None:
    monkeypatch.setattr("app.services.model_clients.gateway._backoff", lambda *a, **k: None)
    inner = _AlwaysFailsClient(
        enrich_http_error(_http_error(401, b'{"detail": "invalid api key"}', reason="Unauthorized"))
    )
    entries = _probe(GatewayTargetModelClient(inner))

    assert inner.calls == 1, "401 must not be retried"
    assert entries[0]["error_type"] == "TargetHTTPError"
    assert "invalid api key" in entries[0]["error_detail"]
    assert entries[0]["attempts"] == 1


def test_connection_refused_is_distinguishable_from_an_http_failure(monkeypatch) -> None:
    """The two used to be the same content-free ERROR row."""
    monkeypatch.setattr("app.services.model_clients.gateway._backoff", lambda *a, **k: None)
    inner = _AlwaysFailsClient(urllib.error.URLError("[WinError 10061] actively refused"))
    entries = _probe(GatewayTargetModelClient(inner))

    assert entries[0]["error_type"] == "URLError"
    assert "refused" in entries[0]["error_detail"]
