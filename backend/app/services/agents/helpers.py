from app.models.enums import MetricResultStatus, Severity
from app.models.evidence import MetricResult
from app.schemas.governance import FindingCreate


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


def split_attention_metrics(
    metrics: list[MetricResult],
) -> tuple[list[MetricResult], list[MetricResult]]:
    """Split into (genuinely_failed, never_evaluated) for what a fallback finding SAYS.

    ``metric_failed``/``metric_pending`` deliberately group failed+error and
    pending+skipped for deciding WHETHER an agent has anything to act on —
    that grouping is right there. It is wrong for deciding WHAT TO SAY: a
    ``skipped`` metric (no real evaluator integrated, e.g. a ``tool: langfuse``
    metric with no workflow_db integration) or an ``error`` metric (the target
    was unreachable) produced no evidence at all, and a fallback finding
    claiming it "did not pass" manufactures a confident compliance verdict out
    of an evaluation that never actually happened. Found on CM-022 to CM-025
    (presidio): a dead target connection was reported as "Security metric
    failed... may not adequately resist...", implying an observed PII leak
    from zero real probes.

    ``passed is False`` overrides status either way — an evaluator that
    explicitly recorded a failed pass/fail judgement made a real claim,
    whatever its status string says.
    """
    never_evaluated: list[MetricResult] = []
    genuinely_failed: list[MetricResult] = []
    for m in metrics:
        if m.passed is False:
            genuinely_failed.append(m)
        elif m.status in {
            MetricResultStatus.skipped, MetricResultStatus.pending, MetricResultStatus.error,
        }:
            never_evaluated.append(m)
        else:
            genuinely_failed.append(m)
    return genuinely_failed, never_evaluated


def metric_not_evaluated_finding(*, agent_name: str, metric: MetricResult) -> FindingCreate:
    """A single owned metric that never produced a real result this run.

    Companion to ``coverage_gap_finding``, but per-METRIC rather than
    per-dimension: some of an agent's owned metrics can genuinely fail while a
    sibling metric was simply never evaluated (no tool integration, target
    unreachable, still queued) in the very same call — an agent-wide
    coverage_gap finding would either bury the real failure or wrongly blanket
    it with this disclaimer too. Shares finding_type "coverage_gap" so
    existing report/UI handling and the audit_invariants evidence exemption
    both already cover it with no further changes.
    """
    status_clause = {
        MetricResultStatus.skipped: (
            "was skipped (no real evaluator/tool integration reached a verdict)"
        ),
        MetricResultStatus.error: (
            "could not be evaluated (the evaluator errored, e.g. the target was unreachable)"
        ),
        MetricResultStatus.pending: "has not completed evaluation yet",
    }.get(metric.status, "was not evaluated")
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{metric.metric_id} was not evaluated this run",
        summary=(
            f"Metric {metric.metric_id} ({metric.dimension}) {status_clause}. This is a gap "
            "in what this run measured, not a compliance finding — no conclusion should be "
            "drawn about this control from this run."
        ),
        severity=Severity.info,
        confidence=1.0,
        dimension=metric.dimension,
        evidence_ids=metric.evidence_ids or [],
        agent_name=agent_name,
        recommended_action=(
            "Confirm a real evaluator/tool integration exists for this metric and that the "
            "target was reachable, then re-run."
        ),
        payload={
            "generated_by": "metric_not_evaluated_gate",
            "metric_id": metric.metric_id,
            "metric_status": metric.status.value,
        },
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
    tool_calls: list[dict] | None = None,
    evidence_ids: list[str] | None = None,
    generated_by: str = "deterministic_agent",
) -> FindingCreate:
    """Build a Finding, always with real evidence_ids when any exist.

    Precedence: an explicit ``evidence_ids`` override wins (e.g. a governance-
    authored finding not tied to one single metric, but backed by several
    reviewed metrics' combined evidence); otherwise falls back to the single
    matched ``metric``'s own evidence_ids. Without this, any finding built
    without a matched metric — the common case on the governance-JSON path
    whenever the LLM's cited metric_id doesn't match anything — would report
    empty evidence_ids even when real evidence informed it, breaking the
    council's ability to trace a verdict back to a specific evidence record.

    ``generated_by`` records who authored the finding, and callers on the
    governance-JSON path MUST pass "governance_model". It used to be hardcoded
    to "deterministic_agent", so every LLM-authored finding claimed a
    deterministic provenance it did not have — a reviewer auditing a critical
    finding could not tell a rule-derived conclusion from a model-written one.
    The default stays "deterministic_agent" because the structural checks and
    the fallback paths, which are the majority of callers, really are
    deterministic.
    """
    resolved_evidence_ids = (
        list(evidence_ids)
        if evidence_ids is not None
        else (metric.evidence_ids if metric is not None else [])
    )
    return FindingCreate(
        finding_type=finding_type,
        title=title,
        summary=summary,
        severity=severity,
        confidence=confidence,
        dimension=dimension,
        evidence_ids=resolved_evidence_ids,
        agent_name=agent_name,
        recommended_action=recommended_action,
        payload={
            "generated_by": generated_by,
            "metric_id": metric.metric_id if metric is not None else None,
            "tool_calls": tool_calls or [],
        },
    )


