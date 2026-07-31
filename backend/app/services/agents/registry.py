from typing import TYPE_CHECKING

from app.core.exceptions import ApplicationError
from app.services.agents.base import GovernanceAgent
from app.services.agents.model_backed.bias_agent import BiasAuditorAgent
from app.services.agents.model_backed.compliance_mapper import ComplianceMapperAgent
from app.services.agents.model_backed.drift_agent import DriftAnalystAgent
from app.services.agents.model_backed.explainability_agent import ExplainabilityAgent
from app.services.agents.model_backed.misuse_agent import MisuseDetectorAgent
from app.services.agents.model_backed.quality_agent import QualityEvaluatorAgent
from app.services.agents.model_backed.risk_scorer import RiskScorerAgent

if TYPE_CHECKING:
    from app.services.model_clients.base import GovernanceModelClient, TargetModelClient

# The registered specialist agent classes — read once here so callers that
# only need names/dimensions (validating an LLM-supplied agent reference, or
# routing by dimension) don't have to construct real agent instances (which
# need live target/governance clients) just to enumerate them.
_AGENT_CLASSES: tuple[type[GovernanceAgent], ...] = (
    QualityEvaluatorAgent,
    BiasAuditorAgent,
    MisuseDetectorAgent,
    DriftAnalystAgent,
    ComplianceMapperAgent,
    RiskScorerAgent,
    ExplainabilityAgent,
)

REGISTERED_AGENT_NAMES: frozenset[str] = frozenset(cls.name for cls in _AGENT_CLASSES)

# probe_dimension -> agent_name, for dimension-based routing (e.g. re_plan).
# Agents without a probe_dimension (drift_agent's is set explicitly; none are
# currently unset) are simply absent from this map.
DIMENSION_TO_AGENT_NAME: dict[str, str] = {
    cls.probe_dimension: cls.name for cls in _AGENT_CLASSES if cls.probe_dimension
}


def _build_agents(
    target_client: "TargetModelClient", governance_client: "GovernanceModelClient"
) -> dict[str, GovernanceAgent]:
    agents: list[GovernanceAgent] = [
        QualityEvaluatorAgent(target_client, governance_client),
        BiasAuditorAgent(target_client, governance_client),
        MisuseDetectorAgent(target_client, governance_client),
        DriftAnalystAgent(target_client, governance_client),
        ComplianceMapperAgent(target_client, governance_client),
        RiskScorerAgent(target_client, governance_client),
        ExplainabilityAgent(target_client, governance_client),
    ]
    return {agent.name: agent for agent in agents}


def select_agents(
    agent_names: list[str] | None = None,
    *,
    target_client: "TargetModelClient",
    governance_client: "GovernanceModelClient",
) -> list[GovernanceAgent]:
    """Build the requested agents, wired to the client for the SPECIFIC system
    under audit.

    ``target_client`` must be resolved per-ai-system (``get_target_model_client_for_system``)
    by the caller, not the global ``get_target_model_client()`` — that global
    resolver reads a single system-agnostic TARGET_ENDPOINT/TARGET_SYSTEM_KIND
    setting, which silently sent every agent's probes to whatever that setting
    pointed at (e.g. the HR gateway) regardless of which system was actually
    being audited. Evaluator tool calls (garak/presidio/ragas/deepeval, via
    AgentContext.target_client) already used the correct per-system resolver;
    agents built here previously did not.
    """
    agents = _build_agents(target_client, governance_client)
    if not agent_names:
        return list(agents.values())

    unknown_agents = [name for name in agent_names if name not in agents]
    if unknown_agents:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Unknown governance agent requested.",
            details={"unknown_agents": unknown_agents},
        )
    return [agents[name] for name in agent_names]
