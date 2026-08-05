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
from datetime import UTC, datetime, timedelta

from openai import APIConnectionError, APITimeoutError, RateLimitError

from app.services import concurrency_settings
from app.services.model_clients.base import (
    GovernanceModelClient,
    GovernanceModelRequest,
    GovernanceModelResponse,
    TargetModelClient,
    TargetModelRequest,
    TargetModelResponse,
)
from app.services.model_clients.http_errors import error_detail
from app.services.model_clients.target_modality import modality_for
from app.services.model_clients.target_throttle import target_slot

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-request audit log buffer (one buffer per thread/async-context)
# ---------------------------------------------------------------------------

class _CaptureBuffer(list):
    """The per-run capture buffer, which also remembers whose run and phase it is.

    Subclassing ``list`` keeps every existing contract intact — workers still
    just ``append``, which is atomic under the GIL — while giving ``_append_log``
    the run_id it needs to persist an entry the moment it happens, and the
    pipeline phase to stamp on it. The alternative was threading both through
    ``bind_log_capture`` into every worker in every phase; contextvars don't
    cross thread boundaries, but the buffer object itself already does.
    """

    def __init__(self, run_id: object | None = None, phase: object | None = None) -> None:
        super().__init__()
        self.run_id = run_id
        self.phase = phase


_log_buffer: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar(
    "llm_gateway_log_buffer", default=None
)

# Which specialist agent is currently executing. Stamped onto every captured LLM
# call so the UI can show each agent ONLY its own probes/responses instead of the
# whole run's shared call set. None outside an agent's evaluate() (e.g. council).
_current_agent: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "llm_gateway_current_agent", default=None
)


def start_log_capture(run_id: object | None = None, phase: object | None = None) -> None:
    """Reset the audit buffer for this request context.

    Pass the run_id to have each call written to llm_call_logs as it completes
    instead of only at the phase-end drain (see _persist_now). Omitting it
    keeps the buffer-only behaviour, which is what tests and any non-run caller
    want.

    ``phase`` is stamped on every call captured here. Without it a run's calls
    are one undifferentiated list: a reviewer cannot tell an evaluator's probe
    in metric execution from a specialist agent's, and the UI has to guess the
    owning layer from the agent_name/task strings.
    """
    _log_buffer.set(_CaptureBuffer(run_id, phase))


def drain_log_capture() -> list[dict]:
    """Return the log entries still needing a write, and clear the buffer.

    Entries already persisted by _persist_now are filtered out, so a caller's
    existing "insert everything drained" loop now writes only what the
    immediate path missed — it never double-inserts.
    """
    buf = _log_buffer.get(None) or []
    _log_buffer.set(None)
    return [entry for entry in buf if not entry.pop("_persisted", False)]


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

    buf = _log_buffer.get(None)

    # Emit the call to Langfuse when tracing is configured (no-op otherwise).
    # Guarded so tracing can never break the call path. run_id (from the same
    # buffer _persist_now reads below) lets CM-039 measure real per-run trace
    # completeness — see tracing/langfuse_tracer.py.
    try:
        from app.services.tracing.langfuse_tracer import record_llm_call

        record_llm_call(entry, run_id=getattr(buf, "run_id", None))
    except Exception:  # noqa: BLE001
        pass

    if buf is not None:
        # Which pipeline layer made this call. Set here rather than at every
        # _append_log site so no call site can forget it.
        entry.setdefault("phase", getattr(buf, "phase", None))
        buf.append(entry)
        _persist_now(entry, buf)


def _persist_now(entry: dict, buf: list[dict]) -> None:
    """Write this call to llm_call_logs immediately, on its own session.

    Captured calls used to reach the database only when the phase drained its
    buffer. A specialist-agent or metric-execution phase runs for minutes, so
    for that whole window GET /llm-calls returned nothing and the Live Run view
    showed a run with zero probes — and a crash mid-phase discarded every call
    the phase had made, because the buffer was memory-only.

    Best-effort by design: on any failure the entry stays unflagged in the
    buffer and the phase-end drain writes it, so this can only ever make the
    audit log MORE complete than before, never less.
    """
    run_id = getattr(buf, "run_id", None)
    if run_id is None:
        return
    try:
        from app.services.llm_gateway.call_log import persist_call_log_entry

        persist_call_log_entry(run_id, entry)
        entry["_persisted"] = True
    except Exception as exc:  # noqa: BLE001 - audit capture must never fail a call
        logger.debug("LLM Gateway: live call-log write failed, deferring to drain: %s", exc)



