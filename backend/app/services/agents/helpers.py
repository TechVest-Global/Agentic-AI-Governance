from app.models.enums import MetricResultStatus, Severity
from app.models.evidence import MetricResult
from app.schemas.governance import FindingCreate
from app.services.model_clients.base import TargetAuth


def metric_matches(metric: MetricResult, keywords: tuple[str, ...]) -> bool:
    haystack = f"{metric.metric_id} {metric.dimension} {metric.tool_name}".lower()
    return any(keyword in haystack for keyword in keywords)


def metric_failed(metric: MetricResult) -> bool:
    return (
        metric.status in {MetricResultStatus.failed, MetricResultStatus.error}
        or metric.passed is False
    )


def metric_pending(metric: MetricResult) -> bool:
    return metric.status in {MetricResultStatus.pending, MetricResultStatus.skipped}


def has_live_target(context) -> bool:
    """True when the run resolved a real, callable HTTP endpoint to probe.

    When present, specialist agents baseline-probe the live target on every run
    (not only when metrics fail) so the audit actually exercises the application.
    The resolved endpoint covers both registered target endpoints and the legacy
    per-system ``target_endpoint_ref`` (see resolve_target_endpoint).
    """
    return getattr(context, "target_endpoint", None) is not None


def probe_endpoint_ref(context) -> str:
    """The URL/reference agents pass when probing the resolved target."""
    endpoint = getattr(context, "target_endpoint", None)
    if endpoint is not None:
        return endpoint.url
    # No live target resolved — fall back to a stable label for evidence.
    return context.ai_system.name or "default"


def probe_auth(context) -> TargetAuth | None:
    """Per-endpoint auth for the resolved target.

    Returns None for the legacy endpoint source so the target client keeps using
    its environment credentials and the historical global-override precedence.
    """
    endpoint = getattr(context, "target_endpoint", None)
    if endpoint is None or endpoint.source != "endpoint":
        return None
    return TargetAuth(
        api_key=endpoint.api_key,
        auth_header=endpoint.auth_header,
        auth_scheme=endpoint.auth_scheme,
        request_field=endpoint.request_field,
        response_field=endpoint.response_field,
        timeout=float(endpoint.timeout_seconds),
    )


def finding(
    *,
    finding_type: str,
    title: str,
    summary: str,
    severity: Severity,
    dimension: str,
    agent_name: str,
    recommended_action: str,
    metric: MetricResult | None = None,
    confidence: float = 0.8,
) -> FindingCreate:
    return FindingCreate(
        finding_type=finding_type,
        title=title,
        summary=summary,
        severity=severity,
        confidence=confidence,
        dimension=dimension,
        evidence_ids=metric.evidence_ids if metric is not None else [],
        agent_name=agent_name,
        recommended_action=recommended_action,
        payload={
            "generated_by": "deterministic_agent",
            "metric_id": metric.metric_id if metric is not None else None,
        },
    )
