"""An evaluator must probe the endpoint the caller resolved, not the base URL.

Observed live on a content-generation system registered with three capability
paths (image/text/video) and a base URL that serves nothing: the pyrit metric
sent 10 probes to http://localhost:8001 and got 10 404s, while probes that used
the resolved endpoint succeeded 23 times against the same target in the same
run. The metric reported the target as broken; the target was fine.
"""

from __future__ import annotations

import inspect
from uuid import uuid4

import pytest
from app.models.ai_system import AISystem, AISystemCapability
from app.models.enums import Modality
from app.services.evaluators.base import probe_endpoint, resolve_evaluator_endpoint

BASE = "http://localhost:8001"
TEXT_EP = "http://localhost:8001/api/compliance/probe/text"
IMAGE_EP = "http://localhost:8001/api/compliance/probe/image"

# Every evaluator that sends free-text probes to the audited system. Each must
# go through probe_endpoint(); reaching for ai_system.target_endpoint_ref
# directly is the defect this module exists to prevent recurring.
_PROBING_EVALUATORS = (
    "pyrit_evaluator",
    "audio_evaluator",
    "inspect_ai_evaluator",
    "garak_evaluator",
    "presidio_evaluator",
    "ragas_evaluator",
    "deepeval_evaluator",
)


def _system() -> AISystem:
    return AISystem(
        id=uuid4(),
        name="Marketing Campaign Generator",
        owner="o",
        system_type="content_generation",
        deployment_environment="dev",
        model_provider="openai",
        target_endpoint_ref=BASE,
    )


def _capability(name: str, endpoint: str, modality: Modality) -> AISystemCapability:
    return AISystemCapability(
        id=uuid4(),
        ai_system_id=uuid4(),
        name=name,
        capability_type="generation",
        endpoint_ref=endpoint,
        modality=modality,
    )


class _Input:
    """Minimal stand-in for MetricEvaluationInput's endpoint fields."""

    def __init__(self, resolved: str, ai_system: AISystem) -> None:
        self.target_endpoint_ref = resolved
        self.ai_system = ai_system


def test_the_resolved_endpoint_wins_over_the_base_url() -> None:
    assert probe_endpoint(_Input(IMAGE_EP, _system())) == IMAGE_EP


def test_the_base_url_is_used_only_when_nothing_was_resolved() -> None:
    """Single-endpoint systems resolve to nothing, and there the base is right."""
    assert probe_endpoint(_Input("", _system())) == BASE


def test_a_multi_capability_system_resolves_to_a_real_path() -> None:
    """The base URL of such a system has no functional route at all."""
    caps = [
        _capability("probeImage", IMAGE_EP, Modality.image),
        _capability("probeText", TEXT_EP, Modality.text),
    ]
    assert resolve_evaluator_endpoint(_system(), caps) == TEXT_EP


def test_a_scoped_audit_probes_the_capability_the_auditor_picked() -> None:
    caps = [
        _capability("probeImage", IMAGE_EP, Modality.image),
        _capability("probeText", TEXT_EP, Modality.text),
    ]
    resolved = resolve_evaluator_endpoint(_system(), caps, selected_capabilities=["probeImage"])
    assert resolved == IMAGE_EP


@pytest.mark.parametrize("module_name", _PROBING_EVALUATORS)
def test_no_evaluator_reaches_past_the_resolved_endpoint(module_name: str) -> None:
    """Guards the whole family, not just the three that were wrong.

    A new evaluator copying the old pattern would silently 404 on every
    multi-capability system, and the symptom — "the target is unreachable" —
    points away from the actual cause.
    """
    module = __import__(
        f"app.services.evaluators.{module_name}", fromlist=["*"]
    )
    source = inspect.getsource(module)
    assert "ai_system.target_endpoint_ref" not in source, (
        f"{module_name} reads ai_system.target_endpoint_ref directly; "
        "use probe_endpoint(evaluation_input) so a multi-capability system "
        "is probed at a path that exists"
    )
