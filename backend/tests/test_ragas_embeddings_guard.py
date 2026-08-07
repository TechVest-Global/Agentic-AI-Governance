"""A metric that cannot be scored must say so, not fail mid-score.

CM-011 (answer_relevancy) maps to ragas's ResponseRelevancy, which scores by
embedding similarity rather than by asking the judge. _build_metric only ever
passes `llm=`, and Settings has no embeddings deployment at all, so on a live
42-metric run this metric came back as:

    scoring failed: Error: 'answer_relevancy' requires embeddings to be set.

— a library error surfaced as an opaque metric failure. It is unscoreable by
construction, which is a configuration gap to report, not a run-time fault.
Every other unmeetable prerequisite in this evaluator (missing interpreter,
missing judge) is already reported as an explicit skip with instructions.
"""

from app.models.config import MetricConfig
from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput
from app.services.evaluators.ragas_evaluator import RagasEvaluator


def _metric(formula: str, metric_id: str = "CM-011") -> MetricConfig:
    return MetricConfig(
        metric_id=metric_id,
        name="Answer Relevancy",
        dimension="retrieval",
        tool_name="ragas",
        scoring_config={"formula": formula},
        threshold_rules={},
    )


def _input(metric: MetricConfig) -> MetricEvaluationInput:
    return MetricEvaluationInput(
        metric=metric,
        mock_score=1.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=None,
        target_client=None,
        target_endpoint_ref="https://target.invalid",
        capabilities=(),
        run_id=None,
    )


def test_an_embedding_scored_metric_is_skipped_with_an_actionable_reason() -> None:
    result = RagasEvaluator().evaluate(_input(_metric("answer_relevancy")))

    assert result.status is MetricResultStatus.skipped
    assert result.normalized_score is None
    reason = result.payload["skipped_reason"]
    assert "embedding" in reason.lower(), reason
    # Actionable: names the thing to configure, like the other skip branches do.
    assert "configured" in reason or "configure" in reason, reason
    assert "requires embeddings to be set" not in reason, (
        "the raw ragas error leaked through instead of an explained skip"
    )


def test_a_judge_scored_ragas_metric_is_not_caught_by_the_guard() -> None:
    """Faithfulness needs only the judge LLM — it must reach the normal path."""
    result = RagasEvaluator().evaluate(_input(_metric("faithfulness", metric_id="CM-005")))

    reason = (result.payload or {}).get("skipped_reason", "")
    assert "embedding" not in reason.lower(), (
        f"a judge-scored metric was wrongly gated on embeddings: {reason}"
    )
