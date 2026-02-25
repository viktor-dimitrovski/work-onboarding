from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


class TaskSubmissionCreate(BaseModel):
    submission_type: str = Field(default='text', max_length=50)
    answer_text: str | None = None
    file_url: str | None = Field(default=None, max_length=2000)
    metadata: dict[str, Any] = Field(default_factory=dict)
    quiz_score: float | None = Field(default=None, ge=0)
    quiz_max_score: float | None = Field(default=None, ge=0)
    quiz_answers: dict[str, Any] = Field(default_factory=dict)


class TaskSubmissionOut(BaseSchema):
    id: UUID
    assignment_task_id: UUID
    employee_id: UUID
    submission_type: str
    answer_text: str | None
    file_url: str | None
    metadata: dict[str, Any] = Field(alias='metadata_json')
    status: str
    submitted_at: datetime


class MentorReviewCreate(BaseModel):
    decision: str
    comment: str | None = None


class MentorReviewOut(BaseSchema):
    id: UUID
    assignment_task_id: UUID
    submission_id: UUID | None
    mentor_id: UUID
    decision: str
    comment: str | None
    reviewed_at: datetime
