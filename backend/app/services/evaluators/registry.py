from app.core.exceptions import ApplicationError
from app.services.evaluators.audio_evaluator import AudioEvaluator
from app.services.evaluators.base import MetricEvaluator
from app.services.evaluators.deepeval_evaluator import DeepEvalEvaluator
from app.services.evaluators.drift_evaluator import DriftEvaluator
from app.services.evaluators.garak_evaluator import GarakEvaluator
from app.services.evaluators.inspect_ai_evaluator import InspectAIEvaluator
from app.services.evaluators.langfuse_evaluator import LangfuseEvaluator
from app.services.evaluators.mock import MockMetricEvaluator
from app.services.evaluators.presidio_evaluator import PresidioEvaluator
from app.services.evaluators.pyrit_evaluator import PyritEvaluator
from app.services.evaluators.ragas_evaluator import RagasEvaluator
from app.services.evaluators.threshold import ThresholdMetricEvaluator
from app.services.evaluators.vision_evaluator import VisionEvaluator

EVALUATORS: dict[str, MetricEvaluator] = {
    evaluator.name: evaluator
    for evaluator in (
        ThresholdMetricEvaluator(),
        MockMetricEvaluator(),
        GarakEvaluator(),
        PresidioEvaluator(),
        RagasEvaluator(),
        DeepEvalEvaluator(),
        PyritEvaluator(),
        InspectAIEvaluator(),
        VisionEvaluator(),
        AudioEvaluator(),
        DriftEvaluator(),
        LangfuseEvaluator(),
    )
}

# CM-030/031/032 were catalogued against `evidently` and skipped on every run for
# want of an integration. They are now scored by DriftEvaluator, which probes the
# target directly (evidently compares dataframes and cannot see a black-box
# endpoint at all — see drift_evaluator's module docstring).
#
# The alias exists because the catalog YAML and the database disagree by design:
# bootstrap SKIPS metric_configs rows that already exist, so every database
# seeded before this change still carries tool_name="evidently" and would keep
# routing to the skip branch below. Aliasing routes those rows to the real
# evaluator with no re-seed and no migration, on every deployment, while fresh
# installs pick up tool: drift from the YAML.
EVALUATORS["evidently"] = EVALUATORS[DriftEvaluator.name]

# langfuse now has a real evaluator (see langfuse_evaluator.py), but it only
# scores CM-039 (trace_completeness) — the other three tool:langfuse metrics
# (CM-040/041/044) need a workflow_db integration that does not exist, and get
# a specific skip reason from that module rather than reaching the auto router
# at all. Metrics on a tool with no evaluator entry here (promptfoo) still fall
# through to the auto router (see below).
AUTO_EVALUATOR_NAME = "auto"


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
    """Routes each metric to the real evaluator its own `tool_name` names.

    Metrics whose tool has no real integration yet (langfuse, promptfoo) are
    reported as SKIPPED with an explicit reason. They used to
    fall back to the threshold evaluator, which derived a score just below the
    threshold — fabricating a guaranteed "failed" result with no evidence
    behind it. Skipped keeps them visible (agents still investigate pending/
    skipped metrics) without polluting reports with synthetic failures."""

    name = AUTO_EVALUATOR_NAME

    def evaluate(self, evaluation_input):
        from app.models.enums import MetricResultStatus
        from app.services.evaluators.base import MetricEvaluationResult

        tool_name = (evaluation_input.metric.tool_name or "").strip().lower()
        evaluator = EVALUATORS.get(tool_name)
        if evaluator is not None:
            return evaluator.evaluate(evaluation_input)

        metric = evaluation_input.metric
        return MetricEvaluationResult(
            source_type="auto_router",
            tool_name=metric.tool_name or "unknown",
            raw_score=None,
            normalized_score=None,
            threshold=None,
            passed=None,
            status=MetricResultStatus.skipped,
            payload={
                "metric_id": metric.metric_id,
                "metric_name": metric.name,
                "dimension": metric.dimension,
                "reason": (
                    f"no real evaluator integrated for tool '{tool_name or 'unset'}' — "
                    "metric skipped rather than scored synthetically"
                ),
                "evaluator_name": self.name,
            },
        )
