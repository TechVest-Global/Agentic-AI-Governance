"""Backend-sourced options + frameworks for the AI application registration form.

Keeps the registration UI honest: dropdown values come from backend enums and
curated catalogs, and the framework list is exactly the set the platform
actually implements (the framework knowledge registry) — not a hardcoded
frontend list that can drift from what the engine supports.
"""

from __future__ import annotations

from app.configs.frameworks.registry import FRAMEWORK_KNOWLEDGE
from app.models.enums import (
    AISystemStatus,
    ApplicabilityType,
    CapabilityType,
    EndpointStatus,
    Modality,
    RiskTier,
    SideEffectLevel,
)
from app.schemas.governance import (
    OptionItem,
    RegistrationFrameworkOption,
    RegistrationOptions,
)

# Short, human-facing framework blurbs keyed by framework_id. Kept here (not on
# each FrameworkKnowledge config) so the knowledge records stay engine-focused.
_FRAMEWORK_DESCRIPTIONS: dict[str, str] = {
    "nist_ai_rmf": (
        "NIST AI Risk Management Framework — govern, map, measure, and manage "
        "AI risk across the lifecycle."
    ),
    "iso_42001": (
        "ISO/IEC 42001 — AI management system standard covering governance, "
        "risk, and continual improvement."
    ),
    "eu_ai_act": (
        "EU AI Act — risk-based regulation for AI systems, including high-risk "
        "obligations and transparency duties."
    ),
    "owasp_llm_top_10": (
        "OWASP LLM Top 10 — the top security risks for LLM applications "
        "(prompt injection, insecure output handling, data leakage, …)."
    ),
}

# Curated catalogs for fields the backend has no enum for. Values are the
# normalized strings persisted on the AI system; labels are display text.
_APPLICATION_TYPES: list[tuple[str, str]] = [
    ("rag_chatbot", "RAG Chatbot"),
    ("generative_ai", "Generative AI"),
    ("ai_agent", "AI Agent"),
    ("predictive_ml", "Predictive ML"),
    ("classification", "Classification"),
    ("nlp_pipeline", "NLP Pipeline"),
    ("computer_vision", "Computer Vision"),
    ("recommender", "Recommender"),
    ("scoring", "Scoring System"),
    ("other", "Other"),
]

_DOMAINS: list[tuple[str, str]] = [
    ("customer_operations", "Customer Operations"),
    ("knowledge_management", "Knowledge Management"),
    ("finance", "Finance"),
    ("healthcare", "Healthcare"),
    ("hr", "HR"),
    ("fraud", "Fraud"),
    ("legal", "Legal"),
    ("insurance", "Insurance"),
    ("retail", "Retail"),
    ("other", "Other"),
]

_HTTP_METHODS: list[str] = ["GET", "POST", "PUT", "PATCH", "DELETE"]

# ── Enhanced registration catalogs (Phase 1) ──────────────────────────────────
_SYSTEM_TYPES: list[tuple[str, str]] = [
    ("llm_application", "LLM Application"),
    ("rag_application", "RAG Application"),
    ("ai_agent", "AI Agent"),
    ("traditional_ml", "Traditional Machine Learning"),
    ("classification_system", "Classification System"),
    ("recommendation_system", "Recommendation System"),
    ("prediction_system", "Prediction System"),
    ("computer_vision_system", "Computer Vision System"),
    ("speech_audio_system", "Speech or Audio System"),
    ("multimodal_system", "Multimodal System"),
    ("other", "Other"),
]

_BUSINESS_DOMAINS: list[tuple[str, str]] = [
    ("customer_support", "Customer Support"),
    ("human_resources", "Human Resources"),
    ("finance", "Finance"),
    ("healthcare", "Healthcare"),
    ("education", "Education"),
    ("legal", "Legal"),
    ("cybersecurity", "Cybersecurity"),
    ("marketing", "Marketing"),
    ("sales", "Sales"),
    ("operations", "Operations"),
    ("insurance", "Insurance"),
    ("government", "Government"),
    ("general_enterprise", "General Enterprise"),
    ("other", "Other"),
]

