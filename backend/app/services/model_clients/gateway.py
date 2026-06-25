"""LLM Gateway — wraps any model client with retry, structured logging, and audit capture.

Every LLM call in the pipeline (7 specialist agents + 3 council agents) flows
through this layer. It adds:
  - Exponential backoff retry on rate-limit and timeout errors
  - Structured request/response logging for audit visibility
  - Latency and character-count tracking per call
  - Per-request audit log buffer (drained by run_agents / deliberate into DB)

Audit capture uses contextvars so each request thread has its own isolated buffer.
Call start_log_capture() at the top of a pipeline entry point (run_agents, deliberate),
then drain_log_capture() at the end to get all LLM call log entries for that request.
"""

from __future__ import annotations

import contextvars
import logging
import time

from openai import APIConnectionError, APITimeoutError, RateLimitError

from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelClient,
    TargetModelRequest,
    TargetModelResponse,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-request audit log buffer (one buffer per thread/async-context)
# ---------------------------------------------------------------------------

_log_buffer: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar(
    "llm_gateway_log_buffer", default=None
)


def start_log_capture() -> None:
    """Reset the audit buffer for this request context."""
    _log_buffer.set([])


def drain_log_capture() -> list[dict]:
    """Return all buffered log entries and clear the buffer."""
    buf = _log_buffer.get(None) or []
    _log_buffer.set(None)
    return buf


def _append_log(entry: dict) -> None:
    buf = _log_buffer.get(None)
    if buf is not None:
        buf.append(entry)


# ---------------------------------------------------------------------------
# Cost estimation (approximate 2025 Azure OpenAI pricing)
# ---------------------------------------------------------------------------

_COST_TABLE = {
    "gpt-4.1":   (2.00, 8.00),   # $/1M input, $/1M output
    "gpt-4o":    (2.50, 10.00),
    "gpt-4":     (30.00, 60.00),
    "gpt-3.5":   (0.50, 1.50),
    "gpt-35":    (0.50, 1.50),
}


def _estimate_cost_usd(
    model: str, prompt_tokens: int | None, completion_tokens: int | None
) -> float | None:
    if prompt_tokens is None and completion_tokens is None:
        return None
    pt = prompt_tokens or 0
    ct = completion_tokens or 0
    model_lower = model.lower()
    for key, (input_rate, output_rate) in _COST_TABLE.items():
        if key in model_lower:
            return round((pt * input_rate + ct * output_rate) / 1_000_000, 8)
    return None


# ---------------------------------------------------------------------------
# Retry backoff
# ---------------------------------------------------------------------------


def _backoff(attempt: int) -> None:
    wait = 2 ** attempt  # 1s, 2s, 4s
    logger.warning("LLM Gateway: retrying in %ds (attempt %d)", wait, attempt + 1)
    time.sleep(wait)


# ---------------------------------------------------------------------------
# Governance client wrapper
# ---------------------------------------------------------------------------


