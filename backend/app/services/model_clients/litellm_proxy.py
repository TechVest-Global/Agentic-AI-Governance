"""LiteLLM Proxy model clients — governance and target.

When LITELLM_PROXY_URL is set, governance agents route through the LiteLLM
proxy instead of calling Azure OpenAI directly. The proxy handles:
  - Routing and fallback across multiple Azure deployments
  - Rate limit management and per-model budgets
  - Built-in cost tracking dashboard (http://localhost:4000/ui)
  - Request caching and retry logic

The proxy exposes an OpenAI-compatible endpoint, so both clients use the
standard openai.OpenAI client with a custom base_url.
"""

from __future__ import annotations

import logging
import time
from uuid import uuid4

from openai import OpenAI

from app.services.model_clients.base import (
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelRequest,
    TargetModelResponse,
)
from app.services.model_clients.sanitization import sanitize_target_output

logger = logging.getLogger(__name__)


class LiteLLMGovernanceModelClient:
    """Governance model client that routes through a LiteLLM proxy."""

    provider = "litellm_proxy"

    def __init__(
        self,
        *,
        proxy_url: str,
        master_key: str,
        model: str = "judge-model",
    ) -> None:
        self.deployment_name = model
        self.credential_ref = "LITELLM_MASTER_KEY"
        self._model = model
        self._client = OpenAI(
            base_url=f"{proxy_url.rstrip('/')}/v1",
            api_key=master_key,
        )

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        trace_id = f"litellm-gov-{uuid4()}"
        start = time.monotonic()

        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=0.2,
            )
            content = response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("LiteLLMGovernanceModelClient: API call failed: %s", exc)
            raise

        latency_ms = int((time.monotonic() - start) * 1000)
        usage = response.usage
        return GovernanceModelResponse(
            provider=self.provider,
            deployment_name=self._model,
            content=content,
            trace_id=trace_id,
            latency_ms=latency_ms,
            metadata={
                "task": request.task,
                "client_mode": "live",
                "model": self._model,
                "routed_via": "litellm_proxy",
                "prompt_tokens": usage.prompt_tokens if usage else None,
                "completion_tokens": usage.completion_tokens if usage else None,
                "total_tokens": usage.total_tokens if usage else None,
            },
        )


class LiteLLMTargetModelClient:
    """Target model client that routes through a LiteLLM proxy."""

    provider = "litellm_proxy"

    def __init__(
        self,
        *,
        proxy_url: str,
        master_key: str,
        model: str = "judge-model",
    ) -> None:
        self.deployment_name = model
        self.credential_ref = "LITELLM_MASTER_KEY"
        self._model = model
        self._client = OpenAI(
            base_url=f"{proxy_url.rstrip('/')}/v1",
            api_key=master_key,
        )

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        trace_id = f"litellm-target-{uuid4()}"
        start = time.monotonic()

        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=0.7,
            )
            raw_output = response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("LiteLLMTargetModelClient: API call failed: %s", exc)
            raise

        latency_ms = int((time.monotonic() - start) * 1000)
        sanitized = sanitize_target_output(raw_output)
        usage = response.usage
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output=raw_output,
            sanitized_output=sanitized.text,
            trace_id=trace_id,
            latency_ms=latency_ms,
            metadata={
                "client_mode": "live",
                "model": self._model,
                "routed_via": "litellm_proxy",
                "capability_name": request.capability_name,
                "redaction_count": sanitized.redaction_count,
                "warning_count": sanitized.warning_count,
                "prompt_tokens": usage.prompt_tokens if usage else None,
                "completion_tokens": usage.completion_tokens if usage else None,
                "total_tokens": usage.total_tokens if usage else None,
            },
        )