_LIFECYCLE_STAGES: list[tuple[str, str]] = [
    ("idea", "Idea"),
    ("development", "Development"),
    ("testing", "Testing"),
    ("staging", "Staging"),
    ("production", "Production"),
    ("suspended", "Suspended"),
    ("retired", "Retired"),
]

_REGISTRATION_ENVIRONMENTS: list[tuple[str, str]] = [
    ("local", "Local"),
    ("development", "Development"),
    ("testing", "Testing"),
    ("staging", "Staging"),
    ("production", "Production"),
    ("sandbox", "Sandbox"),
]

_PRODUCTION_CRITICALITY: list[tuple[str, str]] = [
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("business_critical", "Business Critical"),
]

_INTERNAL_EXTERNAL_USE: list[tuple[str, str]] = [
    ("internal_employees", "Internal Employees"),
    ("external_customers", "External Customers"),
    ("partners", "Partners"),
    ("public", "Public"),
    ("mixed", "Mixed"),
]

_OUTPUT_USAGE: list[tuple[str, str]] = [
    ("informational_only", "Informational Only"),
    ("content_generation", "Content Generation"),
    ("recommendation", "Recommendation"),
    ("ranking", "Ranking"),
    ("classification", "Classification"),
    ("scoring", "Scoring"),
    ("decision_support", "Decision Support"),
    ("approval_or_rejection", "Approval or Rejection"),
    ("automated_decision", "Automated Decision"),
    ("external_system_action", "External System Action"),
]

_HUMAN_OVERSIGHT: list[tuple[str, str]] = [
    ("human_always_reviews", "Human Always Reviews"),
    ("human_reviews_high_risk", "Human Reviews High-Risk Cases"),
    ("human_can_override", "Human Can Override"),
    ("human_reviews_after_execution", "Human Reviews After Execution"),
    ("no_human_review", "No Human Review"),
    ("not_yet_determined", "Not Yet Determined"),
]

_OWNER_ROLES: list[tuple[str, str]] = [
    ("system_owner", "System Owner"),
    ("technical_owner", "Technical Owner"),
    ("business_owner", "Business Owner"),
    ("data_owner", "Data Owner"),
    ("security_contact", "Security Contact"),
    ("compliance_contact", "Compliance Contact"),
    ("escalation_contact", "Escalation Contact"),
]

_REGISTRATION_MODEL_PROVIDERS: list[tuple[str, str]] = [
    ("azure_foundry", "Azure AI Foundry"),
    ("azure_openai", "Azure OpenAI"),
    ("openai", "OpenAI"),
    ("anthropic", "Anthropic"),
    ("google", "Google"),
    ("aws_bedrock", "AWS Bedrock"),
    ("hugging_face", "Hugging Face"),
    ("self_hosted", "Local or Self-Hosted"),
    ("custom", "Custom"),
    ("other", "Other"),
]

_MODEL_TYPES: list[tuple[str, str]] = [
    ("llm", "Large Language Model"),
    ("embedding", "Embedding Model"),
    ("vision", "Vision Model"),
    ("speech", "Speech Model"),
    ("classifier", "Classifier"),
    ("regressor", "Regressor"),
    ("reranker", "Reranker"),
    ("multimodal", "Multimodal Model"),
    ("other", "Other"),
]

_INPUT_MODALITIES: list[tuple[str, str]] = [
    ("text", "Text"),
    ("image", "Image"),
    ("audio", "Audio"),
    ("video", "Video"),
    ("documents", "Documents"),
    ("structured_data", "Structured Data"),
    ("code", "Code"),
    ("sensor_data", "Sensor Data"),
    ("multimodal", "Multimodal"),
]

