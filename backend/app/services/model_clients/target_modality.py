"""What KIND of request each target endpoint serves, for the concurrency cap.

The gateway needs the modality of an outbound probe to pick the right slot pool
(see target_throttle): a 10-minute video render and a 200ms text completion are
not interchangeable units of "one request", so they cannot share one counter.

The modality is not on the request. ``TargetModelRequest`` carries a prompt and
an endpoint_ref, and the callers that most need classifying are exactly the ones
that don't know: ``deepeval_evaluator._score_prompt`` posts a free-text prompt to
whatever endpoint it was handed, which on a multi-modal system is routinely the
VIDEO endpoint. Adding a ``modality`` field would therefore have been set
correctly only by the callers that already knew, and left at its default by the
ones causing the problem.

The registered capability already states the modality, so this maps
endpoint_ref -> modality once per run and lets the gateway look it up for every
caller with no per-call-site changes. Registration is idempotent and additive:
phases register the same system's capabilities repeatedly, and a mapping is only
ever refined from the default, never contradicted.

Unregistered endpoints resolve to "text", which is the pre-existing behaviour —
a system whose capabilities were never registered keeps sharing the single
general cap exactly as before, rather than being silently serialised.
"""

from __future__ import annotations

import threading

_TEXT = "text"

_lock = threading.Lock()
_by_endpoint: dict[str, str] = {}


def _normalize(endpoint_ref: str | None) -> str:
    return (endpoint_ref or "").strip().rstrip("/").lower()


def register_capability_modalities(capabilities) -> None:
    """Record each capability's modality against its endpoint_ref.

    Accepts anything with ``endpoint_ref`` and ``modality`` attributes, so it
    works with both the ORM capability rows and test doubles. Silently ignores
    entries missing either — a partially registered system must not break the
    probe path it is only meant to schedule.
    """
    if not capabilities:
        return
    resolved: dict[str, str] = {}
    for capability in capabilities:
        ref = _normalize(getattr(capability, "endpoint_ref", None))
        modality = getattr(capability, "modality", None)
        # Modality is an enum on the ORM rows and a plain string in tests.
        name = getattr(modality, "value", modality)
        if not ref or not isinstance(name, str) or not name.strip():
            continue
        resolved[ref] = name.strip().lower()
    if not resolved:
        return
    with _lock:
        _by_endpoint.update(resolved)


def modality_for(endpoint_ref: str | None) -> str:
    """The registered modality for this endpoint, or "text" if unknown."""
    with _lock:
        return _by_endpoint.get(_normalize(endpoint_ref), _TEXT)


def reset_for_tests() -> None:
    with _lock:
        _by_endpoint.clear()
