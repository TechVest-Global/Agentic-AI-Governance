"""Per-AI-system run serialization.

Nothing today stops two evaluation runs against the same AI system from
executing concurrently — their specialist agents/metrics would interleave
probes against the same live target, and one run could read the other's
not-yet-final state as "prior" (see agent_execution._get_prior_metric_scores).
This uses a Postgres session-level advisory lock, keyed by ai_system_id, to
serialize pipeline execution: a second run against a busy system fails fast
with a clear conflict instead of silently interleaving.

The lock is held on a DEDICATED connection checked out directly from the
engine — never the ORM Session passed around the pipeline. A SQLAlchemy
Session's underlying connection can change between transactions (each
commit may return it to the pool), and a Postgres advisory lock's identity
is tied to the exact physical connection that acquired it; sharing the ORM
session's connection would risk the lock silently outliving this context
(held by a pooled connection nobody unlocks) or the unlock call landing on
a different connection than the one that locked.
"""

import contextlib
import hashlib
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.exceptions import ApplicationError


def _lock_key(ai_system_id: UUID) -> int:
    # Postgres advisory lock keys are signed 64-bit integers.
    digest = hashlib.sha256(str(ai_system_id).encode("utf-8")).digest()[:8]
    return int.from_bytes(digest, "big", signed=True)


@contextlib.contextmanager
def ai_system_run_lock(engine: Engine, *, ai_system_id: UUID):
    """Serialize pipeline execution for one AI system; no-ops on non-Postgres.

    Non-blocking: raises ApplicationError (409) immediately if another run
    already holds the lock, rather than queuing silently behind it.
    """
    if engine.dialect.name != "postgresql":
        # The test suite (and any non-Postgres deployment) has no advisory
        # locks to take — correctness there comes from the test being
        # single-threaded, not from this mechanism.
        yield
        return

    key = _lock_key(ai_system_id)
    connection = engine.connect()
    try:
        acquired = connection.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": key}
        ).scalar()
        if not acquired:
            raise ApplicationError(
                status_code=409,
                code="RUN_ALREADY_IN_PROGRESS",
                message="An evaluation run is already in progress for this AI system.",
                details={"ai_system_id": str(ai_system_id)},
            )
        try:
            yield
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
    finally:
        connection.close()
