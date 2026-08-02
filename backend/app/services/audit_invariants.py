"""Mechanism invariants over a finished evaluation run.

These are properties that must hold REGARDLESS of what any model said. They
answer "did the pipeline do its job mechanically" — not "was the judgment
correct", which no assertion can settle. That split matters: the majority of
real defects in this pipeline have been mechanical (evidence not captured,
findings citing rows that don't exist, an agent going silent instead of
reporting a coverage gap), and every one of those is decidable from stored
state alone.

Each check returns ``Violation`` rows rather than raising, so a caller can
assert emptiness in a test, print a report over historical runs, or gate CI.

CONFOUNDS ARE HANDLED HERE ON PURPOSE. Naive versions of these checks produce
large numbers of false alarms against real data, which is worse than no check
at all — a noisy invariant gets muted and then it protects nothing. Measured
against 76 real runs while writing this module:

  - ``finding_counts_match`` looks violated 101/379 times until remediation
    executions are excluded. ``re_probe``/``re_plan`` deliberately create a
    SECOND ``AgentExecution`` row for the same (run, agent), so joining
    findings by agent name double-counts. Excluding them: 0/264.
  - ``planned_metrics_executed`` looks violated 378/2045 times until the scope
    is narrowed to completed runs. An in-flight or failed run legitimately has
    unexecuted metrics. Restricted to completed runs: 0/1284.
  - ``substantive_findings_cite_evidence`` must exempt ``coverage_gap`` (whose
    entire point is that nothing was evaluated) and ``risk_summary`` (which
    aggregates peer findings, not evidence records). Without the exemption it
    reports 93 findings that are correct by design.

So: four of these five invariants hold on current data and are here to stay
that way. ``substantive_findings_cite_evidence`` does NOT hold — see its
docstring.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session, select

from app.models.agent import AgentExecution
from app.models.enums import AgentExecutionStatus, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding

# Finding types that are legitimately evidence-free.
#
# coverage_gap: the finding IS "no metric was ever planned for this dimension".
#   Demanding evidence for it is a category error — there is none, and that
#   absence is the reported fact.
# risk_summary: RiskScorer aggregates the other agents' FINDINGS, not raw
#   evidence records, so it cites no evidence_ids by design.
_EVIDENCE_EXEMPT_FINDING_TYPES = frozenset({"coverage_gap", "risk_summary"})


@dataclass(frozen=True)
class Violation:
    """One concrete invariant breach, identified well enough to go fix it."""

    invariant: str
    run_id: UUID
    subject: str
    detail: str

    def __str__(self) -> str:  # pragma: no cover - diagnostic convenience
        return f"[{self.invariant}] run={self.run_id} {self.subject}: {self.detail}"


def _findings(session: Session, run_id: UUID) -> list[Finding]:
    return list(session.exec(select(Finding).where(Finding.run_id == run_id)).all())


def evidence_refs_resolve_within_run(session: Session, run_id: UUID) -> list[Violation]:
    """Every ``Finding.evidence_ids`` entry resolves to evidence in the SAME run.

    ``evidence_ids`` is a JSON ``list[str]`` with no foreign key, so nothing at
    the database level stops a finding from citing a deleted row, a typo, or —
    worse and quieter — an ``EvidenceRecord`` belonging to a DIFFERENT audit.
    Cross-run leakage would let one system's evidence justify a finding against
    another, which is exactly the kind of defect a hash chain cannot see because
    every individual row is intact.
    """
    violations: list[Violation] = []
    evidence_run: dict[str, UUID] = {
        str(row.id): row.run_id
        for row in session.exec(select(EvidenceRecord)).all()
    }
    for finding in _findings(session, run_id):
        for ev_id in finding.evidence_ids or []:
            owner = evidence_run.get(str(ev_id))
            if owner is None:
                violations.append(
                    Violation(
                        invariant="evidence_refs_resolve_within_run",
                        run_id=run_id,
                        subject=f"finding={finding.id} agent={finding.agent_name}",
                        detail=f"evidence_id {ev_id} resolves to no EvidenceRecord",
                    )
                )
            elif owner != run_id:
                violations.append(
                    Violation(
                        invariant="evidence_refs_resolve_within_run",
                        run_id=run_id,
                        subject=f"finding={finding.id} agent={finding.agent_name}",
                        detail=f"evidence_id {ev_id} belongs to run {owner} (cross-run leak)",
                    )
                )
    return violations


def substantive_findings_cite_evidence(session: Session, run_id: UUID) -> list[Violation]:
    """A substantive dimension finding must cite at least one evidence record.

    A finding that asserts something about the audited system without pointing
    at evidence is an unfalsifiable claim: a reviewer cannot check it, and the
    content-integrity digest has nothing to bind it to.

    This one is NOT currently clean, and the shape of the failure is the useful
    part. Across 991 real findings, the evidence-free rate by type is:

        drift           67%   (49/73)   <-- outlier
        bias            27%
        oversight       25%
        explainability   9%
        transparency     8%
        quality          1%

    ``quality`` at 1% establishes that citing evidence is achievable, which
    makes ``drift`` at 67% a defect in the drift path rather than an unfair
    demand. Treat this check as a ratchet: pin the current per-type rate and
    require it to fall, rather than asserting zero on day one.
    """
    violations: list[Violation] = []
    for finding in _findings(session, run_id):
        if finding.finding_type in _EVIDENCE_EXEMPT_FINDING_TYPES:
            continue
        if not (finding.evidence_ids or []):
            violations.append(
                Violation(
                    invariant="substantive_findings_cite_evidence",
                    run_id=run_id,
                    subject=f"finding={finding.id} type={finding.finding_type}",
                    detail=f"agent {finding.agent_name} produced a finding with no evidence_ids",
                )
            )
    return violations


def finding_counts_match(session: Session, run_id: UUID) -> list[Violation]:
    """``AgentExecution.finding_count`` equals the findings actually stored.

    The count is what the UI and ``result_summary`` report. If it drifts from
    the rows, the audit trail overstates or understates what an agent found and
    nothing else in the system notices.

    Remediation executions are skipped: ``re_probe``/``re_plan`` intentionally
    add a second row for an agent that already ran, so per-agent-name totals
    cannot be attributed to one row. Those runs need a different check, not a
    wrong one.
    """
    executions = list(
        session.exec(
            select(AgentExecution)
            .where(AgentExecution.run_id == run_id)
            .where(AgentExecution.status == AgentExecutionStatus.completed)
        ).all()
    )
    seen: dict[str, int] = {}
    for execution in executions:
        seen[execution.agent_name] = seen.get(execution.agent_name, 0) + 1

    actual: dict[str, int] = {}
    for finding in _findings(session, run_id):
        if finding.agent_name:
            actual[finding.agent_name] = actual.get(finding.agent_name, 0) + 1

    violations: list[Violation] = []
    for execution in executions:
        if (execution.metadata_json or {}).get("is_remediation"):
            continue
        if seen.get(execution.agent_name, 0) > 1:
            # Duplicate rows for one agent — attribution is ambiguous, so this
            # check abstains rather than guessing.
            continue
        stored = actual.get(execution.agent_name, 0)
        if execution.finding_count != stored:
            violations.append(
                Violation(
                    invariant="finding_counts_match",
                    run_id=run_id,
                    subject=f"agent={execution.agent_name}",
                    detail=f"finding_count={execution.finding_count} but {stored} findings stored",
                )
            )
    return violations


def planned_metrics_executed(session: Session, run_id: UUID) -> list[Violation]:
    """Every metric in ``selected_metrics`` produced a ``MetricResult``.

    A planned metric that silently never ran is the worst failure mode in the
    pipeline: the report reads as a completed assessment of that dimension when
    nothing was measured. A metric that ran and FAILED is fine — it has a row
    with a status. This catches the ones with no row at all.

    Only meaningful for a completed run; an in-flight or failed run has
    unexecuted metrics for legitimate reasons, so this abstains otherwise.
    """
    run = session.get(EvaluationRun, run_id)
    if run is None or run.status != RunStatus.completed:
        return []

    executed = {
        row.metric_id
        for row in session.exec(select(MetricResult).where(MetricResult.run_id == run_id)).all()
    }
    return [
        Violation(
            invariant="planned_metrics_executed",
            run_id=run_id,
            subject=f"metric={metric_id}",
            detail="present in selected_metrics but produced no MetricResult row",
        )
        for metric_id in (run.selected_metrics or [])
        if metric_id not in executed
    ]


def agent_findings_have_known_agent(session: Session, run_id: UUID) -> list[Violation]:
    """Every finding is attributable to an agent that actually executed.

    A finding whose ``agent_name`` has no ``AgentExecution`` row cannot be
    traced to a probe, a prompt, or a duration — it is unattributable in the
    audit record even though it renders fine in the UI.
    """
    ran = {
        execution.agent_name
        for execution in session.exec(
            select(AgentExecution).where(AgentExecution.run_id == run_id)
        ).all()
    }
    return [
        Violation(
            invariant="agent_findings_have_known_agent",
            run_id=run_id,
            subject=f"finding={finding.id}",
            detail=f"agent_name={finding.agent_name!r} has no AgentExecution for this run",
        )
        for finding in _findings(session, run_id)
        if finding.agent_name and finding.agent_name not in ran
    ]


# Ordered cheapest-signal-first so a report reads top-down.
ALL_CHECKS = (
    evidence_refs_resolve_within_run,
    finding_counts_match,
    planned_metrics_executed,
    agent_findings_have_known_agent,
    substantive_findings_cite_evidence,
)


def check_run(session: Session, run_id: UUID, *, exclude: frozenset[str] = frozenset()) -> list[Violation]:
    """Run every invariant against one run.

    ``exclude`` names invariants to skip by function name — use it to adopt the
    clean checks as hard assertions immediately while ``substantive_findings
    _cite_evidence`` is still being driven down.
    """
    violations: list[Violation] = []
    for check in ALL_CHECKS:
        if check.__name__ in exclude:
            continue
        violations.extend(check(session, run_id))
    return violations
