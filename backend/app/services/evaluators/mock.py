from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult


class MockMetricEvaluator:
    name = "mock"

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        metric = evaluation_input.metric
        threshold = _minimum_threshold(metric.threshold_rules)
        passed = _resolve_passed(score=evaluation_input.mock_score, threshold=threshold)
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed is not False else MetricResultStatus.failed
        )

        return MetricEvaluationResult(
            source_type="mock_metric",
            tool_name=metric.tool_name or "mock_runner",
            raw_score=evaluation_input.mock_score,
            normalized_score=evaluation_input.mock_score,
            threshold=threshold,
            passed=passed,
            status=status,
            payload={
                "metric_id": metric.metric_id,
                "metric_name": metric.name,
                "dimension": metric.dimension,
                "controls": [control.model_dump() for control in metric.controls],
                "evaluator_name": self.name,
                "mock": True,
            },
        )


def _minimum_threshold(threshold_rules: dict[str, object]) -> float | None:
    for key in ("minimum", "medium_risk_minimum", "high_risk_minimum"):
        value = threshold_rules.get(key)
        if isinstance(value, int | float):
            return float(value)
    return None


def _resolve_passed(*, score: float, threshold: float | None) -> bool | None:
    if threshold is None:
        return None
    return score >= threshold
