from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class UUIDPrimaryKey(SQLModel):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)


class TimestampMixin(SQLModel):
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime | None = None
