from datetime import datetime
from uuid import UUID

from sqlmodel import Field

from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import AssessmentRequestStatus


class AssessmentRequest(TimestampMixin, UUIDPrimaryKey, table=True):
    """An auditor's request that the developer (re-)run an assessment.

    Auditors never trigger governance runs directly — that stays a developer
    action (it consumes tools, hits target endpoints, costs compute, depends
    on config the auditor can't see; see docs/AUDITOR_MASTER_SPEC.md §5). This
    is the structured ask that stands in for that: created → in_progress →
    resolved/dismissed, tracked independently of any specific run until the
    developer links one.
    """

    __tablename__ = "assessment_requests"

    ai_system_id: UUID = Field(foreign_key="ai_systems.id", index=True)
    note: str | None = Field(default=None, max_length=2000)
    status: AssessmentRequestStatus = Field(default=AssessmentRequestStatus.pending, index=True)
    requested_by_name: str = Field(max_length=200)
    requested_by_email: str = Field(max_length=254)
    requested_by_role: str = Field(max_length=100)
    resolved_run_id: UUID | None = Field(default=None, foreign_key="evaluation_runs.id")
    resolved_at: datetime | None = Field(default=None)
