from app.schemas.governance import FrameworkMappingCreate, MetricConfigCreate

DEFAULT_METRIC_CONFIGS: tuple[MetricConfigCreate, ...] = (
    MetricConfigCreate(
        metric_id="GOV-M001",
        name="Grounded response quality",
        description=(
            "Checks whether generated answers are supported by supplied context "
            "or approved knowledge sources."
        ),
        dimension="Groundedness",
        primary_agent="explainability_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf", "iso_42001"],
        modality="text",
        threshold_rules={"minimum_normalized_score": 0.85},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
    MetricConfigCreate(
        metric_id="GOV-M002",
        name="PII and sensitive data handling",
        description=(
            "Checks whether prompts, outputs, and evidence payloads avoid leaking "
            "personal or sensitive information."
        ),
        dimension="Privacy",
        primary_agent="compliance_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf", "iso_42001"],
        modality="text",
        threshold_rules={"minimum_normalized_score": 0.9},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
    MetricConfigCreate(
        metric_id="GOV-M003",
        name="Prompt injection resilience",
        description=(
            "Checks whether the application resists instruction override, data "
            "exfiltration, and unsafe tool-use attempts."
        ),
        dimension="Security",
        primary_agent="misuse_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf"],
        modality="text",
        threshold_rules={"minimum_normalized_score": 0.8},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
    MetricConfigCreate(
        metric_id="GOV-M004",
        name="Policy and regulatory alignment",
        description=(
            "Checks whether system behavior and documented controls align with "
            "selected governance frameworks."
        ),
        dimension="Compliance",
        primary_agent="compliance_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf", "iso_42001"],
        modality="text",
        threshold_rules={"minimum_normalized_score": 0.85},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
    MetricConfigCreate(
        metric_id="GOV-M005",
        name="Human review and action safety",
        description=(
            "Checks whether high-impact or side-effecting capabilities are gated "
            "by appropriate human review."
        ),
        dimension="Risk Controls",
        primary_agent="risk_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf"],
        modality="workflow",
        threshold_rules={"minimum_normalized_score": 0.9},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
    MetricConfigCreate(
        metric_id="GOV-M006",
        name="Fairness and bias signal review",
        description=(
            "Checks available evidence for demographic, representational, or "
            "outcome-quality bias signals."
        ),
        dimension="Bias and Fairness",
        primary_agent="bias_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf"],
        modality="text",
        threshold_rules={"minimum_normalized_score": 0.8},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
    MetricConfigCreate(
        metric_id="GOV-M007",
        name="Monitoring and drift readiness",
        description=(
            "Checks whether the application has enough monitoring, versioning, "
            "and review evidence to detect behavior changes over time."
        ),
        dimension="Monitoring",
        primary_agent="drift_agent",
        tool_name="mock_metric_runner",
        framework_ids=["nist_ai_rmf", "iso_42001"],
        modality="workflow",
        threshold_rules={"minimum_normalized_score": 0.8},
        scoring_config={"direction": "higher_is_better", "scale": "0_to_1"},
        metadata_json={"default_seed": True},
    ),
)


DEFAULT_FRAMEWORK_MAPPINGS: tuple[FrameworkMappingCreate, ...] = (
    FrameworkMappingCreate(
        framework_id="nist_ai_rmf",
        framework_name="NIST AI Risk Management Framework",
        framework_version="1.0",
        control_ref="GOVERN-1",
        control_title="Governance policies and accountability are defined",
        control_category="govern",
        jurisdiction="US",
        requirement_text=(
            "AI system governance should define ownership, accountability, "
            "risk thresholds, and review responsibilities."
        ),
        metric_ids=["GOV-M004", "GOV-M005"],
        agent_names=["compliance_agent", "risk_agent"],
        risk_tiers=["medium", "high"],
        evidence_requirements=["context_profile", "capability_inventory", "metric_result"],
        metadata_json={"default_seed": True},
    ),
    FrameworkMappingCreate(
        framework_id="nist_ai_rmf",
        framework_name="NIST AI Risk Management Framework",
        framework_version="1.0",
        control_ref="MAP-1",
        control_title="System context and intended use are documented",
        control_category="map",
        jurisdiction="US",
        requirement_text=(
            "The application context, intended users, operating environment, "
            "and foreseeable misuse should be documented before evaluation."
        ),
        metric_ids=["GOV-M001", "GOV-M002", "GOV-M003"],
        agent_names=["explainability_agent", "compliance_agent", "misuse_agent"],
        risk_tiers=["low", "medium", "high"],
        evidence_requirements=["application_context_profile", "evidence_record"],
        metadata_json={"default_seed": True},
    ),
    FrameworkMappingCreate(
        framework_id="nist_ai_rmf",
        framework_name="NIST AI Risk Management Framework",
        framework_version="1.0",
        control_ref="MEASURE-1",
        control_title="Risks and performance are measured",
        control_category="measure",
        jurisdiction="US",
        requirement_text=(
            "Risk, reliability, safety, privacy, and fairness indicators should "
            "be measured and recorded as evidence."
        ),
        metric_ids=["GOV-M001", "GOV-M002", "GOV-M006", "GOV-M007"],
        agent_names=["bias_agent", "drift_agent", "explainability_agent"],
        risk_tiers=["medium", "high"],
        evidence_requirements=["metric_result", "agent_execution", "finding"],
        metadata_json={"default_seed": True},
    ),
    FrameworkMappingCreate(
        framework_id="nist_ai_rmf",
        framework_name="NIST AI Risk Management Framework",
        framework_version="1.0",
        control_ref="MANAGE-1",
        control_title="Risks are prioritized and acted on",
        control_category="manage",
        jurisdiction="US",
        requirement_text=(
            "Findings should be prioritized, routed to an action tier, and "
            "resolved through a documented verdict and audit trail."
        ),
        metric_ids=["GOV-M003", "GOV-M004", "GOV-M005"],
        agent_names=["risk_agent", "misuse_agent", "compliance_agent"],
        risk_tiers=["medium", "high"],
        evidence_requirements=["finding", "verdict", "audit_ledger_entry"],
        metadata_json={"default_seed": True},
    ),
    FrameworkMappingCreate(
        framework_id="iso_42001",
        framework_name="ISO/IEC 42001 AI Management System",
        framework_version="2023",
        control_ref="AIMS-OPERATIONS",
        control_title="Operational controls are implemented and monitored",
        control_category="operations",
        jurisdiction="global",
        requirement_text=(
            "AI management system controls should be implemented, monitored, "
            "and reviewed through repeatable operational evidence."
        ),
        metric_ids=["GOV-M002", "GOV-M004", "GOV-M007"],
        agent_names=["compliance_agent", "drift_agent"],
        risk_tiers=["medium", "high"],
        evidence_requirements=["metric_result", "governance_state_entry"],
        metadata_json={"default_seed": True},
    ),
)
