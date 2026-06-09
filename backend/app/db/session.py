from collections.abc import Generator

from sqlmodel import Session, create_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, echo=settings.app_env == "local")


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
