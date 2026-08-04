"""Startup reconciliation must not sit in front of the socket bind.

Reconciling an orphaned run RESUMES it — real probes against a real target,
minutes of work. Run inline in the startup hook it blocked the bind: uvicorn
logged "Waiting for application startup" and port 8000 never opened, so every
client saw a dead server. Observed for real: a run interrupted mid metric
execution made three consecutive restarts hang, and because a throttled target
makes the resume slow, the process died mid-resume each time and the next start
faced the same unfinished run — a restart loop that never served a request.
"""

import threading
import time

from fastapi.testclient import TestClient


def test_startup_returns_before_reconciliation_finishes(monkeypatch) -> None:
    import app.services.orchestration as orchestration
    from app.main import create_app

    released = threading.Event()
    entered = threading.Event()

    def _slow_reconcile(session) -> int:  # noqa: ANN001
        entered.set()
        released.wait(timeout=10)
        return 0

    monkeypatch.setattr(orchestration, "reconcile_interrupted_runs", _slow_reconcile)

    started = time.monotonic()
    with TestClient(create_app()) as client:
        startup_elapsed = time.monotonic() - started
        # The app is serving while reconciliation is still parked in _slow_reconcile.
        assert client.get("/api/v1/ai-systems").status_code in (200, 401, 403)
        assert entered.wait(timeout=5), "reconciliation never ran at all"
        released.set()

    assert startup_elapsed < 5, (
        f"startup waited {startup_elapsed:.1f}s on reconciliation — the port bind is "
        f"still behind it"
    )


def test_a_failing_reconciliation_does_not_take_the_app_down(monkeypatch) -> None:
    import app.services.orchestration as orchestration
    from app.main import create_app

    def _boom(session) -> int:  # noqa: ANN001
        raise RuntimeError("database unreachable")

    monkeypatch.setattr(orchestration, "reconcile_interrupted_runs", _boom)

    with TestClient(create_app()) as client:
        assert client.get("/api/v1/ai-systems").status_code in (200, 401, 403)
