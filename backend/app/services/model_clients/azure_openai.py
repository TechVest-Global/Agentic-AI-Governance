"""Azure OpenAI model clients — governance and target.

GovernanceModelClient: powers the Deliberation Council judge agents.
TargetModelClient:     used to probe the AI system under audit.

Both activated when JUDGE_ENDPOINT, JUDGE_API_KEY, and JUDGE_DEPLOYMENT_NAME
are all set. Currently share the same endpoint; they can be split later by
adding separate TARGET_* env vars.
"""

from __future__ import annotations

import logging
import time
from uuid import uuid4

from openai import AzureOpenAI

from app.services.model_clients.base import (
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelRequest,
    TargetModelResponse,
)
from app.services.model_clients.sanitization import sanitize_target_output

logger = logging.getLogger(__name__)


class AzureOpenAIGovernanceModelClient:
    """Governance model client backed by Azure OpenAI chat completions."""

    provider = "azure_openai"

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        deployment_name: str,
        api_version: str = "2025-01-01-preview",
        timeout: float = 30.0,
    ) -> None:
        self.deployment_name = deployment_name
        self.credential_ref = "JUDGE_API_KEY"
        self._client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
            timeout=timeout,
        )

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        trace_id = f"judge-{uuid4()}"
        start = time.monotonic()

        try:
            response = self._client.chat.completions.create(
                model=self.deployment_name,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=0.2,
            )
            content = response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("AzureOpenAIGovernanceModelClient: API call failed: %s", exc)
            raise

        latency_ms = int((time.monotonic() - start) * 1000)
        usage = response.usage
        return GovernanceModelResponse(
            provider=self.provider,
            deployment_name=self.deployment_name,
            content=content,
            trace_id=trace_id,
            latency_ms=latency_ms,
            metadata={
                "task": request.task,
                "client_mode": "live",
                "model": self.deployment_name,
                "prompt_tokens": usage.prompt_tokens if usage else None,
                "completion_tokens": usage.completion_tokens if usage else None,
                "total_tokens": usage.total_tokens if usage else None,
            },
        )


class AzureOpenAITargetModelClient:
    """Target model client backed by Azure OpenAI.

    Probes the AI system under audit. Currently shares the same endpoint and
    deployment as the governance client; can be split via separate TARGET_*
    env vars later.
    """

    provider = "azure_openai"
    # This adapter only forwards chat-completion text; it does not attach
    # request.media or read image/audio content out of the completion.
    supports_media = False

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        deployment_name: str,
        api_version: str = "2025-01-01-preview",
        timeout: float = 30.0,
    ) -> None:
        self.deployment_name = deployment_name
        self.credential_ref = "JUDGE_API_KEY"
        self._client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
            timeout=timeout,
        )

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        trace_id = f"target-{uuid4()}"
        start = time.monotonic()

        try:
            response = self._client.chat.completions.create(
                model=self.deployment_name,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=0.7,
            )
            raw_output = response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("AzureOpenAITargetModelClient: API call failed: %s", exc)
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
                "model": self.deployment_name,
                "capability_name": request.capability_name,
                "redaction_count": sanitized.redaction_count,
                "warning_count": sanitized.warning_count,
                "prompt_tokens": usage.prompt_tokens if usage else None,
                "completion_tokens": usage.completion_tokens if usage else None,
                "total_tokens": usage.total_tokens if usage else None,
            },
        )
