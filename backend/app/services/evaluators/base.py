from dataclasses import dataclass
from typing import Protocol

from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem


@dataclass(frozen=True)
class MetricEvaluationInput:
    metric: MetricPlanItem
    mock_score: float
    force_status: MetricResultStatus | None
    source_name: str


@dataclass(frozen=True)
class MetricEvaluationResult:
    source_type: str
    tool_name: str
    raw_score: float | None
    normalized_score: float | None
    threshold: float | None
    passed: bool | None
    status: MetricResultStatus
    payload: dict[str, object]


class MetricEvaluator(Protocol):
    name: str

    def evaluate(self, evaluation_input: MetricEvaluationInput) -> MetricEvaluationResult:
        """Evaluate one planned metric and return normalized evidence/result data."""
