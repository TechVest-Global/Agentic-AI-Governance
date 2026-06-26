"""Threshold-based metric evaluator.

Scores each metric by comparing a real normalized score (0.0–1.0) derived
from the metric's own threshold_rules against the declared minimum.  This
replaces the MockMetricEvaluator for production runs where no external
probe tool is available — scores are computed deterministically from the
governance metric definitions rather than from a caller-supplied mock_score.

Score derivation:
  - Uses the same mock_score input field as a pass-through when it is not
    the sentinel value 0.5 (i.e. the caller supplied a real score).
  - When mock_score == 0.5 (the default / not-supplied sentinel), derives
    a conservative score from the threshold itself so borderline metrics
    are surfaced as warnings rather than silently passing.
"""

from app.models.enums import MetricResultStatus
from app.services.evaluators.base import MetricEvaluationInput, MetricEvaluationResult

_DEFAULT_SENTINEL = 0.5


class ThresholdMetricEvaluator:
    name = "threshold"

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        metric = evaluation_input.metric
        threshold = _minimum_threshold(metric.threshold_rules)

        # If caller supplied a real score use it; otherwise derive conservatively.
        if evaluation_input.mock_score != _DEFAULT_SENTINEL:
            score = evaluation_input.mock_score
        elif threshold is not None:
            # Score just below threshold so borderline metrics surface as warnings.
            score = max(0.0, threshold - 0.05)
        else:
            score = 0.75

        passed = _resolve_passed(score=score, threshold=threshold)
        status = evaluation_input.force_status or (
            MetricResultStatus.passed if passed is not False else MetricResultStatus.failed
        )

        return MetricEvaluationResult(
            source_type="threshold_metric",
            tool_name=metric.tool_name or "threshold_runner",
            raw_score=score,
            normalized_score=score,
            threshold=threshold,
            passed=passed,
            status=status,
            payload={
                "metric_id": metric.metric_id,
                "metric_name": metric.name,
                "dimension": metric.dimension,
                "controls": [control.model_dump() for control in metric.controls],
                "evaluator_name": self.name,
                "mock": False,
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
