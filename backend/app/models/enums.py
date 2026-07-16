from enum import StrEnum


class RiskTier(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class AISystemStatus(StrEnum):
    registered = "registered"
    active = "active"
    inactive = "inactive"
    archived = "archived"


class CapabilityType(StrEnum):
    inference = "inference"
    retrieval = "retrieval"
    generation = "generation"
    action = "action"
    integration = "integration"
    other = "other"


class Modality(StrEnum):
    text = "text"
    audio = "audio"
    video = "video"
    image = "image"


class SideEffectLevel(StrEnum):
    none = "none"
    read = "read"
    write = "write"
    destructive = "destructive"


class ApplicabilityType(StrEnum):
    """How a governance framework applies to a registered AI system."""

    mandatory = "mandatory"
    voluntary = "voluntary"
    unsure = "unsure"


class EndpointStatus(StrEnum):
    """Operational status of a registered target API endpoint."""

    draft = "draft"
    active = "active"
    disabled = "disabled"
    deprecated = "deprecated"


class RunStatus(StrEnum):
    created = "created"
    context_assembly = "context_assembly"
    planned = "planned"
    metrics_running = "metrics_running"
    agents_running = "agents_running"
    council_running = "council_running"
    report_ready = "report_ready"
    completed = "completed"
    failed = "failed"
    degraded = "degraded"
    cancelled = "cancelled"


class RunPhase(StrEnum):
    created = "created"
    context_assembly = "context_assembly"
    adaptive_orchestrator = "adaptive_orchestrator"
    metric_execution = "metric_execution"
    specialist_agents = "specialist_agents"
    deliberation_council = "deliberation_council"
    action_reporting = "action_reporting"
    completed = "completed"


class Severity(StrEnum):
    info = "info"
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class FindingStatus(StrEnum):
    open = "open"
    accepted = "accepted"
    mitigated = "mitigated"
    dismissed = "dismissed"


class MetricResultStatus(StrEnum):
    pending = "pending"
    passed = "passed"
    failed = "failed"
    error = "error"
    skipped = "skipped"


class AgentExecutionStatus(StrEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ActionTier(StrEnum):
    autonomous = "autonomous"
    supervised = "supervised"
    human_review = "human_review"


class LedgerActorType(StrEnum):
    system = "system"
    user = "user"
    agent = "agent"
    tool = "tool"


class AssessmentRequestStatus(StrEnum):
    pending = "pending"
    in_progress = "in_progress"
    resolved = "resolved"
    dismissed = "dismissed"


class DriftSource(StrEnum):
    model = "model"          # model weights / version changed
    context = "context"      # prompt template or RAG context changed
    data = "data"            # input distribution shifted
    environment = "environment"  # infra / config changed
    unknown = "unknown"
