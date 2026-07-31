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
import threading
import time
import urllib.error

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

# Which specialist agent is currently executing. Stamped onto every captured LLM
# call so the UI can show each agent ONLY its own probes/responses instead of the
# whole run's shared call set. None outside an agent's evaluate() (e.g. council).
_current_agent: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "llm_gateway_current_agent", default=None
)


def start_log_capture() -> None:
    """Reset the audit buffer for this request context."""
    _log_buffer.set([])


def drain_log_capture() -> list[dict]:
    """Return all buffered log entries and clear the buffer."""
    buf = _log_buffer.get(None) or []
    _log_buffer.set(None)
    return buf


def get_log_buffer() -> list[dict] | None:
    """Return the live capture buffer for this context (None when not capturing)."""
    return _log_buffer.get(None)


def bind_log_capture(buffer: list[dict] | None, agent_name: str | None = None) -> None:
    """Attach an existing capture buffer to THIS thread/context.

    contextvars do not propagate into ThreadPoolExecutor workers, so LLM calls
    made on worker threads (parallel metric evaluation, parallel agent probes)
    were invisible to the audit capture. Workers call this with the parent's
    buffer (list append is thread-safe under the GIL) so their calls land in
    the same per-run audit log.
    """
    _log_buffer.set(buffer)
    if agent_name is not None:
        _current_agent.set(agent_name)


def set_current_agent(agent_name: str | None) -> None:
    """Attribute subsequent captured LLM calls to this agent (or None to clear)."""
    _current_agent.set(agent_name)


def _append_log(entry: dict) -> None:
    # Attribute the call to the executing agent so per-agent views can filter.
    entry.setdefault("agent_name", _current_agent.get(None))

    # Emit the call to Langfuse when tracing is configured (no-op otherwise).
    # Guarded so tracing can never break the call path.
    try:
        from app.services.tracing.langfuse_tracer import record_llm_call

        record_llm_call(entry)
    except Exception:  # noqa: BLE001
        pass

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


# Transient HTTP statuses worth another attempt. The openai exception types above
# only cover the SDK-based clients (Azure OpenAI, LiteLLM). The plain-HTTP target
# adapters — techvest, hr_gateway, generic_http — raise urllib.error.HTTPError
# instead, which fell through to the non-retryable branch and killed the calling
# agent outright on a 429.
#
# That became a real failure mode once agent_execution.py started running
# specialist agents concurrently: the same probe volume is compressed into far
# less wall-clock, so an audited system's per-minute rate limit is reached where
# sequential agents stayed under it. A concurrency cap alone cannot fix a
# per-minute limit — the call has to back off and retry.
_RETRYABLE_HTTP_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (RateLimitError, APIConnectionError, APITimeoutError)):
        return True
    # HTTPError subclasses URLError, so it must be checked first.
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in _RETRYABLE_HTTP_STATUS
    if isinstance(exc, urllib.error.URLError):
        return True
    return isinstance(exc, TimeoutError)


def _is_rate_limit(exc: BaseException | None) -> bool:
    """Whether a failure was specifically rate limiting, for audit-log status.

    Covers the plain-HTTP adapters' 429 as well as the SDK's RateLimitError, so
    a throttled audit is recorded as `rate_limited` rather than a generic error.
    """
    if isinstance(exc, RateLimitError):
        return True
    return isinstance(exc, urllib.error.HTTPError) and exc.code == 429


def _retry_after_seconds(exc: BaseException) -> float | None:
    """Seconds requested by a server's Retry-After header, if it sent one.

    Capped so a malformed or hostile header can never park a run for hours.
    """
    headers = getattr(exc, "headers", None)
    raw = headers.get("Retry-After") if headers is not None else None
    if not raw:
        return None
    try:
        return max(0.0, min(float(raw), 30.0))
    except (TypeError, ValueError):
        return None  # HTTP-date form — fall back to exponential backoff


