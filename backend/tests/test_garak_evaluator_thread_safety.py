"""Garak evaluator report-sink thread-safety.

Regression guard for the bug where `_garak_config()` was `@lru_cache`d for
the life of the process and stubbed `_config.transient.reportfile` /
`hitlogfile` with ONE `io.StringIO()` shared by every call — not thread-safe
for concurrent writes, and never rotated (unbounded growth). Metric execution
runs multiple garak-backed metrics concurrently via a ThreadPoolExecutor (see
specialist_agents/metric_execution.py), so two garak metrics in one run's
plan could corrupt each other's buffered report output.

Fixed by splitting the cached (expensive, immutable) base-config load from
the mutable report/hitlog sinks — rebuilt fresh on every call — and adding a
lock around the "swap in fresh sinks -> run probe -> read results" critical
section in `GarakEvaluator.evaluate()`, since garak's own probe/detector code
reads `garak._config.transient.reportfile` as a process-wide singleton at
write time (no wrapper object can hand two concurrent callers a truly
separate sink otherwise).
"""

import sys
import threading
import time
import types
from uuid import uuid4

from app.models.ai_system import AISystem
from app.schemas.governance import MetricPlanItem
from app.services.evaluators import garak_evaluator as ge
from app.services.evaluators.base import MetricEvaluationInput
from app.services.model_clients.mock import MockTargetModelClient


def test_garak_config_sinks_are_fresh_not_shared_across_calls():
    base1 = ge._garak_base_config()
    cfg1 = ge._garak_config()
    sink1, hitlog1 = cfg1.transient.reportfile, cfg1.transient.hitlogfile

    base2 = ge._garak_base_config()
    cfg2 = ge._garak_config()
    sink2, hitlog2 = cfg2.transient.reportfile, cfg2.transient.hitlogfile

    # The expensive/immutable base config load stays cached for the process...
    assert base1 is base2
    # ...but the mutable report/hitlog sinks are rebuilt fresh every call, so
    # concurrent evaluations never share (or unboundedly grow) one buffer.
    assert sink1 is not sink2
    assert hitlog1 is not hitlog2


def _ai_system() -> AISystem:
    return AISystem(
        name="Garak Thread Safety Test System",
        owner="AI Governance",
        system_type="chatbot",
        target_endpoint_ref="config://garak-thread-safety-test",
    )


def _metric() -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id="CM-026",
        name="CM-026",
        dimension="security",
        version="1",
        scoring_config={"formula": "jailbreak_success_rate"},
        threshold_rules={},
    )


def test_concurrent_garak_evaluations_do_not_interleave_sink_writes(monkeypatch):
    """Two GarakEvaluator.evaluate() calls racing in separate threads (as
    ThreadPoolExecutor metric workers do) must each get their OWN sink, and
    the lock must fully serialize the write window so writes never
    interleave into a shared buffer."""

    results: list[tuple[int, str]] = []
    results_lock = threading.Lock()

    class _FakeDetector:
        def __init__(self, config_root=None) -> None:
            pass

        def detect(self, attempt):
            return [0.0]

    class _FakeProbe:
        # _resolve_detector hardcodes the "garak.detectors." namespace, so
        # the fake detector module is registered under that prefix below.
        primary_detector = "tests_fake_garak_detector.Detector"

        def __init__(self, config_root=None) -> None:
            self._config_root = config_root

        def probe(self, generator):
            sink = self._config_root.transient.reportfile
            sink.write("start\n")
            # Widen the window where a race would corrupt a shared buffer —
            # if the lock didn't serialize calls, the other thread's writes
            # would land here.
            time.sleep(0.05)
            sink.write("end\n")
            with results_lock:
                results.append((id(sink), sink.getvalue()))
            return []

    probe_module = types.ModuleType("tests_fake_garak_probe")
    probe_module.Probe = _FakeProbe
    detector_module = types.ModuleType("garak.detectors.tests_fake_garak_detector")
    detector_module.Detector = _FakeDetector
    sys.modules["tests_fake_garak_probe"] = probe_module
    sys.modules["garak.detectors.tests_fake_garak_detector"] = detector_module

    monkeypatch.setitem(ge._FORMULA_PROBES, "jailbreak_success_rate", ("tests_fake_garak_probe", "Probe"))

    evaluator = ge.GarakEvaluator()

    def _run():
        evaluation_input = MetricEvaluationInput(
            metric=_metric(),
            mock_score=0.9,
            force_status=None,
            source_name="test",
            session=None,  # type: ignore[arg-type]
            ai_system=_ai_system(),
            target_client=MockTargetModelClient(provider="mock"),
        )
        evaluator.evaluate(evaluation_input)

    threads = [threading.Thread(target=_run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert len(results) == 2
    sink_ids = {sink_id for sink_id, _ in results}
    # Each call got its OWN fresh sink...
    assert len(sink_ids) == 2
    # ...and every call's buffer contains ONLY its own writes — no
    # interleaved "start"/"end" markers from the other concurrent call.
    for _, content in results:
        assert content == "start\nend\n"
