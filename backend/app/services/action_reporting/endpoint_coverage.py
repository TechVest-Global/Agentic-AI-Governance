"""Per-endpoint probe coverage for a run.

A system registered with several capability endpoints is several independent
audit surfaces. Until now a run reported one number — "probes sent" — across all
of them, so a run that fired 40 probes at ``/probe/text`` and none at
``/probe/image`` was indistinguishable from one that split them evenly. That is
the same ambiguity ``dimension_not_probed_finding`` closed for dimensions, one
axis over: an absence of findings for a surface is not evidence that the surface
is sound, it may just never have been asked.

This module answers, per endpoint: how many probes were sent, how many came back
as errors, how many were deliberately skipped as incompatible, and how many HTTP
requests that actually cost.

Two counting rules matter, because getting them wrong produces numbers nobody
can trust:

  * A **probe** is one logical question put to the target — one call-log row.
    A **request** is one HTTP round trip. The Gateway retries transient
    failures, so a throttled probe can be three requests. Counting rows as
    requests understates load; counting requests as probes triples the probe
    count. Both are reported, separately and labelled.

  * **Skipped is not failed.** A skip means the probe was never sent (its
    payload was incompatible with the capability); a failure means the target
    was asked and gave nothing back. Folding them together lets a dead endpoint
    read as a modality gap.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlmodel import Session, select

from app.models.agent import AgentExecution
from app.models.ai_system import AISystemCapability
from app.models.evaluation import EvaluationRun
from app.models.llm_call_log import LLMCallLog
from app.schemas.governance import EndpointCoverageRead, EndpointCoverageSummary


def _blank() -> dict[str, object]:
    return {
        "probes_sent": 0,
        "probes_failed": 0,
        "probes_skipped": 0,
        "requests_made": 0,
        "agents": set(),
        "error_types": {},
        "sample_error": None,
    }


def build_endpoint_coverage(session: Session, *, run_id: UUID) -> EndpointCoverageSummary:
    """Probe coverage grouped by audited endpoint, for one run."""
    run = session.get(EvaluationRun, run_id)
    if run is None:
        return EndpointCoverageSummary(run_id=run_id, endpoints=[])

    capabilities = list(
        session.exec(
            select(AISystemCapability).where(
                AISystemCapability.ai_system_id == run.ai_system_id
            )
        ).all()
    )
    capability_by_ref = {c.endpoint_ref: c for c in capabilities}

    stats: dict[str, dict[str, object]] = defaultdict(_blank)
    # Seed every REGISTERED endpoint, so one that received nothing appears as a
    # zero row rather than silently missing from the table. A surface nobody
    # probed is the single most important thing this view has to show.
    for capability in capabilities:
        stats[capability.endpoint_ref] = _blank()

    for call in session.exec(
        select(LLMCallLog)
        .where(LLMCallLog.run_id == run_id)
        .where(LLMCallLog.call_type == "target")
    ).all():
        # Calls logged before this column existed carry no endpoint. Bucket them
        # honestly as unattributed instead of silently crediting an endpoint.
        ref = call.endpoint_ref or ""
        entry = stats[ref]
        entry["requests_made"] = int(entry["requests_made"]) + max(1, call.attempts or 1)
        if call.status == "success":
            entry["probes_sent"] = int(entry["probes_sent"]) + 1
        else:
            entry["probes_failed"] = int(entry["probes_failed"]) + 1
            if call.error_type:
                counts = entry["error_types"]
                assert isinstance(counts, dict)
                counts[call.error_type] = counts.get(call.error_type, 0) + 1
            if entry["sample_error"] is None and call.error_detail:
                entry["sample_error"] = call.error_detail
        if call.agent_name:
            agents = entry["agents"]
            assert isinstance(agents, set)
            agents.add(call.agent_name)

    # Skips live on the agent execution rows, not the call log — by definition
    # they never became a call.
    for execution in session.exec(
        select(AgentExecution).where(AgentExecution.run_id == run_id)
    ).all():
        for skipped in (execution.metadata_json or {}).get("probes_skipped", []) or []:
            if not isinstance(skipped, dict):
                continue
            entry = stats[str(skipped.get("endpoint_ref") or "")]
            entry["probes_skipped"] = int(entry["probes_skipped"]) + 1

    endpoints = [
        EndpointCoverageRead(
            endpoint_ref=ref or None,
            capability_name=(
                capability_by_ref[ref].name if ref in capability_by_ref else None
            ),
            modality=(
                str(capability_by_ref[ref].modality) if ref in capability_by_ref else None
            ),
            registered=ref in capability_by_ref,
            probes_sent=int(entry["probes_sent"]),
            probes_failed=int(entry["probes_failed"]),
            probes_skipped=int(entry["probes_skipped"]),
            requests_made=int(entry["requests_made"]),
            agents=sorted(entry["agents"]),  # type: ignore[arg-type]
            error_types=dict(entry["error_types"]),  # type: ignore[arg-type]
            sample_error=entry["sample_error"],  # type: ignore[arg-type]
        )
        for ref, entry in stats.items()
    ]
    # Unprobed surfaces first — they are the finding, not the footnote. Then
    # busiest, then by name so the order is stable between runs.
    endpoints.sort(
        key=lambda e: (
            e.probes_sent + e.probes_failed > 0,
            -(e.probes_sent + e.probes_failed),
            e.endpoint_ref or "",
        )
    )
    return EndpointCoverageSummary(
        run_id=run_id,
        endpoints=endpoints,
        registered_endpoint_count=len(capabilities),
        unprobed_endpoint_count=sum(
            1 for e in endpoints if e.registered and e.probes_sent + e.probes_failed == 0
        ),
    )


def unprobed_registered_endpoints(session: Session, *, run_id: UUID) -> list[EndpointCoverageRead]:
    """Registered endpoints this run never actually reached."""
    return [
        e
        for e in build_endpoint_coverage(session, run_id=run_id).endpoints
        if e.registered and e.probes_sent + e.probes_failed == 0
    ]
