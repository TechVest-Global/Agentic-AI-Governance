from app.core.exceptions import ApplicationError
from app.services.agents.base import GovernanceAgent
from app.services.agents.deterministic.compliance_agent import ComplianceAgent
from app.services.agents.deterministic.explainability_agent import ExplainabilityAgent
from app.services.agents.deterministic.risk_agent import RiskAgent
from app.services.agents.model_backed.bias_agent import BiasAuditorAgent
from app.services.agents.model_backed.drift_agent import DriftAnalystAgent
from app.services.agents.model_backed.misuse_agent import MisuseDetectorAgent
from app.services.model_clients.registry import (
    get_governance_model_client,
    get_target_model_client,
)

_AGENTS: dict[str, GovernanceAgent] | None = None


def _build_agents() -> dict[str, GovernanceAgent]:
    target_client = get_target_model_client()
    governance_client = get_governance_model_client()
    agents: list[GovernanceAgent] = [
        BiasAuditorAgent(target_client, governance_client),
        MisuseDetectorAgent(target_client, governance_client),
        DriftAnalystAgent(target_client, governance_client),
        ComplianceAgent(),
        ExplainabilityAgent(),
        RiskAgent(),
    ]
    return {agent.name: agent for agent in agents}


def _get_agents() -> dict[str, GovernanceAgent]:
    global _AGENTS
    if _AGENTS is None:
        _AGENTS = _build_agents()
    return _AGENTS


def select_agents(agent_names: list[str] | None = None) -> list[GovernanceAgent]:
    agents = _get_agents()
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
