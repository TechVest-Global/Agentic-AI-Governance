from app.core.exceptions import ApplicationError
from app.services.evaluators.base import MetricEvaluator
from app.services.evaluators.deepeval_evaluator import DeepEvalEvaluator
from app.services.evaluators.garak_evaluator import GarakEvaluator
from app.services.evaluators.mock import MockMetricEvaluator
from app.services.evaluators.presidio_evaluator import PresidioEvaluator
from app.services.evaluators.ragas_evaluator import RagasEvaluator
from app.services.evaluators.threshold import ThresholdMetricEvaluator

EVALUATORS: dict[str, MetricEvaluator] = {
    evaluator.name: evaluator
    for evaluator in (
        ThresholdMetricEvaluator(),
        MockMetricEvaluator(),
        GarakEvaluator(),
        PresidioEvaluator(),
        RagasEvaluator(),
        DeepEvalEvaluator(),
    )
}

# Metrics not yet backed by a real tool integration (langfuse, evidently,
# promptfoo) fall back to the deterministic threshold evaluator rather than
# a metric-by-metric hard failure.
AUTO_EVALUATOR_NAME = "auto"
_AUTO_FALLBACK = "threshold"


def get_evaluator(evaluator_name: str) -> MetricEvaluator:
    normalized_name = evaluator_name.strip().lower()
    if normalized_name == AUTO_EVALUATOR_NAME:
        return _AutoRoutingEvaluator()
    evaluator = EVALUATORS.get(normalized_name)
    if evaluator is None:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Unknown metric evaluator requested.",
            details={
                "unknown_evaluator": evaluator_name,
                "available_evaluators": sorted(EVALUATORS) + [AUTO_EVALUATOR_NAME],
            },
        )
    return evaluator


class _AutoRoutingEvaluator:
    """Routes each metric to the real evaluator its own `tool_name` names,
    falling back to the deterministic threshold evaluator for tools without
    a real integration yet (langfuse, evidently, promptfoo)."""

    name = AUTO_EVALUATOR_NAME

    def evaluate(self, evaluation_input):
        tool_name = (evaluation_input.metric.tool_name or "").strip().lower()
        evaluator = EVALUATORS.get(tool_name, EVALUATORS[_AUTO_FALLBACK])
        return evaluator.evaluate(evaluation_input)
