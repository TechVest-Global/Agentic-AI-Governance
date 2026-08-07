"""Every agent name in config must resolve to a real agent in the registry.

These names are strings scattered across seed configs, and nothing validated them
against the registry — so a name could be wrong and stay wrong indefinitely,
because the failure is silent rather than loud.

That is exactly what happened. DEFAULT_FRAMEWORK_MAPPINGS named
``compliance_agent`` and ``risk_agent`` in 25 control mappings; the registry
builds ``compliance_mapper`` and ``risk_scorer``. The planner routes a coverage
gap through those mappings only as a fallback:

    matched = [agent_name for agent_name in activated if agent_name in ref_agents]

``activated`` holds real registry names, ``ref_agents`` held the wrong ones, so
the intersection was always empty. Any coverage gap that could only be routed to
the compliance or risk agent by control reference was silently dropped, costing
those two agents the gap-derived weight that feeds their probe budget — in the
two dimensions a governance product can least afford to under-probe.

Nothing crashed and no test failed, which is why it survived. Hence this file.
"""

from app.configs.defaults import DEFAULT_FRAMEWORK_MAPPINGS, DEFAULT_METRIC_CONFIGS
from app.services.agents.registry import _build_agents


def _registry_agent_names() -> set[str]:
    # The clients are only stored on the instances, never called during construction.
    return set(_build_agents(None, None))


def test_framework_mapping_agent_names_exist_in_the_registry() -> None:
    known = _registry_agent_names()
    referenced = {
        name for mapping in DEFAULT_FRAMEWORK_MAPPINGS for name in mapping.agent_names
    }

    unknown = sorted(referenced - known)
    assert not unknown, (
        f"control mappings reference agents that do not exist: {unknown}. "
        f"The planner intersects these with the activated agents, so an unknown "
        f"name silently drops the coverage gap instead of raising. Known: {sorted(known)}"
    )


def test_default_metric_primary_agents_exist_in_the_registry() -> None:
    """A wrong primary_agent here is worse than a dropped gap.

    ``activated`` is derived from primary_agent, and the pipeline passes those
    names straight to select_agents(), which raises a 422 for an unknown agent —
    taking down the entire specialist-agent phase rather than degrading.
    """
    known = _registry_agent_names()
    referenced = {
        metric.primary_agent for metric in DEFAULT_METRIC_CONFIGS if metric.primary_agent
    }

    unknown = sorted(referenced - known)
    assert not unknown, (
        f"default metric configs name agents that do not exist: {unknown}. "
        f"select_agents() raises 422 on an unknown name, failing the whole agent "
        f"phase. Known: {sorted(known)}"
    )


def test_registry_names_are_what_the_bootstrap_actually_stores() -> None:
    """Pins the mapping the YAML catalog relies on.

    The metric YAMLs declare ``agent_owner`` with a different vocabulary
    (``bias_auditor``, ``misuse_detector``, ``drift_analyst``,
    ``quality_evaluator``), which the bootstrap translates into these registry
    names. If that translation regresses, activated agents become unroutable and
    the agent phase 422s — so pin the target vocabulary explicitly.
    """
    assert _registry_agent_names() == {
        "quality_agent",
        "bias_agent",
        "misuse_agent",
        "drift_agent",
        "compliance_mapper",
        "risk_scorer",
        "explainability_agent",
    }
