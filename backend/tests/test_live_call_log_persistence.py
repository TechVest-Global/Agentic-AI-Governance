"""Captured LLM calls must be queryable WHILE a phase is still running.

Call logs used to live in a memory-only buffer that was written to the database
once, at the end of the phase that opened it. Two consequences, both seen on a
live TechVest run: minutes into metric execution GET /llm-calls still returned
`call_count: 0`, so the Live Run view showed a run with no probes; and a crash
anywhere in the phase discarded every call it had made.

The gateway now writes each entry as it completes, and the phase-end drain
handles only what the immediate write missed — so the two paths together never
double-insert and never lose a call.
"""

from collections.abc import Generator
from uuid import UUID, uuid4

import app.db.session as db_session
import app.models  # noqa: F401  (register every table before create_all)
import pytest
from app.models.llm_call_log import LLMCallLog
from app.services.model_clients.base import TargetModelRequest, TargetModelResponse
from app.services.model_clients.gateway import (
    GatewayTargetModelClient,
    drain_log_capture,
    start_log_capture,
)
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select


@pytest.fixture
def engine() -> Generator[object, None, None]:
    """An in-memory DB wired in where the gateway's own session factory looks."""
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    original = db_session.engine
    db_session.engine = test_engine
    yield test_engine
    db_session.engine = original
    SQLModel.metadata.drop_all(test_engine)


class _Target:
    provider = "fake"
    credential_ref = "FAKE_KEY"
    supports_media = False

    def invoke(self, request: TargetModelRequest) -> TargetModelResponse:
        return TargetModelResponse(
            provider="fake",
            endpoint_ref=request.endpoint_ref,
            raw_output="the model replied",
            sanitized_output="the model replied",
            trace_id="t",
            latency_ms=12,
        )


def _probe(client: GatewayTargetModelClient, prompt: str) -> None:
    client.invoke(TargetModelRequest(endpoint_ref="https://t.invalid", prompt=prompt))


def _stored(engine, run_id: UUID) -> list[LLMCallLog]:
    with Session(engine) as session:
        return list(session.exec(select(LLMCallLog).where(LLMCallLog.run_id == run_id)).all())


def test_a_call_is_in_the_database_before_the_phase_drains(engine) -> None:
    """The property the change exists for: mid-phase visibility."""
    run_id = uuid4()
    start_log_capture(run_id)
    client = GatewayTargetModelClient(_Target())

    _probe(client, "probe one")
    _probe(client, "probe two")

    # No drain yet — the phase is still running.
    rows = _stored(engine, run_id)
    assert len(rows) == 2, "probes were not queryable while the phase was in flight"
    assert {r.prompt_text for r in rows} == {"probe one", "probe two"}


def test_the_drain_does_not_insert_an_already_written_call_again(engine) -> None:
    run_id = uuid4()
    start_log_capture(run_id)

    _probe(GatewayTargetModelClient(_Target()), "probe one")

    assert drain_log_capture() == [], "drain re-offered a call that was already persisted"
    assert len(_stored(engine, run_id)) == 1


def test_a_call_the_live_write_could_not_store_still_reaches_the_drain(engine) -> None:
    """The immediate write is best-effort; the buffer stays the safety net.

    Simulated by pointing the gateway's session factory at a torn-down engine,
    so the insert raises exactly as it would during a database blip.
    """
    run_id = uuid4()
    start_log_capture(run_id)
    broken = create_engine("sqlite://", poolclass=StaticPool)  # no tables created
    db_session.engine = broken

    _probe(GatewayTargetModelClient(_Target()), "probe one")

    db_session.engine = engine
    drained = drain_log_capture()
    assert len(drained) == 1, "a failed live write must leave the entry for the drain"
    assert drained[0]["prompt_text"] == "probe one"
    assert "_persisted" not in drained[0], "drained entries must be safe to splat into LLMCallLog"
    assert _stored(engine, run_id) == []


def test_every_call_is_stamped_with_the_layer_that_made_it(engine) -> None:
    """Without a phase, a run's calls are one flat list.

    An evaluator's probe during metric execution and a specialist agent's probe
    are then indistinguishable, and the UI has to guess the owning layer from
    the shape of agent_name/task strings.
    """
    run_id = uuid4()
    start_log_capture(run_id, "metric_execution")

    _probe(GatewayTargetModelClient(_Target()), "probe one")

    assert _stored(engine, run_id)[0].phase == "metric_execution"


def test_a_probe_with_no_named_capability_still_produces_a_storable_row(engine) -> None:
    """LLMCallLog.task is NOT NULL; capability_name is None at a base endpoint.

    That combination used to build a row the database rejects. It only blew up
    at the phase-end commit — the same commit that writes the run's
    result_summary — so one unnamed probe could take a whole phase's
    bookkeeping down with it.
    """
    run_id = uuid4()
    start_log_capture(run_id)

    GatewayTargetModelClient(_Target()).invoke(
        TargetModelRequest(endpoint_ref="https://t.invalid", prompt="p", capability_name=None)
    )

    rows = _stored(engine, run_id)
    assert len(rows) == 1
    assert rows[0].task == "target_probe"


def test_capture_without_a_run_id_stays_buffer_only(engine) -> None:
    """Non-run callers (and most unit tests) must not start writing rows."""
    start_log_capture()

    _probe(GatewayTargetModelClient(_Target()), "probe one")

    with Session(engine) as session:
        assert session.exec(select(LLMCallLog)).all() == []
    assert len(drain_log_capture()) == 1
