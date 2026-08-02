"""Tests for the mechanism invariants themselves.

An invariant that cannot fail is decoration, so every check here is exercised
BOTH ways: it must fire on a seeded breach and stay silent on a clean run. The
abstention cases matter just as much — a check that reports remediation rows or
in-flight runs as violations gets muted in practice, and a muted check protects
nothing.
"""

from collections.abc import Generator
from uuid import uuid4

import pytest
from app.models.ai_system import AISystem
from app.models.agent import AgentExecution
from app.models.enums import AgentExecutionStatus, RunStatus
from app.models.evaluation import EvaluationRun
from app.models.evidence import EvidenceRecord, MetricResult
from app.models.finding import Finding
from app.services import audit_invariants as inv
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    SQLModel.metadata.drop_all(engine)


def _run(session: Session, *, status: RunStatus = RunStatus.completed, metrics=None) -> EvaluationRun:
    system = AISystem(name=f"sys-{uuid4().hex[:8]}", owner="owner", system_type="llm_app")
    session.add(system)
    session.commit()
    run = EvaluationRun(
        ai_system_id=system.id,
        status=status,
        selected_metrics=list(metrics or []),
    )
    session.add(run)
    session.commit()
    return run


def _evidence(session: Session, run: EvaluationRun) -> EvidenceRecord:
    record = EvidenceRecord(run_id=run.id, source_type="probe", source_name="probe-1")
    session.add(record)
    session.commit()
    return record


def _finding(session: Session, run: EvaluationRun, **kw) -> Finding:
    finding = Finding(
        run_id=run.id,
        finding_type=kw.pop("finding_type", "drift"),
        title="t",
        summary="s",
        dimension=kw.pop("dimension", "robustness"),
        **kw,
    )
    session.add(finding)
    session.commit()
    return finding


# ── evidence_refs_resolve_within_run ─────────────────────────────────────────


def test_clean_run_has_no_evidence_reference_violations(session: Session) -> None:
    run = _run(session)
    record = _evidence(session, run)
    _finding(session, run, evidence_ids=[str(record.id)], agent_name="drift_agent")

    assert inv.evidence_refs_resolve_within_run(session, run.id) == []


def test_dangling_evidence_reference_is_flagged(session: Session) -> None:
    run = _run(session)
    _finding(session, run, evidence_ids=[str(uuid4())], agent_name="drift_agent")

    violations = inv.evidence_refs_resolve_within_run(session, run.id)

    assert len(violations) == 1
    assert "resolves to no EvidenceRecord" in violations[0].detail


def test_evidence_borrowed_from_another_run_is_flagged(session: Session) -> None:
    """The quiet one: every row is intact, so a hash chain sees nothing wrong."""
    victim = _run(session)
    other = _run(session)
    foreign = _evidence(session, other)
    _finding(session, victim, evidence_ids=[str(foreign.id)], agent_name="bias_agent")

    violations = inv.evidence_refs_resolve_within_run(session, victim.id)

    assert len(violations) == 1
    assert "cross-run leak" in violations[0].detail


# ── substantive_findings_cite_evidence ───────────────────────────────────────


def test_evidence_free_substantive_finding_is_flagged(session: Session) -> None:
    run = _run(session)
    _finding(session, run, finding_type="drift", evidence_ids=[], agent_name="drift_agent")

    violations = inv.substantive_findings_cite_evidence(session, run.id)

    assert len(violations) == 1
    assert "no evidence_ids" in violations[0].detail


@pytest.mark.parametrize("exempt_type", ["coverage_gap", "risk_summary"])
def test_exempt_finding_types_may_have_no_evidence(session: Session, exempt_type: str) -> None:
    """coverage_gap reports that nothing was evaluated; risk_summary aggregates
    peer findings. Demanding evidence of either is a category error."""
    run = _run(session)
    _finding(session, run, finding_type=exempt_type, evidence_ids=[], agent_name="risk_scorer")

    assert inv.substantive_findings_cite_evidence(session, run.id) == []


# ── finding_counts_match ─────────────────────────────────────────────────────


def test_finding_count_mismatch_is_flagged(session: Session) -> None:
    run = _run(session)
    session.add(
        AgentExecution(
            run_id=run.id,
            agent_name="bias_agent",
            status=AgentExecutionStatus.completed,
            finding_count=3,
        )
    )
    session.commit()
    _finding(session, run, agent_name="bias_agent", dimension="fairness")

    violations = inv.finding_counts_match(session, run.id)

    assert len(violations) == 1
    assert "finding_count=3 but 1 findings stored" in violations[0].detail


