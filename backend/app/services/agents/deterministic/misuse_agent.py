from app.models.enums import Severity, SideEffectLevel
from app.schemas.governance import FindingCreate
from app.services.agents.base import AgentContext
from app.services.agents.helpers import finding


class MisuseAgent:
    name = "misuse_agent"

    def evaluate(self, context: AgentContext) -> list[FindingCreate]:
        findings: list[FindingCreate] = []
        for capability in context.capabilities:
            if capability.side_effect_level != SideEffectLevel.destructive:
                continue
            if capability.requires_human_review:
                continue
            findings.append(
                finding(
                    finding_type="misuse",
                    title=f"Destructive capability lacks human review: {capability.name}",
                    summary=(
                        "A destructive or irreversible capability is enabled without "
                        "a human review requirement."
                    ),
                    severity=Severity.critical,
                    dimension="Misuse and Abuse Prevention",
                    agent_name=self.name,
                    recommended_action=(
                        "Require human review or disable the destructive capability "
                        "until misuse controls are documented."
                    ),
                    confidence=0.9,
                )
            )
        return findings
