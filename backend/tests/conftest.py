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
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    def override_get_session() -> Generator[Session, None, None]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    SQLModel.metadata.drop_all(engine)
