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

VIDEO gets its own, tighter pool on top of the general one. A single cap counts
requests, and a video request is not one comparable unit: a Sora-class render
runs for minutes and the provider bounds how many may run AT ONCE, refusing
further creates with "Too many running tasks" — a CONCURRENCY limit, which no
per-minute backoff can satisfy. Under the shared cap of 6, several renders
overlapped and every video probe of a live Marketing Campaign Generator run
failed that way. Video callers hold a general slot AND a video slot, so video is
serialised without letting it escape the process-wide ceiling.

Ordering note: the general slot is taken FIRST and the video slot second, and
every caller acquires in that same order, so the two pools cannot deadlock
against each other.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager

from app.services.concurrency_settings import target_max_inflight, target_max_inflight_video

VIDEO = "video"

_lock = threading.Lock()
_pools: dict[str, tuple[threading.BoundedSemaphore, int]] = {}

# Pool name -> how many slots it should have. Resolved per call so .env and env
# vars both work and tests can change the width (see concurrency_settings).
_LIMITS = {
    "general": target_max_inflight,
    VIDEO: target_max_inflight_video,
}


def _get_semaphore(pool: str) -> threading.BoundedSemaphore:
    """Return a named pool's semaphore, building it on first use.

    Built lazily rather than at import so the limit comes from resolved settings
    (see concurrency_settings) instead of being frozen at import time. Rebuilt if
    the configured limit changes, which only happens when a test clears the
    settings cache — never mid-run in a live process.
    """
    limit = _LIMITS[pool]()
    with _lock:
        existing = _pools.get(pool)
        if existing is None or existing[1] != limit:
            existing = (threading.BoundedSemaphore(limit), limit)
            _pools[pool] = existing
        return existing[0]


@contextmanager
def target_slot(modality: str | None = None):
    """Hold the process's target-request slots for the duration of the block.

    Wrap a SINGLE network attempt only. Anything slow that is not the request
    itself — retry backoff, response sanitization, evidence persistence — must
    sit outside, or the scarce resource is held while doing no work.

    ``modality`` defaults to None, which takes only the general slot — the
    behaviour every caller had before video got its own pool. A video request
    additionally holds the video slot, serialising renders against each other.
    """
    general = _get_semaphore("general")
    video = _get_semaphore(VIDEO) if modality == VIDEO else None
    general.acquire()
    try:
        if video is not None:
            video.acquire()
        try:
            yield
        finally:
            if video is not None:
                video.release()
    finally:
        general.release()


def reset_for_tests() -> None:
    """Drop the cached semaphores so the next call re-reads the configured limits."""
    with _lock:
        _pools.clear()