_OUTPUT_TYPES: list[tuple[str, str]] = [
    ("text", "Text"),
    ("image", "Image"),
    ("audio", "Audio"),
    ("classification", "Classification"),
    ("score", "Score"),
    ("recommendation", "Recommendation"),
    ("ranking", "Ranking"),
    ("structured_json", "Structured JSON"),
    ("tool_action", "Tool Action"),
    ("automated_decision", "Automated Decision"),
]

_CAPABILITY_TAGS: list[tuple[str, str]] = [
    ("text_generation", "Text Generation"),
    ("summarization", "Summarization"),
    ("question_answering", "Question Answering"),
    ("classification", "Classification"),
    ("prediction", "Prediction"),
    ("recommendation", "Recommendation"),
    ("ranking", "Ranking"),
    ("information_extraction", "Information Extraction"),
    ("translation", "Translation"),
    ("image_recognition", "Image Recognition"),
    ("image_generation", "Image Generation"),
    ("speech_recognition", "Speech Recognition"),
    ("speech_generation", "Speech Generation"),
    ("code_generation", "Code Generation"),
    ("tool_execution", "Tool Execution"),
    ("autonomous_planning", "Autonomous Planning"),
    ("decision_support", "Decision Support"),
]

_GATEWAY_TYPES: list[tuple[str, str]] = [
    ("direct_provider_api", "Direct Provider API"),
    ("azure_api_management", "Azure API Management"),
    ("litellm", "LiteLLM"),
    ("internal_ai_gateway", "Internal AI Gateway"),
    ("custom_proxy", "Custom Proxy"),
    ("no_gateway", "No Gateway"),
]

_AUTH_TYPES: list[tuple[str, str]] = [
    ("api_key", "API Key"),
    ("oauth2", "OAuth 2.0"),
    ("jwt", "JWT"),
    ("managed_identity", "Managed Identity"),
    ("mutual_tls", "Mutual TLS"),
    ("internal_service_auth", "Internal Service Authentication"),
    ("none", "None"),
]

_EXPOSURE_TYPES: list[tuple[str, str]] = [
    ("internal", "Internal"),
    ("external", "External"),
    ("partner", "Partner"),
    ("public", "Public"),
]

# ── Phase 2 catalogs ──────────────────────────────────────────────────────────
_DATA_SOURCE_TYPES: list[tuple[str, str]] = [
    ("user_input", "User Input"),
    ("database", "Database"),
    ("internal_api", "Internal API"),
    ("external_api", "External API"),
    ("uploaded_documents", "Uploaded Documents"),
    ("knowledge_base", "Knowledge Base"),
    ("vector_database", "Vector Database"),
    ("third_party_dataset", "Third-Party Dataset"),
    ("file_storage", "File Storage"),
    ("data_warehouse", "Data Warehouse"),
    ("other", "Other"),
]

_DATA_CLASSIFICATIONS: list[tuple[str, str]] = [
    ("public", "Public"),
    ("internal", "Internal"),
    ("confidential", "Confidential"),
    ("restricted", "Restricted"),
    ("highly_restricted", "Highly Restricted"),
]

_DATA_USAGE_PURPOSES: list[tuple[str, str]] = [
    ("training", "Training"),
    ("fine_tuning", "Fine-Tuning"),
    ("inference", "Inference"),
    ("retrieval", "Retrieval"),
    ("evaluation", "Evaluation"),
    ("logging", "Logging"),
    ("analytics", "Analytics"),
    ("other", "Other"),
]

# Security controls the developer reports an implementation status for.
_SECURITY_CONTROLS: list[tuple[str, str]] = [
    ("authentication", "Authentication"),
    ("rbac", "Role-Based Access Control"),
    ("secrets_management", "Secrets Management"),
    ("input_validation", "Input Validation"),
    ("output_validation", "Output Validation"),
    ("rate_limiting", "Rate Limiting"),
    ("content_filtering", "Content Filtering"),
    ("pii_redaction", "PII Redaction"),
    ("prompt_injection_protection", "Prompt Injection Protection"),
    ("logging", "Logging"),
    ("encryption_in_transit", "Encryption in Transit"),
    ("encryption_at_rest", "Encryption at Rest"),
    ("network_restrictions", "Network Restrictions"),
    ("tool_permission_controls", "Tool Permission Controls"),
]

