"""Structured-payload routing for the generic HTTP target adapter.

Regression guard: GenericHTTPTargetModelClient used to always wrap a probe's
prompt as a single free-text field, ignoring any structured body a probe
supplied via TargetModelRequest.metadata["payload"] — so a probe targeting a
schema-driven endpoint on a newly-registered system (anything other than the
hardcoded HR gateway) got its structured body silently discarded.
"""

from app.services.model_clients.base import TargetModelRequest
from app.services.model_clients.generic_http import GenericHTTPTargetModelClient


def _client(**overrides) -> GenericHTTPTargetModelClient:
    kwargs = {"endpoint": "http://target.example/api", "api_key": "key"}
    kwargs.update(overrides)
    return GenericHTTPTargetModelClient(**kwargs)


def test_structured_payload_is_sent_verbatim():
    client = _client()
    request = TargetModelRequest(
        endpoint_ref="rank-candidates",
        prompt="ignored when a structured payload is present",
        metadata={"payload": {"job": {"title": "Engineer"}, "candidates": [{"id": "1"}]}},
    )
    body = client._build_body(request)
    assert body == {"job": {"title": "Engineer"}, "candidates": [{"id": "1"}]}


def test_no_payload_falls_back_to_prompt_field():
    client = _client(prompt_field="message")
    request = TargetModelRequest(endpoint_ref="chat", prompt="hello there")
    body = client._build_body(request)
    assert body == {"message": "hello there"}


def test_empty_payload_dict_falls_back_to_prompt_field():
    client = _client(prompt_field="message")
    request = TargetModelRequest(endpoint_ref="chat", prompt="hello there", metadata={"payload": {}})
    body = client._build_body(request)
    assert body == {"message": "hello there"}
