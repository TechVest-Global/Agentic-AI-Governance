"""TechVest Chatbot target model client.

Adapts the TechVest RAG chatbot API to the TargetModelClient protocol used by
all specialist agents.  The chatbot accepts:

    POST /api/chat
    Headers: x-functions-key: <key>
    Body:    {"message": "<prompt>", "session_id": "<ref>"}

And responds with:

    {"response": "<text>", "session_id": "...", "suggested_questions": [...]}

Activated when TARGET_ENDPOINT and TARGET_API_KEY are both set in .env.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from uuid import uuid4

from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.sanitization import sanitize_target_output

logger = logging.getLogger(__name__)


class TechVestTargetModelClient:
    """Target model client for the TechVest RAG chatbot API."""

    provider = "techvest_chatbot"
    # Real text-only production chat API — does not accept or return media.
    supports_media = False

    def __init__(self, *, endpoint: str, api_key: str) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self.credential_ref = "TARGET_API_KEY"

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        trace_id = f"target-{uuid4()}"
        start = time.monotonic()

        payload = json.dumps({
            "message": request.prompt,
            "session_id": request.endpoint_ref or "govai-probe",
        }).encode()

        req = urllib.request.Request(
            url=f"{self._endpoint}/api/chat",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-functions-key": self._api_key,
                "x-api-key": self._api_key,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode())
            raw_output = body.get("response", "")
        except Exception as exc:
            logger.error("TechVestTargetModelClient: request failed: %s", exc)
            raise

        latency_ms = int((time.monotonic() - start) * 1000)
        sanitized = sanitize_target_output(raw_output)

        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=trace_id,
            latency_ms=latency_ms,
            metadata={
                "client_mode": "live",
                "capability_name": request.capability_name,
                "redaction_count": sanitized.redaction_count,
                "warning_count": sanitized.warning_count,
            },
        )