def dimension_not_probed_finding(
    *, agent_name: str, dimension: str, reason: str
) -> FindingCreate:
    """An honest 'this dimension was never actively probed' record.

    Fires when an agent exits without probing because none of its owned metrics
    needed attention and the system's risk tier does not require verifying
    passes with live evidence (see ModelBackedAgent._verify_even_when_passing).

    Without this the agent returns nothing at all, so the run reads as "agent
    completed, 0 findings" — indistinguishable from "this dimension was probed
    and nothing was wrong". Those are very different governance claims and only
    the second is evidence of safety. Recording the distinction is what lets a
    report state its own coverage limits instead of implying clean results.

    Shares finding_type "coverage_gap" with coverage_gap_finding above so
    existing report and UI handling covers it; the payload's generated_by
    distinguishes the two causes.
    """
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{dimension.title()} was not actively probed in this run",
        summary=(
            f"No {dimension} probes were sent to the target: {reason}. This is a limit on "
            f"what this run verified, not a compliance finding — no conclusion should be "
            f"drawn about the system's {dimension} behaviour from this run."
        ),
        severity=Severity.info,
        confidence=1.0,
        dimension=dimension,
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            "Register the system at 'high' risk tier to force live verification of passing "
            f"metrics, or select {dimension} metrics for the run, if active {dimension} "
            "evidence is required."
        ),
        payload={"generated_by": "unprobed_dimension_gate", "reason": reason},
    )


def agent_failed_finding(
    *, agent_name: str, dimension: str, error: dict[str, str] | None
) -> FindingCreate:
    """An honest 'this dimension went unverified because the agent broke' record.

    A crashed or timed-out agent recorded its error on the execution row and
    produced no findings, so the governance report simply had nothing from that
    dimension. On a live run where the audited target was out of quota, six of
    seven agents failed this way and the whole report carried ONE finding — a
    reader could not distinguish "we checked and it was fine" from "we never got
    an answer". The verdict layer counts findings, so silence read as clean.

    Severity is `high`, not `info`: unlike the risk-tier gate (which is a
    deliberate, documented decision not to probe), this is an unplanned failure
    of the audit itself and someone has to act on it.
    """
    reason = "the agent did not complete"
    if error:
        detail = (error.get("message") or "").strip()
        reason = f"{error.get('error_type', 'error')}{f': {detail}' if detail else ''}"
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{dimension.title()} was not verified — the agent failed",
        summary=(
            f"The {agent_name} agent did not complete, so no {dimension} conclusion was "
            f"reached for this run. Cause: {reason}. This is an audit failure, not a "
            f"statement about the system: the absence of {dimension} findings here must "
            "not be read as an absence of risk."
        ),
        severity=Severity.high,
        confidence=1.0,
        dimension=dimension,
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            f"Re-run the {dimension} agent once the underlying failure is resolved "
            "(commonly the audited endpoint being unreachable, throttled, or out of "
            "quota), and treat this dimension as unassessed until it succeeds."
        ),
        payload={"generated_by": "agent_failure", "error": error or {}},
    )


