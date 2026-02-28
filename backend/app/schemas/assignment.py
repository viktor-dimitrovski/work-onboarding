from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import BaseSchema, PaginationMeta
from app.schemas.track import TaskResourceOut


class AssignmentCreate(BaseModel):
    employee_id: UUID
    mentor_id: UUID | None = None
    track_version_id: UUID
    start_date: date
    target_date: date

    @model_validator(mode='after')
    def validate_dates(self) -> 'AssignmentCreate':
        if self.target_date < self.start_date:
            raise ValueError('target_date must be greater than or equal to start_date')
        return self


class AssignmentTaskOut(BaseSchema):
    id: UUID
    assignment_phase_id: UUID
    title: str
    description: str | None
    instructions: str | None
    task_type: str
    required: bool
    order_index: int
    estimated_minutes: int | None
    passing_score: int | None
    metadata: dict[str, Any] = Field(alias='metadata_json')
    resources: list[TaskResourceOut] = Field(default_factory=list)
    due_date: date | None
    status: str
    progress_percent: float
    is_next_recommended: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AssignmentPhaseOut(BaseSchema):
    id: UUID
    title: str
    description: str | None
    order_index: int
    status: str
    progress_percent: float
    tasks: list[AssignmentTaskOut]
    created_at: datetime
    updated_at: datetime


class AssignmentOut(BaseSchema):
    id: UUID
    employee_id: UUID
    mentor_id: UUID | None
    template_id: UUID
    track_version_id: UUID
    title: str
    purpose: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_json')
    start_date: date
    target_date: date
    status: str
    progress_percent: float
    phases: list[AssignmentPhaseOut]
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_by_name: str | None = None
    updated_by_name: str | None = None


class AssignmentListResponse(BaseModel):
    items: list[AssignmentOut]
    meta: PaginationMeta


class NextTaskResponse(BaseModel):
    assignment_id: UUID
    task: AssignmentTaskOut | None
