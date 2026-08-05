"""Keep the audited system's own explanation of a failure.

``urllib`` raises ``HTTPError`` whose ``str()`` is just the status line — "HTTP
Error 502: Bad Gateway". The part that says WHY is in the response body, which
an audited application typically fills in itself:

    {"detail": "GPT-4o call failed: <the real cause>"}

Every adapter re-raised the bare HTTPError without reading that body, so the
cause was discarded at the point it was handed to us. Downstream, ``FailedProbe``
stores ``str(exc)`` and the Gateway logs a status of "error", which is how a
probe transcript ends up showing a content-free ERROR badge for a failure the
target had already diagnosed in plain text.

``TargetHTTPError`` subclasses HTTPError rather than wrapping it, so the
Gateway's ``isinstance`` retry checks and its ``Retry-After`` header lookup keep
working untouched — only the message gets richer.
"""

from __future__ import annotations

import json
import re
import urllib.error

# A response body is a diagnostic here, not evidence — cap it so a target that
# returns an HTML error page or a megabyte of stack trace cannot bloat every
# audit record that touches it.
_MAX_BODY_CHARS = 800


def _body_retry_after(parsed: object) -> float | None:
    """Seconds a JSON error body asked us to wait, if it named a number.

    Not every throttling target uses the Retry-After header — some answer 429
    with the wait in the payload instead. Read as SECONDS, matching the header's
    unit and the observed behaviour of the target that prompted this (its value
    counted down 1:1 with the wall clock).
    """
    if not isinstance(parsed, dict):
        return None
    value = parsed.get("retry_after")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if value > 0 else None


# An upstream status quoted inside the body, e.g. a target that catches its own
# provider's failure and re-reports it: "Sora create failed [429]: {...}". The
# HTTP status we actually receive in that case is the target's own (typically
# 502 Bad Gateway), which hides the upstream's meaning completely — a rate limit
# arrives looking like a generic server error and gets a blind 1-2-4s backoff
# instead of the shared cooldown a rate limit requires.
_UPSTREAM_STATUS = re.compile(r"\[(\d{3})\]")

# Deterministic upstream refusals: the request itself is unacceptable, so the
# identical request will be refused identically no matter how long we wait.
# Retrying is pure waste — observed burning 35s and 77s on three attempts at a
# moderation-blocked video prompt — and it is not a target defect either, so it
# must not be dressed up as a transient error.
_TERMINAL_UPSTREAM_MARKERS = (
    "moderation_blocked",
    "content_policy_violation",
    "content_filter",
)


def _upstream_status(text: str) -> int | None:
    """A provider status the target quoted in its error body, if any."""
    match = _UPSTREAM_STATUS.search(text)
    if match is None:
        return None
    code = int(match.group(1))
    return code if 100 <= code <= 599 else None


def _is_terminal_refusal(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _TERMINAL_UPSTREAM_MARKERS)


def _readable_body(exc: urllib.error.HTTPError) -> tuple[str, float | None]:
    """Best-effort read of the error body. Never raises, never blocks a failure path."""
    try:
        raw = exc.read()
    except Exception:  # noqa: BLE001 — body already consumed, or no stream at all
        return "", None
    if not raw:
        return "", None
    text = raw.decode("utf-8", errors="replace").strip() if isinstance(raw, bytes) else str(raw)
    # FastAPI/Starlette targets answer with {"detail": ...}; surfacing that
    # directly reads far better than the raw JSON envelope.
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        parsed = None
    retry_after = _body_retry_after(parsed)
    if isinstance(parsed, dict):
        for key in ("detail", "message", "error"):
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                text = value.strip()
                break
            if isinstance(value, dict):
                nested = value.get("message")
                if isinstance(nested, str) and nested.strip():
                    text = nested.strip()
                    break
    return text[:_MAX_BODY_CHARS], retry_after


class TargetHTTPError(urllib.error.HTTPError):
    """An HTTPError that carries the target's response body in its message."""

    def __init__(
        self,
        code: int,
        reason: str,
        headers,
        url: str,
        body_text: str,
        retry_after: float | None = None,
    ) -> None:
        # fp=None: the original stream is already consumed by the time we build
        # this, and the body we care about is held on the instance instead.
        super().__init__(url, code, reason, headers, None)
        self.body_text = body_text
        # Seconds the target asked us to wait, taken from its JSON body. The
        # Retry-After *header* is handled separately by the gateway; a target
        # that answers 429 with {"retry_after": N} and no header was previously
        # read as having named no wait at all.
        self.body_retry_after = retry_after
        # The provider status the target quoted in its body, when its own status
        # hides it. `self.code` stays the status actually received — callers that
        # need the upstream meaning ask for it explicitly.
        self.upstream_status = _upstream_status(body_text)
        # Whether the upstream refused the request itself, rather than failing
        # transiently. Retrying such a call cannot change the outcome.
        self.terminal_refusal = _is_terminal_refusal(body_text)

    def __str__(self) -> str:
        base = f"HTTP Error {self.code}: {self.reason}"
        return f"{base} — {self.body_text}" if self.body_text else base


def enrich_http_error(exc: BaseException) -> BaseException:
    """Return an HTTPError carrying its response body, or the exception unchanged.

    Adapters call this in their except block before re-raising, so the reason a
    probe failed travels with the exception instead of dying at the socket.
    """
    if not isinstance(exc, urllib.error.HTTPError) or isinstance(exc, TargetHTTPError):
        return exc
    body, retry_after = _readable_body(exc)
    if not body and retry_after is None:
        return exc
    return TargetHTTPError(
        code=exc.code,
        reason=str(getattr(exc, "reason", "") or ""),
        headers=getattr(exc, "headers", None),
        url=getattr(exc, "url", None) or getattr(exc, "filename", "") or "",
        body_text=body,
        retry_after=retry_after,
    )


def error_detail(exc: BaseException) -> str:
    """Human-readable failure detail for the audit record."""
    return str(exc)[:_MAX_BODY_CHARS]
