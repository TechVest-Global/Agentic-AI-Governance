import os

# Hermetic tests: neutralize any live model-provider credentials that may be
# present in the developer .env. Settings() hardcodes env_file=<repo>/.env, so
# without this the model-client registry resolves a *live* Azure/LiteLLM client
# instead of its mock fallback, making the suite non-deterministic (and hitting
# real endpoints). Empty string overrides the .env value via pydantic-settings
# precedence (env vars > dotenv); deleting the key would NOT, since the .env
# file is still read. This must run before any app module constructs Settings.
for _credential_var in (
    "JUDGE_ENDPOINT",
    "JUDGE_API_KEY",
    "JUDGE_DEPLOYMENT_NAME",
    "LITELLM_PROXY_URL",
    "LITELLM_MASTER_KEY",
    "TARGET_ENDPOINT",
    "TARGET_API_KEY",
    # The PER-KIND target credentials, which clearing TARGET_* does not cover:
    # get_target_model_client_for_system() infers the adapter kind from the
    # audited system's registration (a system named "Techvest RAG Chatbot"
    # resolves the techvest branch) and then reads TECHVEST_*/HR_GATEWAY_* for
    # the endpoint and key. With a developer .env present that produced a LIVE
    # client, so the suite sent every specialist agent's probes to the real
    # deployed chatbot: non-deterministic, slow, and dependent on that service's
    # rate limit — it returned HTTP 429 once agents began running concurrently,
    # surfacing as agents failing with zero findings.
    "TECHVEST_ENDPOINT",
    "TECHVEST_API_KEY",
    "HR_GATEWAY_ENDPOINT",
    "HR_GATEWAY_API_KEY",
):
    os.environ[_credential_var] = ""

from collections.abc import Generator

import app.models  # noqa: F401
import pytest
from app.db.session import get_session
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    import app.db.session as db_session
    from app.core.security import _DEMO_USERS, create_access_token

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    def override_get_session() -> Generator[Session, None, None]:
        with Session(engine) as session:
            yield session

    # Services that open their OWN session (metric_execution worker pool,
    # orchestration background job) reference db_session.engine at call time.
    # Point it at the in-memory test engine so their writes land in the same DB
    # the test reads from. Restore afterward.
    original_engine = db_session.engine
    db_session.engine = engine

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        # Mutating routes now require a bearer token (see app/main.py's auth
        # middleware). Sign every test in as the demo "dev" user by default so
        # the existing suite's direct client.post/patch/delete calls keep
        # working unchanged; tests that specifically exercise auth can still
        # override/clear this header per-request.
        token = create_access_token(_DEMO_USERS["dev@governai.com"])
        test_client.headers["Authorization"] = f"Bearer {token}"
        yield test_client

    app.dependency_overrides.clear()
    db_session.engine = original_engine
    SQLModel.metadata.drop_all(engine)


def advance_run_to_council(run_id: str) -> None:
    """Move a run to the deliberation-council phase.

    POST /evaluation-runs/{id}/verdict now refuses to record a verdict for a run
    that has not reached the council, because a verdict written earlier gets
    adopted by the pipeline as the council's own outcome (see
    app/services/verdicts.py). Tests that only need a verdict to exist use this
    to reach an eligible phase without driving the whole pipeline.

    Writes through db_session.engine, which the `client` fixture has already
    pointed at the in-memory test database.
    """
    from uuid import UUID

    import app.db.session as db_session
    from app.models.enums import RunPhase, RunStatus
    from app.models.evaluation import EvaluationRun

    with Session(db_session.engine) as session:
        run = session.get(EvaluationRun, UUID(run_id))
        assert run is not None, f"run {run_id} does not exist"
        run.status = RunStatus.council_running
        run.current_phase = RunPhase.deliberation_council
        session.add(run)
        session.commit()
