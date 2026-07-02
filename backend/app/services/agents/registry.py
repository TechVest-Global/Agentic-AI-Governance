from app.core.exceptions import ApplicationError
from app.services.agents.base import GovernanceAgent
from app.services.agents.model_backed.bias_agent import BiasAuditorAgent
from app.services.agents.model_backed.compliance_mapper import ComplianceMapperAgent
from app.services.agents.model_backed.drift_agent import DriftAnalystAgent
from app.services.agents.model_backed.explainability_agent import ExplainabilityAgent
from app.services.agents.model_backed.misuse_agent import MisuseDetectorAgent
from app.services.agents.model_backed.quality_agent import QualityEvaluatorAgent
from app.services.agents.model_backed.risk_scorer import RiskScorerAgent
from app.services.model_clients.base import TargetModelClient
from app.services.model_clients.registry import (
    get_governance_model_client,
    get_target_model_client,
)


def _build_agents(
    target_client: TargetModelClient | None = None,
) -> dict[str, GovernanceAgent]:
    target_client = target_client or get_target_model_client()
    governance_client = get_governance_model_client()
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
    target_client: TargetModelClient | None = None,
) -> list[GovernanceAgent]:
    agents = _build_agents(target_client)
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