_SECURITY_STATUSES: list[tuple[str, str]] = [
    ("implemented", "Implemented"),
    ("planned", "Planned"),
    ("not_implemented", "Not Implemented"),
    ("not_applicable", "Not Applicable"),
    ("unknown", "Unknown"),
]

_DEPENDENCY_TYPES: list[tuple[str, str]] = [
    ("model_provider", "Model Provider"),
    ("infrastructure", "Infrastructure"),
    ("vector_store", "Vector Store"),
    ("data_provider", "Data Provider"),
    ("gateway", "Gateway"),
    ("observability", "Observability"),
    ("external_service", "External Service"),
    ("other", "Other"),
]

_DOCUMENT_TYPES: list[tuple[str, str]] = [
    ("architecture_diagram", "Architecture Diagram"),
    ("system_design_document", "System Design Document"),
    ("api_specification", "API Specification"),
    ("model_card", "Model Card"),
    ("data_flow_diagram", "Data Flow Diagram"),
    ("data_sheet", "Data Sheet"),
    ("security_design", "Security Design"),
    ("threat_model", "Threat Model"),
    ("privacy_assessment", "Privacy Assessment"),
    ("risk_assessment", "Risk Assessment"),
    ("testing_plan", "Testing Plan"),
    ("vendor_documentation", "Vendor Documentation"),
    ("other", "Other"),
]

_CONFIDENTIALITY_LEVELS: list[tuple[str, str]] = [
    ("public", "Public"),
    ("internal", "Internal"),
    ("confidential", "Confidential"),
    ("restricted", "Restricted"),
]


def _label(value: str) -> str:
    """Turn an enum value like ``human_review`` into ``Human Review``."""
    return value.replace("_", " ").title()


def _enum_options(enum_cls: type) -> list[OptionItem]:
    return [OptionItem(value=member.value, label=_label(member.value)) for member in enum_cls]


def _pairs(pairs: list[tuple[str, str]]) -> list[OptionItem]:
    return [OptionItem(value=value, label=label) for value, label in pairs]


def list_registration_frameworks() -> list[RegistrationFrameworkOption]:
    """The applicable governance frameworks the platform implements."""
    options: list[RegistrationFrameworkOption] = []
    for framework_id in sorted(FRAMEWORK_KNOWLEDGE):
        knowledge = FRAMEWORK_KNOWLEDGE[framework_id]
        options.append(
            RegistrationFrameworkOption(
                framework_id=knowledge.framework_id,
                framework_name=knowledge.framework_name,
                framework_version=knowledge.framework_version,
                description=_FRAMEWORK_DESCRIPTIONS.get(framework_id, ""),
                rubric_count=len(knowledge.rubric),
                probe_count=len(knowledge.probe_templates),
                coverage_count=len(knowledge.coverage_requirements),
            )
        )
    return options