class GatewayGovernanceModelClient:
    """Wraps a GovernanceModelClient with retry, structured logging, and audit capture."""

    def __init__(
        self,
        inner: GovernanceModelClient,
        max_retries: int = 3,
    ) -> None:
        self._inner = inner
        self._max_retries = max_retries
        self.provider = inner.provider
        self.credential_ref = inner.credential_ref

    def complete(self, request: GovernanceModelRequest) -> GovernanceModelResponse:
        logger.debug(
            "llm_gov_request task=%s provider=%s prompt_chars=%d",
            request.task,
            self.provider,
            len(request.prompt),
        )

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = self._inner.complete(request)
                logger.info(
                    "llm_gov_response task=%s provider=%s latency_ms=%d content_chars=%d",
                    request.task,
                    self.provider,
                    response.latency_ms,
                    len(response.content),
                )
                meta = response.metadata or {}
                pt = meta.get("prompt_tokens")
                ct = meta.get("completion_tokens")
                model = meta.get("model") or response.deployment_name or self.provider
                _append_log({
                    "task": request.task,
                    "call_type": "governance",
                    "model": model,
                    "deployment_name": response.deployment_name,
                    "client_mode": meta.get("client_mode", "unknown"),
                    "routed_via": meta.get("routed_via"),
                    "prompt_tokens": pt,
                    "completion_tokens": ct,
                    "total_tokens": meta.get("total_tokens"),
                    "estimated_cost_usd": _estimate_cost_usd(model, pt, ct),
                    "latency_ms": response.latency_ms,
                    "status": "success",
                    "request_chars": len(request.prompt),
                    "response_chars": len(response.content),
                    "trace_id": response.trace_id,
                    "policy_flags": [],
                })
                return response
            except (RateLimitError, APIConnectionError, APITimeoutError) as exc:
                last_exc = exc
                logger.warning(
                    "llm_gov_error task=%s attempt=%d/%d error=%s",
                    request.task,
                    attempt + 1,
                    self._max_retries,
                    type(exc).__name__,
                )
                if attempt < self._max_retries - 1:
                    _backoff(attempt)
            except Exception:
                raise

        # Exhausted retries — log the failure before raising
        _append_log({
            "task": request.task,
            "call_type": "governance",
            "model": getattr(self._inner, "deployment_name", self.provider),
            "deployment_name": getattr(self._inner, "deployment_name", None),
            "client_mode": "live",
            "routed_via": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "estimated_cost_usd": None,
            "latency_ms": 0,
            "status": "rate_limited" if isinstance(last_exc, RateLimitError) else "error",
            "request_chars": len(request.prompt),
            "response_chars": 0,
            "trace_id": None,
            "policy_flags": [],
        })
        raise last_exc  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Target client wrapper
# ---------------------------------------------------------------------------


class GatewayTargetModelClient:
    """Wraps a TargetModelClient with retry, structured logging, and audit capture."""

    def __init__(
        self,
        inner: TargetModelClient,
        max_retries: int = 3,
    ) -> None:
        self._inner = inner
        self._max_retries = max_retries
        self.provider = inner.provider
        self.credential_ref = inner.credential_ref

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        logger.debug(
            "llm_target_request endpoint=%s capability=%s prompt_chars=%d",
            request.endpoint_ref,
            request.capability_name,
            len(request.prompt),
        )

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = self._inner.invoke(request)
                logger.info(
                    "llm_target_response endpoint=%s latency_ms=%d output_chars=%d",
                    request.endpoint_ref,
                    response.latency_ms,
                    len(response.raw_output),
                )
                meta = response.metadata or {}
                pt = meta.get("prompt_tokens")
                ct = meta.get("completion_tokens")
                model = meta.get("model") or self.provider
                _append_log({
                    "task": request.capability_name,
                    "call_type": "target",
                    "model": model,
                    "deployment_name": getattr(self._inner, "deployment_name", None),
                    "client_mode": meta.get("client_mode", "unknown"),
                    "routed_via": meta.get("routed_via"),
                    "prompt_tokens": pt,
                    "completion_tokens": ct,
                    "total_tokens": meta.get("total_tokens"),
                    "estimated_cost_usd": _estimate_cost_usd(model, pt, ct),
                    "latency_ms": response.latency_ms,
                    "status": "success",
                    "request_chars": len(request.prompt),
                    "response_chars": len(response.raw_output),
                    "trace_id": response.trace_id,
                    "policy_flags": [],
                })
                return response
            except (RateLimitError, APIConnectionError, APITimeoutError) as exc:
                last_exc = exc
                logger.warning(
                    "llm_target_error endpoint=%s attempt=%d/%d error=%s",
                    request.endpoint_ref,
                    attempt + 1,
                    self._max_retries,
                    type(exc).__name__,
                )
                if attempt < self._max_retries - 1:
                    _backoff(attempt)
            except Exception:
                raise

        # Exhausted retries — log the failure before raising
        _append_log({
            "task": request.capability_name,
            "call_type": "target",
            "model": getattr(self._inner, "deployment_name", self.provider),
            "deployment_name": getattr(self._inner, "deployment_name", None),
            "client_mode": "live",
            "routed_via": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "estimated_cost_usd": None,
            "latency_ms": 0,
            "status": "rate_limited" if isinstance(last_exc, RateLimitError) else "error",
            "request_chars": len(request.prompt),
            "response_chars": 0,
            "trace_id": None,
            "policy_flags": [],
        })
        raise last_exc  # type: ignore[misc]
