from app.core.exceptions import ApplicationError
from app.services.agents.base import GovernanceAgent
from app.services.agents.deterministic.bias_agent import BiasAgent
from app.services.agents.deterministic.compliance_agent import ComplianceAgent
from app.services.agents.deterministic.drift_agent import DriftAgent
from app.services.agents.deterministic.explainability_agent import ExplainabilityAgent
from app.services.agents.deterministic.misuse_agent import MisuseAgent
from app.services.agents.deterministic.risk_agent import RiskAgent

# These deterministic agents keep the backend pipeline runnable while model-backed
# agents are designed and integrated behind the same GovernanceAgent contract.
AGENTS: dict[str, GovernanceAgent] = {
    agent.name: agent
    for agent in (
        BiasAgent(),
        ComplianceAgent(),
        ExplainabilityAgent(),
        RiskAgent(),
        MisuseAgent(),
        DriftAgent(),
    )
}


def select_agents(agent_names: list[str] | None = None) -> list[GovernanceAgent]:
    if not agent_names:
        return list(AGENTS.values())

    unknown_agents = [name for name in agent_names if name not in AGENTS]
    if unknown_agents:
        raise ApplicationError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Unknown governance agent requested.",
            details={"unknown_agents": unknown_agents},
        )
    return [AGENTS[name] for name in agent_names]
