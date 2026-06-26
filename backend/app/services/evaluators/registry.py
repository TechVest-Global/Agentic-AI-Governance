from app.core.exceptions import ApplicationError
from app.services.evaluators.base import MetricEvaluator
from app.services.evaluators.mock import MockMetricEvaluator
from app.services.evaluators.threshold import ThresholdMetricEvaluator

EVALUATORS: dict[str, MetricEvaluator] = {
    evaluator.name: evaluator
    for evaluator in (
        ThresholdMetricEvaluator(),
        MockMetricEvaluator(),
    )
}


def get_evaluator(evaluator_name: str) -> MetricEvaluator:
    normalized_name = evaluator_name.strip().lower()
    evaluator = EVALUATORS.get(normalized_name)
    if evaluator is None:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Unknown metric evaluator requested.",
            details={
                "unknown_evaluator": evaluator_name,
                "available_evaluators": sorted(EVALUATORS),
            },
        )
    return evaluator
