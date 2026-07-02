"""HTTP target model client — probes a real audited application (e.g. a chatbot)
over its own HTTP API.

Activated by the registry when TARGET_API_KEY or TARGET_ENDPOINT is configured.
The endpoint URL comes from the registered system's ``target_endpoint_ref`` (so
each system can point at its own chatbot) unless TARGET_ENDPOINT overrides it
globally for single-target testing. Credentials are read from the environment
only — they are never stored on the AI system record.

Target output is returned raw and also sanitized; every caller fences it as
UNTRUSTED before it can enter a governance prompt (two-client boundary).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any
from uuid import uuid4

import httpx

from app.services.model_clients.base import TargetAuth, TargetModelRequest, TargetModelResponse
from app.services.model_clients.sanitization import sanitize_target_output

logger = logging.getLogger(__name__)

# Fallback fields to read the reply from when the configured field is absent.
_RESPONSE_FALLBACK_FIELDS = ("response", "message", "content", "answer", "text", "output", "reply")


class HttpTargetModelClient:
    """Calls a real target application's HTTP endpoint with the probe prompt."""

    provider = "http_target"
    deployment_name: str | None = None

    def __init__(
        self,
        *,
        api_key: str | None = None,
        auth_header: str = "Authorization",
        auth_scheme: str = "Bearer",
        request_field: str = "message",
        response_field: str = "response",
        endpoint_override: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.credential_ref = "TARGET_API_KEY" if api_key else None
        self._api_key = api_key
        self._auth_header = auth_header
        self._auth_scheme = auth_scheme
        self._request_field = request_field
        self._response_field = response_field
        self._endpoint_override = endpoint_override
        self._timeout = timeout

    def _effective_auth(self, request: TargetModelRequest) -> TargetAuth:
        """Per-request auth overrides win over the client's env defaults."""
        if request.auth is not None:
            return request.auth
        return TargetAuth(
            api_key=self._api_key,
            auth_header=self._auth_header,
            auth_scheme=self._auth_scheme,
            request_field=self._request_field,
            response_field=self._response_field,
            timeout=self._timeout,
        )

    def _headers(self, auth: TargetAuth) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if auth.api_key:
            headers[auth.auth_header] = (
                f"{auth.auth_scheme} {auth.api_key}".strip() if auth.auth_scheme else auth.api_key
            )
        return headers

    def _extract_reply(self, data: Any, response_field: str) -> str:
        if isinstance(data, str):
            return data
        if isinstance(data, dict):
            configured = data.get(response_field)
            if isinstance(configured, str) and configured.strip():
                return configured
            for key in _RESPONSE_FALLBACK_FIELDS:
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return value
        # No known text field — return the raw JSON so evidence is never empty.
        return json.dumps(data)

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        # A per-request endpoint (resolved from a registered target endpoint)
        # takes precedence; the global override is only for single-target testing.
        url = request.endpoint_ref or self._endpoint_override
        if request.auth is None:
            # No resolved endpoint — legacy path can force one URL globally.
            url = self._endpoint_override or request.endpoint_ref
        if not url or not str(url).lower().startswith(("http://", "https://")):
            raise ValueError(
                f"Target endpoint is not a callable URL: {url!r}. "
                "Register the system's target endpoint as an http(s) URL, or set TARGET_ENDPOINT."
            )

        auth = self._effective_auth(request)
        timeout = auth.timeout if auth.timeout is not None else self._timeout
        body = {auth.request_field: request.prompt}
        if request.capability_name:
            body.setdefault("capability", request.capability_name)
        trace_id = f"http-target-{uuid4()}"
        start = time.monotonic()

        try:
            response = httpx.post(url, json=body, headers=self._headers(auth), timeout=timeout)
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 — surfaced to the agent/run as a probe failure
            logger.error("HttpTargetModelClient: probe to %s failed: %s", url, exc)
            raise

        latency_ms = int((time.monotonic() - start) * 1000)
        try:
            raw_output = self._extract_reply(response.json(), auth.response_field)
        except ValueError:
            raw_output = response.text

        sanitized = sanitize_target_output(raw_output)
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=str(url),
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=trace_id,
            latency_ms=latency_ms,
            metadata={
                "client_mode": "live",
                "model": "http_target",
                "capability_name": request.capability_name,
                "http_status": response.status_code,
                "redaction_count": sanitized.redaction_count,
                "warning_count": sanitized.warning_count,
            },
        )
