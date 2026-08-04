"""Runtime accessors for the pipeline's concurrency knobs.

Every one of these was previously a module-level ``os.getenv(...)`` read in the
service that used it. That had two defects:

  * The app's configuration is pydantic-settings loading ``<repo>/.env`` into a
    ``Settings`` object — it does NOT populate ``os.environ``. So setting
    ``AGENT_EXECUTION_MAX_WORKERS=8`` in .env did nothing at all, even though
    every surrounding comment documented it as the way to override the value.
    Only a real process environment variable worked.
  * Reading at import time froze the value for the life of the process, so no
    test could exercise a different width or budget.

Resolving through ``get_settings()`` per call fixes both: .env and real env vars
both work (pydantic-settings gives env vars precedence, as before), and clearing
the ``get_settings`` cache is enough to re-read.
"""

from __future__ import annotations

from app.core.config import get_settings


def agent_execution_max_workers() -> int:
    return max(1, get_settings().agent_execution_max_workers)


def agent_execution_budget_seconds() -> float:
    return get_settings().agent_execution_budget_seconds


def agent_probe_max_workers() -> int:
    return max(1, get_settings().agent_probe_max_workers)


def target_max_inflight() -> int:
    """Process-wide ceiling on concurrent requests into the audited system.

    Defaults to the per-agent probe width, which keeps PEAK load on the target
    exactly what it was before Layer 3 started running agents concurrently.
    """
    settings = get_settings()
    return max(1, settings.agent_target_max_inflight or settings.agent_probe_max_workers)


def target_quota_exhausted_seconds() -> float:
    """Retry-After above which a 429 means "out of quota", not "slow down"."""
    return get_settings().target_quota_exhausted_seconds


def metric_execution_max_workers() -> int:
    return max(1, get_settings().metric_execution_max_workers)


def metric_execution_budget_seconds() -> float:
    return get_settings().metric_execution_budget_seconds


def metric_execution_budget_for(metric_count: int) -> float:
    """Phase budget for a run of this size.

    The budget used to be one flat number for every run, which meant it was
    either too tight for a full-catalog audit or absurdly loose for a handful of
    metrics. Measured against the live TechVest chatbot: ~6s per model call and
    2-4 calls per metric, so 42 metrics need ~880s and were cut off at 600s —
    and the metrics that never got their turn were recorded as
    "evaluation exceeded the metric-execution time budget", which reads like a
    tool failure rather than a clock running out.

    Scales from a floor so small runs keep a generous fixed allowance and large
    ones get room proportional to the work actually asked for.
    """
    settings = get_settings()
    return max(
        settings.metric_execution_budget_seconds,
        settings.metric_execution_seconds_per_metric * max(0, metric_count),
    )
