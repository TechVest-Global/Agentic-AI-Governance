"""Startup reconciliation must not sit in front of the socket bind.

Reconciling an orphaned run RESUMES it — real probes against a real target,
minutes of work. Run inline in the startup hook it blocked the bind: uvicorn
logged "Waiting for application startup" and port 8000 never opened, so every
client saw a dead server. Observed for real: a run interrupted mid metric
execution made three consecutive restarts hang, and because a throttled target
makes the resume slow, the process died mid-resume each time and the next start
faced the same unfinished run — a restart loop that never served a request.

Two things these tests must be careful about, both learned the hard way:

  * they build their OWN app, so they never get conftest's in-memory engine.
    Any DB-backed endpoint would really be asserting that a Postgres happens to
    be running — which passed locally and failed in CI. Assert on
    /api/v1/openapi.json, which FastAPI generates without touching a database.
  * the reconciliation now runs on a background thread, so it can outlive the
    test. If monkeypatch unwinds first, the thread's runtime import resolves the
    REAL reconcile_interrupted_runs and runs it against whatever engine a LATER
    test has installed. That is not theoretical: it silently broke
    test_verdict_provenance further down the suite. Every test here waits for
    the patched function to finish before leaving the block.
"""

import threading
import time

from fastapi.testclient import TestClient


def test_startup_returns_before_reconciliation_finishes(monkeypatch) -> None:
    import app.services.orchestration as orchestration
    from app.main import create_app

    released = threading.Event()
    entered = threading.Event()
    finished = threading.Event()

    def _slow_reconcile(session) -> int:  # noqa: ANN001
        entered.set()
        released.wait(timeout=10)
        finished.set()
        return 0

    monkeypatch.setattr(orchestration, "reconcile_interrupted_runs", _slow_reconcile)

    started = time.monotonic()
    with TestClient(create_app()) as client:
        startup_elapsed = time.monotonic() - started
        # Serving while reconciliation is still parked inside _slow_reconcile —
        # which is the whole property under test.
        assert client.get("/api/v1/openapi.json").status_code == 200
        assert entered.wait(timeout=5), "reconciliation never ran at all"
        released.set()

    # Let the background thread finish while the patch is still installed.
    assert finished.wait(timeout=10), "reconciliation thread never completed"

    assert startup_elapsed < 5, (
        f"startup waited {startup_elapsed:.1f}s on reconciliation — the port bind is "
        f"still behind it"
    )


def test_a_failing_reconciliation_does_not_take_the_app_down(monkeypatch) -> None:
    import app.services.orchestration as orchestration
    from app.main import create_app

    finished = threading.Event()

    def _boom(session) -> int:  # noqa: ANN001
        try:
            raise RuntimeError("database unreachable")
        finally:
            finished.set()

    monkeypatch.setattr(orchestration, "reconcile_interrupted_runs", _boom)

    with TestClient(create_app()) as client:
        # DB-free endpoint on purpose — see the module docstring.
        assert client.get("/api/v1/openapi.json").status_code == 200

    assert finished.wait(timeout=10), "reconciliation thread never ran"
