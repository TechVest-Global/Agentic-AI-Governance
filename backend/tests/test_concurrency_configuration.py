"""The pipeline's concurrency knobs must actually be configurable, and the
target-request ceiling must actually be process-wide.

Every knob used to be a module-level ``os.getenv(...)`` read. The app's config is
pydantic-settings loading <repo>/.env, which never populates ``os.environ``, so
setting any of them in .env did nothing whatsoever — despite each one's comment
documenting it as the override mechanism. Reading at import time also froze the
value for the process, so no test could vary it.

Separately, the "process-wide" cap on concurrent target requests lived in
``agents/model_backed/base.py`` and was applied only to specialist-agent probes.
Metric-execution evaluators call the target client directly and were never
bounded by it. It also wrapped the Gateway's whole retry loop, so a throttled
probe held a scarce slot through its own backoff sleep — under sustained 429s
every slot fills with sleeping threads and all probing stalls, which is the exact
failure the cap exists to prevent.
"""

import threading
import time

import pytest
from app.core.config import get_settings
from app.services import concurrency_settings
from app.services.model_clients import target_throttle
from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.gateway import GatewayTargetModelClient
from openai import APITimeoutError


@pytest.fixture(autouse=True)
def _clean_settings():
    get_settings.cache_clear()
    target_throttle.reset_for_tests()
    yield
    get_settings.cache_clear()
    target_throttle.reset_for_tests()


@pytest.mark.parametrize(
    ("env_var", "accessor", "value", "expected"),
    [
        ("AGENT_EXECUTION_MAX_WORKERS", "agent_execution_max_workers", "7", 7),
        ("AGENT_EXECUTION_BUDGET_SECONDS", "agent_execution_budget_seconds", "42.5", 42.5),
        ("AGENT_PROBE_MAX_WORKERS", "agent_probe_max_workers", "9", 9),
        ("METRIC_EXECUTION_MAX_WORKERS", "metric_execution_max_workers", "5", 5),
        ("METRIC_EXECUTION_BUDGET_SECONDS", "metric_execution_budget_seconds", "77", 77.0),
        ("AGENT_TARGET_MAX_INFLIGHT", "target_max_inflight", "4", 4),
    ],
)
def test_concurrency_knobs_resolve_from_configuration(
    monkeypatch, env_var, accessor, value, expected
) -> None:
    monkeypatch.setenv(env_var, value)
    get_settings.cache_clear()

    assert getattr(concurrency_settings, accessor)() == expected


def test_target_inflight_defaults_to_the_probe_width(monkeypatch) -> None:
    """Keeps PEAK load on the audited system at its pre-parallelism level."""
    monkeypatch.setenv("AGENT_PROBE_MAX_WORKERS", "5")
    monkeypatch.delenv("AGENT_TARGET_MAX_INFLIGHT", raising=False)
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "0")
    get_settings.cache_clear()

    assert concurrency_settings.target_max_inflight() == 5


class _RecordingTargetClient:
    """Counts how many callers are inside invoke() at the same moment."""

    provider = "recording"
    credential_ref = "none"
    supports_media = False

    def __init__(self, *, hold_seconds: float = 0.05) -> None:
        self._hold = hold_seconds
        self._lock = threading.Lock()
        self.concurrent = 0
        self.peak_concurrent = 0

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        with self._lock:
            self.concurrent += 1
            self.peak_concurrent = max(self.peak_concurrent, self.concurrent)
        try:
            time.sleep(self._hold)
        finally:
            with self._lock:
                self.concurrent -= 1
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output="ok",
            sanitized_output="ok",
            trace_id="t",
            latency_ms=1,
        )


def _drive(client: GatewayTargetModelClient, callers: int) -> None:
    """Run `callers` concurrent invokes, surfacing any error a worker hit.

    Exceptions in a plain Thread are otherwise swallowed, which would let a
    broken stub pass the concurrency assertions below on counters that were
    incremented before the failure.
    """
    errors: list[BaseException] = []

    def _call() -> None:
        try:
            client.invoke(
                TargetModelRequest(endpoint_ref="e", prompt="p", capability_name="c")
            )
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=_call) for _ in range(callers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, f"target invocations failed: {errors}"


def test_gateway_enforces_the_cap_for_every_caller(monkeypatch) -> None:
    """Enforced in the Gateway, so it covers agents AND metric evaluators alike.

    Every target client is Gateway-wrapped (see model_clients/registry.py), which
    is what makes this one acquisition point genuinely process-wide — unlike the
    agent-only wrapper it replaced.
    """
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "2")
    get_settings.cache_clear()
    target_throttle.reset_for_tests()

    inner = _RecordingTargetClient()
    gateway = GatewayTargetModelClient(inner)

    _drive(gateway, callers=8)

    assert inner.peak_concurrent <= 2, (
        f"{inner.peak_concurrent} concurrent target requests got through a cap of 2"
    )
    assert inner.peak_concurrent > 1, "the cap serialized everything; no concurrency at all"


class _ThrottledOnceClient(_RecordingTargetClient):
    """Times out on the first attempt, then succeeds.

    Deliberately a timeout rather than a 429. A 429 now publishes a cooldown
    shared by every worker probing the target (see GatewayTargetModelClient.
    _await_cooldown), so it would make the second caller below wait by design —
    which is the opposite of what this test is about. A timeout is retried with
    the same backoff but carries no cooldown, so it isolates slot occupancy,
    the property under test here.
    """

    def __init__(self) -> None:
        super().__init__(hold_seconds=0.0)
        self._lock_fail = threading.Lock()
        self._failed_once = False

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        with self._lock_fail:
            first = not self._failed_once
            self._failed_once = True
        if first:
            raise APITimeoutError(request=None)  # type: ignore[arg-type]
        return super().invoke(request)


def test_retry_backoff_does_not_occupy_a_slot(monkeypatch) -> None:
    """The slot is per ATTEMPT, so a backing-off caller cannot block the others.

    With a cap of 1 and the acquisition around the whole retry loop, the single
    throttled caller below would hold the only slot through its ~1s sleep and the
    second caller could not start until it finished. Per-attempt acquisition lets
    the second caller through while the first sleeps.
    """
    monkeypatch.setenv("AGENT_TARGET_MAX_INFLIGHT", "1")
    get_settings.cache_clear()
    target_throttle.reset_for_tests()

    inner = _ThrottledOnceClient()
    gateway = GatewayTargetModelClient(inner)

    second_finished_at: list[float] = []

    def _second() -> None:
        # Let the first caller take its timeout and enter backoff before starting.
        time.sleep(0.15)
        gateway.invoke(TargetModelRequest(endpoint_ref="e", prompt="p", capability_name="c"))
        second_finished_at.append(time.monotonic())

    started = time.monotonic()
    first = threading.Thread(
        target=gateway.invoke,
        args=(TargetModelRequest(endpoint_ref="e", prompt="p", capability_name="c"),),
    )
    second = threading.Thread(target=_second)
    first.start()
    second.start()
    first.join(timeout=10)
    second.join(timeout=10)

    assert second_finished_at, "the second caller never completed"
    # The first caller's backoff is 2**0 == 1s. The second must not have waited
    # on it; it should finish comfortably inside that window.
    assert second_finished_at[0] - started < 0.9, (
        "the second caller was blocked behind the first caller's retry sleep — "
        "the throttle slot is being held across backoff"
    )
