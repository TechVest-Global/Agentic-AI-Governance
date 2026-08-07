"""CM-039 (trace_completeness) is the only tool:langfuse metric that can be
honestly scored — CM-040/041/044 need a workflow_db integration (escalation
ground truth, human-override logs, review-queue records) that does not exist
anywhere in this application, and scoring them from Langfuse trace data would
fabricate a number unrelated to what the metric claims. This suite covers:

  * the real per-run trace-completeness counter in langfuse_tracer.py
  * LangfuseEvaluator's honest skips (not configured, no calls yet, the three
    workflow_db formulas) and its one real score
  * that a tunnelled run_id actually reaches the counter through the gateway
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.core.config import get_settings
from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.langfuse_evaluator import LangfuseEvaluator
from app.services.model_clients import gateway
from app.services.tracing import langfuse_tracer


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    get_settings.cache_clear()
    langfuse_tracer.reset_for_tests()
    yield
    get_settings.cache_clear()
    langfuse_tracer.reset_for_tests()


def _metric(metric_id: str, formula: str) -> MetricPlanItem:
    return MetricPlanItem(
        metric_config_id=uuid4(),
        metric_id=metric_id,
        name=metric_id,
        version="1",
        dimension="transparency",
        tool_name="langfuse",
        scoring_config={"formula": formula},
        threshold_rules={},
    )


def _ai_system() -> AISystem:
    return AISystem(
        id=uuid4(), name="Test System", owner="o", system_type="chatbot",
        deployment_environment="dev", model_provider="openai",
        target_endpoint_ref="http://localhost:8001", selected_frameworks=[],
    )


def _input(metric: MetricPlanItem, run_id=None) -> MetricEvaluationInput:
    return MetricEvaluationInput(
        metric=metric, mock_score=0.0, force_status=None, source_name="test",
        session=None, ai_system=_ai_system(), target_client=None,
        target_endpoint_ref="http://localhost:8001", run_id=run_id,
    )


# ── the 3 workflow_db formulas: honest, specific skip ────────────────────────


@pytest.mark.parametrize(
    "metric_id,formula",
    [
        ("CM-040", "escalation_f1_score"),
        ("CM-041", "human_override_rate"),
        ("CM-044", "review_queue_hit_rate"),
    ],
)
def test_workflow_db_formulas_skip_with_a_specific_reason_not_the_generic_one(
    metric_id, formula, monkeypatch
):
    monkeypatch.setattr(langfuse_tracer, "is_configured", lambda: True)
    monkeypatch.setattr(langfuse_tracer, "is_active", lambda: True)

    result = LangfuseEvaluator().evaluate(_input(_metric(metric_id, formula), run_id=uuid4()))

    assert result.status == MetricResultStatus.skipped
    assert "workflow_db" in result.payload["skipped_reason"]
    assert result.payload["skipped_reason"] != "no real evaluator integrated for tool 'langfuse'"


def test_workflow_db_skip_explains_the_override_columns_are_a_different_thing():
    """CM-041 (human_override_rate) is about the AUDITED system's own
    production decisions — must not silently reuse Verdict.human_override_*
    (which records overriding THIS TOOL's verdict) as if it answered that."""
    result = LangfuseEvaluator().evaluate(_input(_metric("CM-041", "human_override_rate")))

    assert "AUDITED SYSTEM" in result.payload["skipped_reason"]


# ── deployment not configured: honest skip, not a fabricated 0% ─────────────


def test_not_configured_skips_with_a_clear_setup_reason(monkeypatch):
    monkeypatch.setattr(langfuse_tracer, "is_configured", lambda: False)

    result = LangfuseEvaluator().evaluate(
        _input(_metric("CM-039", "trace_completeness"), run_id=uuid4())
    )

    assert result.status == MetricResultStatus.skipped
    assert result.normalized_score is None, "not-configured must not read as a 0% failure"
    assert "LANGFUSE_PUBLIC_KEY" in result.payload["skipped_reason"]


def test_no_calls_logged_yet_skips_rather_than_scoring_zero(monkeypatch):
    monkeypatch.setattr(langfuse_tracer, "is_configured", lambda: True)
    monkeypatch.setattr(langfuse_tracer, "is_active", lambda: True)

    result = LangfuseEvaluator().evaluate(
        _input(_metric("CM-039", "trace_completeness"), run_id=uuid4())
    )

    assert result.status == MetricResultStatus.skipped
    assert "no LLM calls" in result.payload["skipped_reason"]


# ── CM-039 real scoring from the per-run counter ─────────────────────────────


def test_trace_completeness_scores_from_real_per_run_counts(monkeypatch):
    monkeypatch.setattr(langfuse_tracer, "is_configured", lambda: True)
    monkeypatch.setattr(langfuse_tracer, "is_active", lambda: True)
    run_id = uuid4()
    for _ in range(3):
        langfuse_tracer.record_llm_call({"call_type": "target"}, run_id=run_id)
    monkeypatch.setattr(
        langfuse_tracer, "completeness_for_run", lambda rid: (4, 3) if rid == run_id else None
    )

    result = LangfuseEvaluator().evaluate(_input(_metric("CM-039", "trace_completeness"), run_id=run_id))

    assert result.status != MetricResultStatus.skipped
    assert result.normalized_score == pytest.approx(0.75)
    assert result.payload["traced_calls"] == 3
    assert result.payload["total_calls"] == 4
    assert "scope" in result.payload, "must state it only covers metric-execution-phase calls"


def test_complete_tracing_passes():
    counts_holder = {"value": (5, 5)}

    class _Active:
        @staticmethod
        def is_configured():
            return True

        @staticmethod
        def is_active():
            return True

        @staticmethod
        def completeness_for_run(rid):
            return counts_holder["value"]

    import app.services.evaluators.langfuse_evaluator as mod

    original = mod.langfuse_tracer
    mod.langfuse_tracer = _Active
    try:
        result = LangfuseEvaluator().evaluate(
            _input(_metric("CM-039", "trace_completeness"), run_id=uuid4())
        )
    finally:
        mod.langfuse_tracer = original

    assert result.status == MetricResultStatus.passed
    assert result.normalized_score == 1.0


def test_unsupported_formula_skips():
    result = LangfuseEvaluator().evaluate(_input(_metric("CM-999", "made_up_formula")))
    assert result.status == MetricResultStatus.skipped
    assert "unsupported formula" in result.payload["skipped_reason"]


# ── the per-run counter itself ───────────────────────────────────────────────


def test_counter_tracks_attempted_and_succeeded_separately(monkeypatch):
    run_id = uuid4()

    class _RaisingClient:
        def start_observation(self, **kwargs):
            raise RuntimeError("SDK network error")

    monkeypatch.setattr(langfuse_tracer, "_client", lambda: _RaisingClient())

    langfuse_tracer.record_llm_call({"task": "x"}, run_id=run_id)

    attempted, succeeded = langfuse_tracer.completeness_for_run(run_id)
    assert attempted == 1
    assert succeeded == 0, "an SDK error emitting the span must not count as traced"


def test_counter_returns_none_for_an_unseen_run():
    assert langfuse_tracer.completeness_for_run(uuid4()) is None


def test_counter_is_isolated_per_run():
    run_a, run_b = uuid4(), uuid4()
    langfuse_tracer.record_llm_call({}, run_id=run_a)
    langfuse_tracer.record_llm_call({}, run_id=run_a)
    langfuse_tracer.record_llm_call({}, run_id=run_b)

    assert langfuse_tracer.completeness_for_run(run_a)[0] == 2
    assert langfuse_tracer.completeness_for_run(run_b)[0] == 1


# ── the gateway actually threads run_id through ──────────────────────────────


def test_append_log_passes_the_buffers_run_id_to_the_counter(monkeypatch):
    run_id = uuid4()
    seen: dict = {}

    def _fake_record_llm_call(entry, run_id=None):
        seen["run_id"] = run_id

    monkeypatch.setattr(
        "app.services.tracing.langfuse_tracer.record_llm_call", _fake_record_llm_call
    )

    gateway.start_log_capture(run_id, "metric_execution")
    try:
        gateway._append_log({"task": "probe"})
    finally:
        gateway.drain_log_capture()

    assert seen["run_id"] == run_id
