"""Covers app.services.concurrency.ai_system_run_lock.

This is a real integration test against Postgres (session-level advisory
locks don't exist on the SQLite engine the rest of the suite uses) — it
skips itself if the dev Postgres container isn't reachable rather than
failing the whole suite on a machine without it running.
"""

import os
from uuid import uuid4

import pytest
from app.core.exceptions import ApplicationError
from app.services import concurrency
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/agentic_ai_governance"
)


def _postgres_engine():
    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return engine
    except Exception:  # noqa: BLE001
        pytest.skip("Postgres not reachable; skipping advisory-lock integration test")


def test_ai_system_run_lock_blocks_concurrent_acquisition_then_releases() -> None:
    engine = _postgres_engine()
    ai_system_id = uuid4()

    with concurrency.ai_system_run_lock(engine, ai_system_id=ai_system_id):
        with pytest.raises(ApplicationError) as exc_info:
            with concurrency.ai_system_run_lock(engine, ai_system_id=ai_system_id):
                pass
        assert exc_info.value.code == "RUN_ALREADY_IN_PROGRESS"
        assert exc_info.value.status_code == 409

    # Released when the outer context exits — re-acquiring now must succeed.
    with concurrency.ai_system_run_lock(engine, ai_system_id=ai_system_id):
        pass


def test_ai_system_run_lock_is_scoped_per_ai_system() -> None:
    engine = _postgres_engine()

    with concurrency.ai_system_run_lock(engine, ai_system_id=uuid4()):
        # A different ai_system_id must never conflict with the first lock.
        with concurrency.ai_system_run_lock(engine, ai_system_id=uuid4()):
            pass


def test_ai_system_run_lock_is_released_even_if_the_body_raises() -> None:
    engine = _postgres_engine()
    ai_system_id = uuid4()

    with pytest.raises(RuntimeError):
        with concurrency.ai_system_run_lock(engine, ai_system_id=ai_system_id):
            raise RuntimeError("simulated pipeline failure mid-run")

    # Must not still be held — a crash inside the lock must not leave the
    # AI system permanently stuck as "busy".
    with concurrency.ai_system_run_lock(engine, ai_system_id=ai_system_id):
        pass


def test_ai_system_run_lock_noops_on_non_postgres_dialect() -> None:
    # The test suite's own SQLite engine has no advisory locks at all —
    # the context manager must be a pure no-op, not raise, on that dialect.
    sqlite_engine = create_engine("sqlite://")
    ai_system_id = uuid4()

    with concurrency.ai_system_run_lock(sqlite_engine, ai_system_id=ai_system_id):
        with concurrency.ai_system_run_lock(sqlite_engine, ai_system_id=ai_system_id):
            pass