def governance_unreadable_finding(
    *, agent_name: str, dimension: str, failures: list[dict]
) -> FindingCreate:
    """An honest 'the model reasoned but we could not read its answer' record.

    The agent probed the target, called its evidence tools, and put all of it to
    the governance model — and then could not parse what came back, even after a
    retry that quoted the specific defect. It therefore fell back to
    deterministic metric checks, which only ever report metrics that already
    failed. Any risk the model identified from the probe evidence itself is
    gone.

    That is not the same as the model finding nothing, and before this the two
    were indistinguishable in the report: the run completed, the fallback
    findings looked like ordinary output, and the loss existed only as a WARNING
    in the process log. The council counts findings, so a quietly-degraded
    dimension made the evidence look thinner rather than looking broken.

    Severity `medium`, not `high`: unlike an agent that failed outright, this
    dimension still has real deterministic coverage — the loss is the model's
    qualitative analysis on top of it.
    """
    tasks = sorted({str(f.get("task", "unknown")) for f in failures})
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{dimension.title()} analysis from the governance model was unreadable",
        summary=(
            f"The {agent_name} agent collected its evidence and the governance model "
            f"answered, but its response could not be parsed into findings after a retry "
            f"(task(s): {', '.join(tasks)}). This dimension therefore reports only "
            "deterministic metric checks, which surface already-failing metrics and "
            "nothing the model may have identified from the probe evidence itself. "
            "Treat the model's qualitative analysis for this dimension as missing, not "
            "as clean."
        ),
        severity=Severity.medium,
        confidence=1.0,
        dimension=dimension,
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            "Check the judge model's configuration (a model without a JSON/structured "
            "output mode is the usual cause) and re-run this agent. The recorded "
            "trace_id identifies the exact response in llm_call_logs."
        ),
        payload={"generated_by": "governance_parse_failure", "failures": failures},
    )


def unprobed_endpoints_finding(
    *, agent_name: str, endpoints: list[tuple[str, str | None]]
) -> FindingCreate:
    """An honest 'these registered surfaces were never reached' record.

    A system registered with several capability endpoints is several
    independent audit surfaces. The run-level probe total says nothing about the
    distribution, so a run that exercised one endpoint heavily and another not
    at all produced exactly the same headline as one that covered both — and a
    reader would reasonably assume the whole system was audited.

    The same reasoning as ``dimension_not_probed_finding``, one axis over:
    absence of findings for a surface nobody asked is not evidence the surface
    is sound. Shares the ``coverage_gap`` finding_type so existing report and UI
    handling applies; ``generated_by`` distinguishes the cause.
    """
    labels = [name or ref for ref, name in endpoints]
    listed = ", ".join(labels)
    return FindingCreate(
        finding_type="coverage_gap",
        title=(
            f"{len(endpoints)} registered endpoint(s) received no probes in this run"
        ),
        summary=(
            f"These capability endpoints were registered for this system but were never "
            f"probed: {listed}. This run therefore says nothing about their behaviour. It "
            "is a limit on coverage, not a compliance finding — but a report covering this "
            "system should not be read as covering these surfaces."
        ),
        severity=Severity.info,
        confidence=1.0,
        dimension="coverage",
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            "Re-run the audit scoped to these endpoints, or confirm they are out of scope "
            "and disable them on the registered system so they stop appearing as gaps."
        ),
        payload={
            "generated_by": "unprobed_endpoint_gate",
            "endpoints": [
                {"endpoint_ref": ref, "capability_name": name} for ref, name in endpoints
            ],
        },
    )


def coverage_gap_finding(*, agent_name: str, dimension: str, reason: str) -> FindingCreate:
    """An honest 'this agent had nothing appropriate to probe' record.

    Fires when every probe this agent would have sent got caught by the
    fail-closed modality gate (see ModelBackedAgent._execute_probe_plan) — e.g.
    a text-only probe against an image-generation capability. Distinct from a
    failed check: nothing was wrong with the target, this agent simply has no
    probe shaped for it yet. Severity is informational, never a compliance
    verdict on its own.
    """
    return FindingCreate(
        finding_type="coverage_gap",
        title=f"{dimension.title()} could not be probed for this capability",
        summary=(
            f"Every {dimension} probe for this run was skipped: {reason}. "
            "This is a gap in probe coverage, not a compliance finding — no "
            "conclusion should be drawn about this capability from this dimension."
        ),
        severity=Severity.info,
        confidence=1.0,
        dimension=dimension,
        evidence_ids=[],
        agent_name=agent_name,
        recommended_action=(
            "Register a probe appropriate to this capability's modality/schema, "
            "or extend probe coverage for its system category."
        ),
        payload={"generated_by": "probe_coverage_gate", "reason": reason},
    )
