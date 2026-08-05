"""Presidio must not report a dead target connection as an observed PII leak.

79 of 251 historical evaluations (31%) ended in status="error" with a raw
URLError — the target simply wasn't reachable. The probe call was unguarded,
so the exception propagated out of evaluate() to metric_execution's generic
handler, which stores status=error. metric_failed() treats error exactly like
a genuine failure, so misuse_agent's deterministic fallback turned "the target
was down" into a critical "Security metric failed" finding implying PII
actually leaked — from zero probes that ever reached anything.

Each probe is now caught individually and excluded, mirroring
drift_evaluator's per-unit resilience and inspect_ai_evaluator's NOANSWER
exclusion (test_inspect_ai_probe_resilience.py) — a target outage skips
honestly instead of masquerading as an observed leak.
"""

from __future__ import annotations

from uuid import uuid4

from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.presidio_evaluator import PresidioEvaluator


def _metric(formula: str = "pii_leakage_rate") -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id="CM-022",
        name="PII Leakage Rate",
        version="1",
        dimension="privacy",
        tool_name="presidio",
        scoring_config={"formula": formula},
        threshold_rules={},
    )


def _ai_system() -> AISystem:
    return AISystem(
        id=uuid4(), name="Test System", owner="o", system_type="chatbot",
        deployment_environment="dev", model_provider="openai",
        target_endpoint_ref="http://localhost:8001", selected_frameworks=[],
    )


class _AlwaysDownTarget:
    def invoke(self, request):  # noqa: ANN001, ANN201
        raise ConnectionRefusedError(
            "<urlopen error [WinError 10061] No connection could be made "
            "because the target machine actively refused it>"
        )


class _FlakyTarget:
    """Fails on the first probe, answers cleanly on the rest."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, request):  # noqa: ANN001, ANN201
        self.calls += 1
        if self.calls == 1:
            raise ConnectionRefusedError("connection refused")
        from types import SimpleNamespace

        return SimpleNamespace(raw_output="Sure, nothing sensitive here.", media=[])


class _CleanTarget:
    def invoke(self, request):  # noqa: ANN001, ANN201
        from types import SimpleNamespace

        return SimpleNamespace(raw_output="I can't share personal details.", media=[])


def _input(target, formula: str = "pii_leakage_rate") -> MetricEvaluationInput:
    return MetricEvaluationInput(
        metric=_metric(formula), mock_score=0.0, force_status=None, source_name="test",
        session=None, ai_system=_ai_system(), target_client=target,
        target_endpoint_ref="http://localhost:8001", run_id=None,
    )


def test_target_unreachable_skips_honestly_instead_of_erroring() -> None:
    result = PresidioEvaluator().evaluate(_input(_AlwaysDownTarget()))

    assert result.status == MetricResultStatus.skipped, (
        "a dead target connection must never surface as status=error, which "
        "metric_failed() treats identically to a genuine observed failure"
    )
    assert result.passed is None
    assert "actively refused" in result.payload["skipped_reason"]


def test_one_unreachable_probe_does_not_discard_the_others() -> None:
    target = _FlakyTarget()

    result = PresidioEvaluator().evaluate(_input(target))

    assert result.status != MetricResultStatus.skipped
    assert result.payload["unreachable_probe_count"] == 1
    assert result.payload["probe_count"] == 1, "the one probe that DID answer is still scored"


def test_a_fully_reachable_target_is_unaffected() -> None:
    result = PresidioEvaluator().evaluate(_input(_CleanTarget()))

    assert result.status == MetricResultStatus.passed
    assert result.payload["unreachable_probe_count"] == 0
    assert result.payload["probe_count"] == 2


def test_unsupported_formula_still_skips_as_before() -> None:
    result = PresidioEvaluator().evaluate(_input(_CleanTarget(), formula="not_a_real_formula"))
    assert result.status == MetricResultStatus.skipped
    assert "unsupported formula" in result.payload["skipped_reason"]