def _probe_name(capability_name: str | None) -> str:
    """The probe's own name, without the endpoint that used to be glued onto it.

    Probe planning tags names as "probe_name@endpoint" when a system has more
    than one endpoint, purely to keep dict keys unique (see
    agents/model_backed/base.py). That tag then leaked into the audit record as
    the probe's identity, which is why a transcript row reads
    "Ai Generated Disclosure@Http://Localhost:8001/..." — a title-cased URL.
    The endpoint is now its own column, so the name can stay a name.

    Falls back to "target_probe" rather than "": capability_name is None at a
    base endpoint, and LLMCallLog.task is NOT NULL, so an empty name builds a
    row the database rejects at the phase-end commit.
    """
    if not capability_name:
        return "target_probe"
    return capability_name.split("@", 1)[0] or "target_probe"


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
    # Checked first: retrying is exactly what must not happen here. Every
    # further attempt spends an allowance the target has already refused.
    if isinstance(exc, TargetQuotaExhausted):
        return False
    # A deterministic upstream refusal — a moderation or content-policy block —
    # will be refused identically however many times it is sent. Checked before
    # the status table because it arrives as the target's own 502, which that
    # table (correctly, in general) treats as a transient server error. Observed
    # spending 35s and 77s on three attempts at one blocked video prompt.
    if getattr(exc, "terminal_refusal", False):
        return False
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

    Also covers a 429 the target TUNNELS inside its own status. A system that
    calls a provider on our behalf catches the provider's rate limit and reports
    it as its own 502 with the real status quoted in the body ("Sora create
    failed [429]: Too many running tasks"). Keying only on ``exc.code`` read that
    as a generic server error, so none of the rate-limit machinery engaged: no
    shared cooldown was published and every other worker kept firing into the
    same limit, each retrying on a blind 1-2-4s backoff far shorter than the
    limit needed. Observed on every video probe of a live Marketing Campaign
    Generator run.
    """
    if isinstance(exc, (RateLimitError, TargetQuotaExhausted)):
        return True
    if not isinstance(exc, urllib.error.HTTPError):
        return False
    return exc.code == 429 or getattr(exc, "upstream_status", None) == 429


class TargetQuotaExhausted(Exception):
    """The target is out of quota, not merely throttling a burst.

    Raised instead of retrying when a 429 names a wait longer than any audit
    could sensibly absorb. Deliberately NOT a subclass of HTTPError: it must
    not be classified as retryable, because retrying is precisely the behaviour
    that spends the rest of an already-exhausted allowance.
    """

    def __init__(self, endpoint_ref: str, retry_after: float, resets_at: str) -> None:
        self.endpoint_ref = endpoint_ref
        self.retry_after = retry_after
        self.resets_at = resets_at
        hours = retry_after / 3600.0
        super().__init__(
            f"Target quota exhausted for {endpoint_ref}: it asked for "
            f"{retry_after:.0f}s ({hours:.1f}h), resetting at {resets_at}. "
            f"No further probes were sent."
        )


def _requested_retry_after(exc: BaseException) -> float | None:
    """Seconds the server asked us to wait, uncapped, from header or body.

    The Retry-After header is the standard channel, but a target may instead
    put the wait in its JSON error payload (see TargetHTTPError.body_retry_after)
    — reading only the header made such a target look like it had named no wait
    at all, so the gateway fell back to a 1-2-4s backoff against a limit that
    had hours left to run.

    Uncapped on purpose: the caller needs the real number to tell throttling
    from exhaustion. _retry_after_seconds does the capping for actual sleeping.
    """
    headers = getattr(exc, "headers", None)
    raw = headers.get("Retry-After") if headers is not None else None
    if raw:
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            pass  # HTTP-date form — fall through to the body
    body_value = getattr(exc, "body_retry_after", None)
    if isinstance(body_value, (int, float)) and body_value > 0:
        return float(body_value)
    return None


def _quota_exhaustion(exc: BaseException, endpoint_ref: str) -> TargetQuotaExhausted | None:
    """Classify a 429 as exhaustion rather than throttling, when it says so.

    The distinction is the wait the target names. A few seconds is a burst
    limit and backoff is the right answer. A window longer than
    target_quota_exhausted_seconds cannot be waited out inside one audit, so
    continuing to probe only spends an allowance that is already gone.
    """
    requested = _requested_retry_after(exc)
    if requested is None or requested <= concurrency_settings.target_quota_exhausted_seconds():
        return None
    resets_at = (
        datetime.now(UTC) + timedelta(seconds=requested)
    ).isoformat(timespec="seconds")
    return TargetQuotaExhausted(endpoint_ref, requested, resets_at)


def _retry_after_seconds(exc: BaseException) -> float | None:
    """How long to actually sleep before the next attempt.

    Capped so a malformed or hostile value can never park a run for hours. A
    genuinely long wait is not handled by sleeping through it — see
    TargetQuotaExhausted.
    """
    requested = _requested_retry_after(exc)
    if requested is None:
        return None
    return max(0.0, min(requested, 30.0))


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
        started = time.monotonic()
        attempt = 0
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
                    "latency_ms": int((time.monotonic() - started) * 1000),
                    "status": "error",
                    "error_type": exc.__class__.__name__,
                    "error_detail": error_detail(exc),
                    "attempts": attempt + 1,
                    "request_chars": len(request.prompt),
                    "response_chars": 0,
                    "trace_id": None,
                    "policy_flags": [],
                    # Keep the prompt even though nothing came back: a failed
                    # governance call is exactly when a reviewer needs to see
                    # what was asked; error_type/error_detail say why it didn't
                    # answer.
                    "prompt_text": request.prompt,
                    "response_text": None,
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
            "latency_ms": int((time.monotonic() - started) * 1000),
            "status": "rate_limited" if _is_rate_limit(last_exc) else "error",
            "error_type": last_exc.__class__.__name__ if last_exc else None,
            "error_detail": error_detail(last_exc) if last_exc else None,
            "attempts": attempt + 1,
            "request_chars": len(request.prompt),
            "response_chars": 0,
            "trace_id": None,
            "policy_flags": [],
            "prompt_text": request.prompt,
            "response_text": None,
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
        # Latched once a 429 names a wait no audit can outlast. Shared by every
        # worker on this target for the same reason the cooldown is: the quota
        # belongs to the target, not to whichever worker happened to discover
        # it was gone.
        self._quota_exhausted: TargetQuotaExhausted | None = None

    def _check_quota(self, endpoint_ref: str) -> None:
        """Fail immediately if this target has already reported it is out of quota.

        No network request, no retry, no wait. Every probe after the first
        discovery used to spend three more requests learning the same thing —
        which both burns the allowance the target is already refusing and stalls
        the phase for the timeout on each one.
        """
        with self._cooldown_lock:
            exhausted = self._quota_exhausted
        if exhausted is not None:
            raise exhausted

    def _enter_quota_exhausted(self, exc: TargetQuotaExhausted) -> None:
        with self._cooldown_lock:
            if self._quota_exhausted is None:
                self._quota_exhausted = exc

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

        # The task label for this probe comes from _probe_name(), which strips
        # the "@endpoint" tag and coalesces an unnamed probe to "target_probe".
        # LLMCallLog.task is NOT NULL and capability_name is None for any probe
        # sent at a system's base endpoint, so that coalescing is load-bearing:
        # without it the row is rejected at the phase-end commit — the SAME
        # commit that writes the run's result_summary, so one unnamed probe
        # could take down a whole phase's bookkeeping.

        last_exc: Exception | None = None
        # Measured, not assumed. Both failure paths below used to hardcode
        # latency_ms=0, which the UI rendered as a real "0 ms" measurement — so a
        # probe that spent 30s timing out and two backoffs looked instantaneous.
        started = time.monotonic()
        attempt = 0
        for attempt in range(self._max_retries):
            try:
                # Cheapest gate first: if another worker already found this
                # target out of quota, there is nothing to wait for and nothing
                # to send.
                self._check_quota(request.endpoint_ref)
                # Honour any cooldown another worker discovered, before spending
                # this attempt on a request the target is going to reject — and
                # before taking a slot, so a cooling-off worker isn't holding one
                # while it sleeps.
                self._await_cooldown(request.endpoint_ref)
                # One process-wide slot per ATTEMPT, held around the network call
                # only. Acquiring here rather than around the whole retry loop is
                # what keeps the backoff sleep below from occupying a slot while
                # doing nothing — see model_clients/target_throttle.py.
                #
                # The modality comes from the endpoint's registered capability
                # rather than the request, because the callers that most need
                # bounding are the ones that don't know what they're calling —
                # see model_clients/target_modality.py.
                with target_slot(modality_for(request.endpoint_ref)):
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
                    "task": _probe_name(request.capability_name),
                    "call_type": "target",
                    "endpoint_ref": request.endpoint_ref,
                    "attempts": attempt + 1,
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
                        quota = _quota_exhaustion(exc, request.endpoint_ref)
                        if quota is not None:
                            # Not a burst to back off from — the allowance is
                            # spent. Latch it so no worker probes this target
                            # again, and stop retrying: every further attempt
                            # spends quota the target is already refusing.
                            logger.error(
                                "llm_target_quota_exhausted endpoint=%s retry_after=%.0fs "
                                "resets_at=%s — no further probes will be sent",
                                request.endpoint_ref, quota.retry_after, quota.resets_at,
                            )
                            self._enter_quota_exhausted(quota)
                            last_exc = quota
                            break
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
                # A latched quota failure sent nothing — the gate fired before any
                # request. Recording attempts=1 would credit this call with an
                # HTTP request that never happened, in the audit trail whose whole
                # purpose here is to show the allowance was NOT spent.
                sent = 0 if isinstance(exc, TargetQuotaExhausted) else attempt + 1
                _append_log({
                    "task": _probe_name(request.capability_name),
                    "call_type": "target",
                    "endpoint_ref": request.endpoint_ref,
                    "attempts": sent,
                    "model": getattr(self._inner, "deployment_name", self.provider),
                    "deployment_name": getattr(self._inner, "deployment_name", None),
                    "client_mode": "live",
                    "routed_via": None,
                    "prompt_tokens": None,
                    "completion_tokens": None,
                    "total_tokens": None,
                    "estimated_cost_usd": None,
                    "latency_ms": int((time.monotonic() - started) * 1000),
                    "status": "rate_limited" if _is_rate_limit(exc) else "error",
                    "error_type": exc.__class__.__name__,
                    "error_detail": error_detail(exc),
                    "request_chars": len(request.prompt),
                    "response_chars": 0,
                    "trace_id": None,
                    "policy_flags": [],
                    # A failed probe's prompt is exactly what a reviewer needs to
                    # see; omitting it here is what made the transcript say
                    # "metadata only" for precisely the calls worth inspecting.
                    "prompt_text": request.prompt,
                    "response_text": None,
                })
                raise

        # Exhausted retries — log the failure before raising
        _append_log({
            "task": _probe_name(request.capability_name),
            "call_type": "target",
            "endpoint_ref": request.endpoint_ref,
            "attempts": attempt + 1,
            "model": getattr(self._inner, "deployment_name", self.provider),
            "deployment_name": getattr(self._inner, "deployment_name", None),
            "client_mode": "live",
            "routed_via": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "estimated_cost_usd": None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "status": "rate_limited" if _is_rate_limit(last_exc) else "error",
            "error_type": last_exc.__class__.__name__ if last_exc else None,
            "error_detail": error_detail(last_exc) if last_exc else None,
            "request_chars": len(request.prompt),
            "response_chars": 0,
            "trace_id": None,
            "policy_flags": [],
            "prompt_text": request.prompt,
            "response_text": None,
        })
        raise last_exc  # type: ignore[misc]
