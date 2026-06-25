from app.models.enums import RiskTier, Severity
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding


class RiskAgent:
    execution_mode = "deterministic"
    name = "risk_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        if context.ai_system.risk_tier != RiskTier.high:
            return []
        has_human_review_control = any(
            capability.requires_human_review for capability in context.capabilities
        )
        if has_human_review_control:
            return []
        return [
            finding(
                finding_type="risk",
                title="High-risk system lacks human review capability controls",
                summary=(
                    "The registered system is high risk, but none of its capabilities "
                    "require human review."
                ),
                severity=Severity.high,
                dimension="Risk Management",
                agent_name=self.name,
                recommended_action=(
                    "Enable human review for high-impact capabilities or document "
                    "why automated handling is acceptable."
                ),
                confidence=0.88,
            )
        ]