def _backoff(attempt: int, retry_after: float | None = None) -> None:
    wait = retry_after if retry_after is not None else 2 ** attempt  # 1s, 2s, 4s
    logger.warning("LLM Gateway: retrying in %.1fs (attempt %d)", wait, attempt + 1)
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
                    # Governance reasoning is otherwise only reconstructable
                    # from token counts/latency — target-model probe
                    # transcripts already get this treatment, so a Finding's
                    # actual reasoning shouldn't get less audit rigor than the
                    # probe evidence it reasoned over.
                    "prompt_text": request.prompt,
                    "response_text": response.content,
                })
                return response
            except Exception as exc:
                if _is_retryable(exc):
                    last_exc = exc
                    logger.warning(
                        "llm_gov_error task=%s attempt=%d/%d error=%s",
                        request.task,
                        attempt + 1,
                        self._max_retries,
                        type(exc).__name__,
                    )
                    if attempt < self._max_retries - 1:
                        _backoff(attempt, retry_after=_retry_after_seconds(exc))
                    continue
                # Non-retryable failure (e.g. BadRequestError, AuthenticationError) —
                # log the attempt before re-raising so it still leaves an audit trail,
                # matching the exhausted-retries path below instead of vanishing silently.
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
                    "status": "error",
                    "request_chars": len(request.prompt),
                    "response_chars": 0,
                    "trace_id": None,
                    "policy_flags": [],
                })
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
            "status": "rate_limited" if _is_rate_limit(last_exc) else "error",
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
        # Evaluators only ever see the Gateway-wrapped client (every target
        # client is wrapped here — see model_clients/registry.py), so the
        # media capability flag must be forwarded from the inner client
        # rather than evaluators reaching past this wrapper to check it.
        self.supports_media = getattr(inner, "supports_media", False)
        # Shared rate-limit cooldown for this target.
        #
        # A concurrency cap (AGENT_TARGET_MAX_INFLIGHT) bounds how many requests
        # are in flight at once, but a 429 is usually a PER-MINUTE quota, which
        # concurrency alone cannot bound. Worse, without shared state every
        # worker rediscovers the limit on its own: a live TechVest run produced
        # four separate 429s, each backing off independently, then all retrying
        # into the same wall again.
        #
        # One client instance is constructed per run and handed to every agent
        # and evaluator (see agent_execution.run_agents), so instance state is
        # exactly the right scope: shared by all workers probing this target,
        # isolated from other audited systems.
        self._cooldown_lock = threading.Lock()
        self._cooldown_until = 0.0

    def _await_cooldown(self, endpoint_ref: str) -> None:
        """Block while this target is cooling off from a rate limit."""
        with self._cooldown_lock:
            remaining = self._cooldown_until - time.monotonic()
        if remaining > 0:
            logger.info(
                "llm_target_cooldown endpoint=%s waiting %.1fs (shared rate-limit backoff)",
                endpoint_ref,
                remaining,
            )
            time.sleep(remaining)

    def _enter_cooldown(self, seconds: float) -> None:
        """Publish a rate limit to every other worker probing this target.

        Extends rather than replaces, so a shorter later Retry-After cannot cut
        an existing cooldown short.
        """
        with self._cooldown_lock:
            self._cooldown_until = max(self._cooldown_until, time.monotonic() + seconds)

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
                # Honour any cooldown another worker discovered, before spending
                # this attempt on a request the target is going to reject.
                self._await_cooldown(request.endpoint_ref)
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
                    # Auditor-visible probe transcript (target calls only)
                    "prompt_text": request.prompt,
                    "response_text": response.raw_output,
                })
                return response
            except Exception as exc:
                if _is_retryable(exc):
                    last_exc = exc
                    logger.warning(
                        "llm_target_error endpoint=%s attempt=%d/%d error=%s",
                        request.endpoint_ref,
                        attempt + 1,
                        self._max_retries,
                        type(exc).__name__,
                    )
                    if _is_rate_limit(exc):
                        # Publish it, then let the cooldown gate at the top of the
                        # next attempt do the waiting — for this worker AND every
                        # other one, instead of each colliding with the limit in
                        # turn. Deliberately not also calling _backoff here: that
                        # would make this worker wait twice.
                        self._enter_cooldown(
                            _retry_after_seconds(exc) or float(2 ** attempt)
                        )
                    elif attempt < self._max_retries - 1:
                        _backoff(attempt)
                    continue
                # Non-retryable failure (e.g. BadRequestError, AuthenticationError) —
                # log the attempt before re-raising so it still leaves an audit trail,
                # matching the exhausted-retries path below instead of vanishing silently.
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
                    "status": "error",
                    "request_chars": len(request.prompt),
                    "response_chars": 0,
                    "trace_id": None,
                    "policy_flags": [],
                })
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
            "status": "rate_limited" if _is_rate_limit(last_exc) else "error",
            "request_chars": len(request.prompt),
            "response_chars": 0,
            "trace_id": None,
            "policy_flags": [],
        })
        raise last_exc  # type: ignore[misc]
