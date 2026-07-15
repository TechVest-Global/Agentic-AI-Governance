"""Generic HTTP target client — probes any registered system from its metadata.

Systems that are neither the HR gateway nor the TechVest chatbot still need
their audits routed to THEIR OWN endpoint instead of silently falling back to
the global TARGET_* default (which is how a RAG-chatbot audit once probed the
HR gateway). This adapter is driven entirely by the system's registration:

  - endpoint:      ``ai_system.target_endpoint_ref`` (must be http/https)
  - auth header:   ``metadata_json.auth_header``    (default: "x-api-key")
  - credential:    ``metadata_json.credential_env`` — NAME of the env var that
                   holds the key (never store keys in the DB); falls back to
                   TARGET_API_KEY. No header is sent when neither is set.
  - prompt field:  ``metadata_json.prompt_field``   (default: "message")
  - response path: ``metadata_json.response_field`` — dot-path into the JSON
                   response (default: try "response", "output", "answer",
                   "content", "text"; else the raw body).

Scoped probes: a relative capability ``endpoint_ref`` (e.g. "parse-resume") is
joined onto the base endpoint; an absolute URL is used as-is.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request
from uuid import uuid4

from app.services.model_clients.base import MediaAsset, TargetModelRequest, TargetModelResponse
from app.services.model_clients.sanitization import sanitize_target_output

logger = logging.getLogger(__name__)

_DEFAULT_RESPONSE_FIELDS = ("response", "output", "answer", "content", "text")


def _extract_field(body: object, dot_path: str) -> object | None:
    current = body
    for part in dot_path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _media_to_json(assets: list[MediaAsset]) -> list[dict]:
    """Serialize outbound MediaAsset objects for the JSON request body."""
    out = []
    for asset in assets:
        item = {"kind": asset.kind, "mime_type": asset.mime_type}
        if asset.data_base64:
            item["data_base64"] = asset.data_base64
        if asset.url:
            item["url"] = asset.url
        if asset.reference_text:
            item["reference_text"] = asset.reference_text
        out.append(item)
    return out


def _media_from_json(raw: object) -> list[MediaAsset]:
    """Parse any media the target returned in its JSON response body."""
    if not isinstance(raw, list):
        return []
    assets = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        mime_type = item.get("mime_type")
        if not kind or not mime_type:
            continue
        assets.append(
            MediaAsset(
                kind=str(kind),
                mime_type=str(mime_type),
                data_base64=item.get("data_base64"),
                url=item.get("url"),
                reference_text=item.get("reference_text"),
            )
        )
    return assets


class GenericHTTPTargetModelClient:
    """Target client for registered systems without a dedicated adapter."""

    provider = "generic_http_target"
    # Attaches request.media (base64, under a "media" JSON key) to the
    # outbound call and reads any "media" the target's JSON response includes
    # back into response.media — see MediaAsset in model_clients/base.py.
    supports_media = True

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str | None,
        auth_header: str = "x-api-key",
        prompt_field: str = "message",
        response_field: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._auth_header = auth_header
        self._prompt_field = prompt_field
        self._response_field = response_field
        self._timeout = timeout
        self.credential_ref = "TARGET_API_KEY"

    @classmethod
    def for_system(cls, ai_system, *, fallback_api_key: str | None, timeout: float) -> "GenericHTTPTargetModelClient":
        metadata = getattr(ai_system, "metadata_json", None) or {}
        credential_env = str(metadata.get("credential_env", "") or "")
        api_key = os.getenv(credential_env) if credential_env else None
        return cls(
            endpoint=ai_system.target_endpoint_ref,
            api_key=api_key or fallback_api_key,
            auth_header=str(metadata.get("auth_header") or "x-api-key"),
            prompt_field=str(metadata.get("prompt_field") or "message"),
            response_field=(str(metadata["response_field"]) if metadata.get("response_field") else None),
            timeout=timeout,
        )

    def _resolve_url(self, endpoint_ref: str | None) -> str:
        ref = (endpoint_ref or "").strip()
        if ref.lower().startswith(("http://", "https://")):
            return ref
        # Relative capability path -> join to the base endpoint. Refs that are
        # obviously not paths (probe names with spaces, session-style ids) hit
        # the base endpoint directly.
        if ref and "/" not in ref and " " not in ref and "_" not in ref:
            return f"{self._endpoint}/{ref.strip('/')}"
        return self._endpoint

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        trace_id = f"target-{uuid4()}"
        start = time.monotonic()
        url = self._resolve_url(request.endpoint_ref)

        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers[self._auth_header] = self._api_key

        outbound_body: dict[str, object] = {self._prompt_field: request.prompt}
        if request.media:
            outbound_body["media"] = _media_to_json(request.media)

        req = urllib.request.Request(
            url=url,
            data=json.dumps(outbound_body).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw_body = resp.read().decode()
        except Exception as exc:
            logger.error("GenericHTTPTargetModelClient: request to %s failed: %s", url, exc)
            raise

        raw_output = raw_body
        response_media: list[MediaAsset] = []
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            body = None
        if body is not None:
            candidates = (
                (self._response_field,) if self._response_field else _DEFAULT_RESPONSE_FIELDS
            )
            for field in candidates:
                value = _extract_field(body, field)
                if isinstance(value, str) and value.strip():
                    raw_output = value
                    break
            else:
                raw_output = json.dumps(body)
            if isinstance(body, dict):
                response_media = _media_from_json(body.get("media"))

        latency_ms = int((time.monotonic() - start) * 1000)
        sanitized = sanitize_target_output(raw_output)
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=trace_id,
            latency_ms=latency_ms,
            media=response_media,
            metadata={"client_mode": "live", "url": url},
        )