def test_accurate_finding_count_passes(session: Session) -> None:
    run = _run(session)
    session.add(
        AgentExecution(
            run_id=run.id,
            agent_name="bias_agent",
            status=AgentExecutionStatus.completed,
            finding_count=1,
        )
    )
    session.commit()
    _finding(session, run, agent_name="bias_agent", dimension="fairness")

    assert inv.finding_counts_match(session, run.id) == []


def test_remediation_execution_is_not_counted_against_the_agent(session: Session) -> None:
    """re_probe adds a SECOND row for an agent that already ran, so per-agent
    totals cannot be attributed to one row. The check must abstain, not guess."""
    run = _run(session)
    session.add_all(
        [
            AgentExecution(
                run_id=run.id,
                agent_name="misuse_agent",
                status=AgentExecutionStatus.completed,
                finding_count=1,
            ),
            AgentExecution(
                run_id=run.id,
                agent_name="misuse_agent",
                status=AgentExecutionStatus.completed,
                finding_count=1,
                metadata_json={"is_remediation": True},
            ),
        ]
    )
    session.commit()
    _finding(session, run, agent_name="misuse_agent", dimension="safety")
    _finding(session, run, agent_name="misuse_agent", dimension="safety")

    assert inv.finding_counts_match(session, run.id) == []


# ── planned_metrics_executed ─────────────────────────────────────────────────


def test_planned_metric_with_no_result_row_is_flagged(session: Session) -> None:
    run = _run(session, metrics=["toxicity", "groundedness"])
    session.add(
        MetricResult(
            run_id=run.id, metric_id="toxicity", dimension="safety", tool_name="mock"
        )
    )
    session.commit()

    violations = inv.planned_metrics_executed(session, run.id)

    assert len(violations) == 1
    assert "groundedness" in violations[0].subject


def test_failed_metric_that_ran_is_not_a_violation(session: Session) -> None:
    """A metric that ran and failed has a row with a status — that is visible,
    which is the whole point. Only a missing row is a violation."""
    run = _run(session, metrics=["toxicity"])
    session.add(
        MetricResult(
            run_id=run.id,
            metric_id="toxicity",
            dimension="safety",
            tool_name="mock",
            status="failed",
        )
    )
    session.commit()

    assert inv.planned_metrics_executed(session, run.id) == []


def test_in_flight_run_abstains(session: Session) -> None:
    run = _run(session, status=RunStatus.agents_running, metrics=["toxicity"])

    assert inv.planned_metrics_executed(session, run.id) == []


# ── agent_findings_have_known_agent ──────────────────────────────────────────


def test_finding_from_an_agent_that_never_executed_is_flagged(session: Session) -> None:
    run = _run(session)
    _finding(session, run, agent_name="ghost_agent")

    violations = inv.agent_findings_have_known_agent(session, run.id)

    assert len(violations) == 1
    assert "ghost_agent" in violations[0].detail


def test_finding_from_an_executed_agent_passes(session: Session) -> None:
    run = _run(session)
    session.add(
        AgentExecution(
            run_id=run.id, agent_name="quality_agent", status=AgentExecutionStatus.completed
        )
    )
    session.commit()
    _finding(session, run, agent_name="quality_agent", dimension="quality")

    assert inv.agent_findings_have_known_agent(session, run.id) == []


# ── check_run ────────────────────────────────────────────────────────────────


def test_check_run_can_exclude_a_named_invariant(session: Session) -> None:
    """Lets the clean invariants become hard assertions immediately while the
    evidence-citation rate is still being driven down."""
    run = _run(session)
    _finding(session, run, finding_type="drift", evidence_ids=[], agent_name="drift_agent")
    # finding_count must match the one stored finding, so the ONLY breach left
    # is the missing evidence citation.
    session.add(
        AgentExecution(
            run_id=run.id,
            agent_name="drift_agent",
            status=AgentExecutionStatus.completed,
            finding_count=1,
        )
    )
    session.commit()

    assert len(inv.check_run(session, run.id)) == 1
    assert inv.check_run(
        session, run.id, exclude=frozenset({"substantive_findings_cite_evidence"})
    ) == []
