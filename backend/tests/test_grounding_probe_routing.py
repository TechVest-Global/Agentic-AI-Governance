"""A grounding metric must probe the surface that reads the knowledge base.

A system can register more than one text endpoint — a stateless copywriter and a
brand-book-grounded one, which is exactly the Marketing Campaign Generator's
shape. The run resolves ONE endpoint for all metrics, and it resolves the
general one. Left alone, ragas would probe the ungrounded endpoint and then score
its reply against the seeded corpus, manufacturing hallucination findings out of
the audit's own routing rather than the system's behaviour.

The capability rows also come back unordered, so "first text capability wins"
could pick either endpoint from run to run.
"""

from __future__ import annotations

from uuid import uuid4

from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import CapabilityType, Modality
from app.schemas.governance import MetricPlanItem
from app.services.evaluators.base import (
    MetricEvaluationInput,
    grounding_probe_endpoint,
    resolve_evaluator_endpoint,
)

_PLAIN = "http://localhost:8001/api/compliance/probe/text"
_GROUNDED = "http://localhost:8001/api/compliance/probe/grounded-text"


def _system() -> AISystem:
    return AISystem(
        id=uuid4(),
        name="Marketing Campaign Generator",
        owner="o",
        system_type="content_generation",
        deployment_environment="dev",
        model_provider="openai",
        target_endpoint_ref="http://localhost:8001",
        selected_frameworks=[],
    )


def _capability(name: str, endpoint: str, cap_type: CapabilityType) -> AISystemCapability:
    return AISystemCapability(
        id=uuid4(),
        ai_system_id=uuid4(),
        name=name,
        capability_type=cap_type,
        modality=Modality.text,
        endpoint_ref=endpoint,
        enabled=True,
    )


def _plain() -> AISystemCapability:
    return _capability("probeText", _PLAIN, CapabilityType.generation)


def _grounded() -> AISystemCapability:
    return _capability("probeGroundedText", _GROUNDED, CapabilityType.retrieval)


def _input(capabilities) -> MetricEvaluationInput:
    return MetricEvaluationInput(
        metric=MetricPlanItem(
            metric_config_id=uuid4(),
            metric_id="CM-005",
            name="Hallucination Rate",
            version="1",
            dimension="groundedness",
            tool_name="ragas",
            scoring_config={"formula": "hallucination_rate"},
            threshold_rules={},
        ),
        mock_score=0.0,
        force_status=None,
        source_name="test",
        session=None,
        ai_system=_system(),
        target_client=object(),
        target_endpoint_ref=_PLAIN,
        capabilities=capabilities,
        run_id=None,
    )


def test_grounding_metrics_get_the_retrieval_endpoint() -> None:
    assert grounding_probe_endpoint(_input((_plain(), _grounded()))) == _GROUNDED


def test_ordering_of_the_capability_rows_does_not_decide_it() -> None:
    """The DB returns capabilities unordered; the answer must not depend on it."""
    assert grounding_probe_endpoint(_input((_grounded(), _plain()))) == _GROUNDED
    assert grounding_probe_endpoint(_input((_plain(), _grounded()))) == _GROUNDED


def test_ordinary_metrics_keep_the_general_endpoint() -> None:
    """Safety/fairness/security must not be diverted to the grounded surface.

    Probing the corpus-constrained variant would measure a different system.
    """
    for capabilities in ((_plain(), _grounded()), (_grounded(), _plain())):
        assert resolve_evaluator_endpoint(_system(), capabilities, ()) == _PLAIN


def test_a_single_text_capability_is_still_used_even_if_it_is_the_retrieval_one() -> None:
    """A system with ONLY a grounded endpoint must not fall back to the base URL."""
    assert resolve_evaluator_endpoint(_system(), (_grounded(),), ()) == _GROUNDED


def test_a_scoped_audit_still_wins() -> None:
    """An auditor picking a capability outranks both preferences."""
    caps = (_plain(), _grounded())
    assert resolve_evaluator_endpoint(_system(), caps, (_GROUNDED,)) == _GROUNDED
    assert resolve_evaluator_endpoint(_system(), caps, ("probeGroundedText",)) == _GROUNDED


def test_without_a_retrieval_capability_it_falls_back_to_the_run_endpoint() -> None:
    assert grounding_probe_endpoint(_input((_plain(),))) == _PLAIN
