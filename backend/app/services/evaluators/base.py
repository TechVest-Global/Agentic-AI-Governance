from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from sqlmodel import Session

from app.models.ai_system import AISystem
from app.models.enums import MetricResultStatus
from app.schemas.governance import MetricPlanItem

if TYPE_CHECKING:
    from app.services.model_clients.base import TargetModelClient


@dataclass(frozen=True)
class MetricEvaluationInput:
    metric: MetricPlanItem
    mock_score: float
    force_status: MetricResultStatus | None
    source_name: str
    # Real-tool evaluators (garak, presidio, ragas, deepeval) need these to
    # produce genuine evidence instead of a derived/placeholder score.
    session: Session
    ai_system: AISystem
    target_client: "TargetModelClient"


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