def get_registration_options() -> RegistrationOptions:
    """All dropdown option lists for the registration form."""
    return RegistrationOptions(
        # Original fields (kept for backward compatibility)
        risk_tiers=_enum_options(RiskTier),
        modalities=_enum_options(Modality),
        deployment_environments=_pairs(_REGISTRATION_ENVIRONMENTS),
        application_types=_pairs(_APPLICATION_TYPES),
        domains=_pairs(_DOMAINS),
        model_providers=_pairs(_REGISTRATION_MODEL_PROVIDERS),
        capability_types=_enum_options(CapabilityType),
        side_effect_levels=_enum_options(SideEffectLevel),
        http_methods=[OptionItem(value=m, label=m) for m in _HTTP_METHODS],
        statuses=_enum_options(AISystemStatus),
        # Enhanced registration catalogs (Phase 1)
        system_types=_pairs(_SYSTEM_TYPES),
        business_domains=_pairs(_BUSINESS_DOMAINS),
        lifecycle_stages=_pairs(_LIFECYCLE_STAGES),
        production_criticalities=_pairs(_PRODUCTION_CRITICALITY),
        internal_external_use=_pairs(_INTERNAL_EXTERNAL_USE),
        output_usage=_pairs(_OUTPUT_USAGE),
        human_oversight=_pairs(_HUMAN_OVERSIGHT),
        owner_roles=_pairs(_OWNER_ROLES),
        model_types=_pairs(_MODEL_TYPES),
        input_modalities=_pairs(_INPUT_MODALITIES),
        output_types=_pairs(_OUTPUT_TYPES),
        capability_tags=_pairs(_CAPABILITY_TAGS),
        gateway_types=_pairs(_GATEWAY_TYPES),
        authentication_types=_pairs(_AUTH_TYPES),
        exposure_types=_pairs(_EXPOSURE_TYPES),
        endpoint_statuses=_enum_options(EndpointStatus),
        applicability_types=_enum_options(ApplicabilityType),
        # Phase 2 catalogs
        data_source_types=_pairs(_DATA_SOURCE_TYPES),
        data_classifications=_pairs(_DATA_CLASSIFICATIONS),
        data_usage_purposes=_pairs(_DATA_USAGE_PURPOSES),
        security_controls=_pairs(_SECURITY_CONTROLS),
        security_statuses=_pairs(_SECURITY_STATUSES),
        dependency_types=_pairs(_DEPENDENCY_TYPES),
        document_types=_pairs(_DOCUMENT_TYPES),
        confidentiality_levels=_pairs(_CONFIDENTIALITY_LEVELS),
    )


# Catalogs whose values the registration service validates payload strings against.
# Only fields that map to a controlled vocabulary are listed here; free-text and
# already-enum fields are validated elsewhere.
_VALIDATED_CATALOGS: dict[str, list[tuple[str, str]]] = {
    "system_type": _SYSTEM_TYPES,
    "business_domain": _BUSINESS_DOMAINS,
    "lifecycle_stage": _LIFECYCLE_STAGES,
    "deployment_environment": _REGISTRATION_ENVIRONMENTS,
    "production_criticality": _PRODUCTION_CRITICALITY,
    "internal_external_use": _INTERNAL_EXTERNAL_USE,
    "output_usage": _OUTPUT_USAGE,
    "human_oversight": _HUMAN_OVERSIGHT,
    "owner_role": _OWNER_ROLES,
    "model_provider": _REGISTRATION_MODEL_PROVIDERS,
    "model_type": _MODEL_TYPES,
    "input_modality": _INPUT_MODALITIES,
    "output_type": _OUTPUT_TYPES,
    "capability_tag": _CAPABILITY_TAGS,
    "gateway_type": _GATEWAY_TYPES,
    "authentication_type": _AUTH_TYPES,
    "exposure_type": _EXPOSURE_TYPES,
    "data_source_type": _DATA_SOURCE_TYPES,
    "data_classification": _DATA_CLASSIFICATIONS,
    "data_usage_purpose": _DATA_USAGE_PURPOSES,
    "security_control": _SECURITY_CONTROLS,
    "security_status": _SECURITY_STATUSES,
    "dependency_type": _DEPENDENCY_TYPES,
    "document_type": _DOCUMENT_TYPES,
    "confidentiality_level": _CONFIDENTIALITY_LEVELS,
}


def catalog_values(name: str) -> set[str]:
    """Return the allowed machine values for a validated catalog (empty if unknown)."""
    return {value for value, _ in _VALIDATED_CATALOGS.get(name, [])}
