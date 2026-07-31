"""A rate limit discovered by one worker must throttle all of them.

AGENT_TARGET_MAX_INFLIGHT bounds how many probes are in flight at once, but a 429
is normally a PER-MINUTE quota and concurrency alone cannot bound that. Without
shared state each worker rediscovers the limit independently: a live TechVest run
produced four separate 429s, each backing off on its own, then all retrying into
the same wall.

One GatewayTargetModelClient is built per run and handed to every agent and
evaluator, so it is the natural place to hold a shared cooldown.
"""

import threading
import time
import urllib.error

from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.gateway import GatewayTargetModelClient


def _http_error(code: int, retry_after: str | None = None) -> urllib.error.HTTPError:
    headers = {"Retry-After": retry_after} if retry_after else {}
    return urllib.error.HTTPError(
        url="https://target.invalid/api/chat",
        code=code,
        msg="Too Many Requests" if code == 429 else "Server Error",
        hdrs=headers,  # type: ignore[arg-type]
        fp=None,
    )


class _FakeTarget:
    """Fails the first ``fail_times`` calls, then succeeds. Records call times."""

    provider = "fake"
    credential_ref = "FAKE_KEY"
    supports_media = False

    def __init__(self, exc: Exception, fail_times: int = 1) -> None:
        self._exc = exc
        self._remaining = fail_times
        self._lock = threading.Lock()
        self.call_times: list[float] = []

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        with self._lock:
            self.call_times.append(time.monotonic())
            should_fail = self._remaining > 0
            if should_fail:
                self._remaining -= 1
        if should_fail:
            raise self._exc
        return TargetModelResponse(
            provider=self.provider,
            endpoint_ref=request.endpoint_ref,
            raw_output="ok",
            sanitized_output="ok",
            trace_id="t",
            latency_ms=1,
        )


def _request() -> TargetModelRequest:
    return TargetModelRequest(endpoint_ref="https://target.invalid", prompt="hi")


def test_rate_limit_puts_the_client_into_a_shared_cooldown() -> None:
    client = GatewayTargetModelClient(_FakeTarget(_http_error(429, "1"), fail_times=1))

    assert client._cooldown_until == 0.0
    client.invoke(_request())  # 429, then retry succeeds

    # The cooldown was published, so other workers can see it.
    assert client._cooldown_until > 0.0


def test_a_non_rate_limit_error_does_not_trigger_a_cooldown() -> None:
    """A 503 is transient but not a quota signal — per-call backoff is enough.

    Throttling the whole target on any transient blip would needlessly serialise
    every other worker.
    """
    client = GatewayTargetModelClient(_FakeTarget(_http_error(503), fail_times=1))

    client.invoke(_request())

    assert client._cooldown_until == 0.0


def test_retry_after_is_honoured_and_capped() -> None:
    """A hostile or mistaken Retry-After must not park a run for hours."""
    from app.services.model_clients.gateway import _retry_after_seconds

    assert _retry_after_seconds(_http_error(429, "2")) == 2.0
    assert _retry_after_seconds(_http_error(429, "99999")) == 30.0  # capped
    assert _retry_after_seconds(_http_error(429, "not-a-number")) is None
    assert _retry_after_seconds(_http_error(429)) is None


def test_one_workers_rate_limit_makes_another_worker_wait() -> None:
    """The property the whole change exists for.

    Worker A trips the limit and publishes a cooldown; worker B must then WAIT
    rather than firing its own request straight into the same limit. Asserted on
    B's elapsed time and on when the target was actually reached — not on
    internal state, which could be set and still not gate anything.
    """
    cooldown_s = 0.4
    target = _FakeTarget(_http_error(429), fail_times=0)  # would succeed instantly
    client = GatewayTargetModelClient(target)

    # Worker A discovered the limit a moment ago and published it.
    client._enter_cooldown(cooldown_s)
    published_at = time.monotonic()

    # Worker B goes to probe the same target.
    client.invoke(_request())

    assert target.call_times, "worker B never reached the target"
    reached_target_after = target.call_times[0] - published_at
    assert reached_target_after >= cooldown_s * 0.9, (
        f"worker B hit the target after only {reached_target_after:.2f}s of a "
        f"{cooldown_s}s cooldown — the shared gate did not hold it back"
    )


def test_a_worker_is_not_delayed_when_there_is_no_cooldown() -> None:
    """Guard against the gate slowing down every probe on a healthy target."""
    target = _FakeTarget(_http_error(429), fail_times=0)
    client = GatewayTargetModelClient(target)

    started = time.monotonic()
    client.invoke(_request())

    assert time.monotonic() - started < 0.2


def test_cooldown_extends_rather_than_shortens() -> None:
    """A shorter later Retry-After must not cut an existing cooldown short."""
    client = GatewayTargetModelClient(_FakeTarget(_http_error(429, "1"), fail_times=0))

    client._enter_cooldown(5.0)
    long_deadline = client._cooldown_until
    client._enter_cooldown(0.1)

    assert client._cooldown_until == long_deadline
