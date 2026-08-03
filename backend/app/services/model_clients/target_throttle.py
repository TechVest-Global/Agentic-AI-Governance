"""Process-wide ceiling on concurrent requests into an audited target system.

The audited endpoint's capacity is a shared resource, so the bound on it has to
be shared too. This lived in ``agents/model_backed/base.py`` and was applied only
in ``ModelBackedAgent._probe_target``, which left two holes:

  * metric-execution evaluators call the target client directly and were not
    covered at all, so the "process-wide" cap only ever bounded specialist-agent
    probes. Today the phases run sequentially so they don't overlap, but the
    invariant held by accident rather than by construction;
  * a slot was held across the Gateway's ENTIRE retry loop, including its
    ``time.sleep`` backoff — up to ~33s with a server-sent ``Retry-After``.
    Under sustained 429s every slot fills with sleeping threads and all probing
    stalls, which is precisely the failure the cap exists to prevent, escalated
    from per-agent to process-wide.

Both are fixed by owning the semaphore here and acquiring it in
``GatewayTargetModelClient.invoke`` around one attempt at a time. Every target
client is Gateway-wrapped (see model_clients/registry.py), so that single
acquisition point covers every caller, and the backoff sleep now happens with
the slot released so a queued caller can use it.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager

from app.services.concurrency_settings import target_max_inflight

_lock = threading.Lock()
_semaphore: threading.BoundedSemaphore | None = None
_semaphore_limit: int | None = None


def _get_semaphore() -> threading.BoundedSemaphore:
    """Return the shared semaphore, building it on first use.

    Built lazily rather than at import so the limit comes from resolved settings
    (see concurrency_settings) instead of being frozen at import time. Rebuilt if
    the configured limit changes, which only happens when a test clears the
    settings cache — never mid-run in a live process.
    """
    global _semaphore, _semaphore_limit
    limit = target_max_inflight()
    with _lock:
        if _semaphore is None or _semaphore_limit != limit:
            _semaphore = threading.BoundedSemaphore(limit)
            _semaphore_limit = limit
        return _semaphore


@contextmanager
def target_slot():
    """Hold one of the process's target-request slots for the duration of the block.

    Wrap a SINGLE network attempt only. Anything slow that is not the request
    itself — retry backoff, response sanitization, evidence persistence — must
    sit outside, or the scarce resource is held while doing no work.
    """
    semaphore = _get_semaphore()
    semaphore.acquire()
    try:
        yield
    finally:
        semaphore.release()


def reset_for_tests() -> None:
    """Drop the cached semaphore so the next call re-reads the configured limit."""
    global _semaphore, _semaphore_limit
    with _lock:
        _semaphore = None
        _semaphore_limit = None
