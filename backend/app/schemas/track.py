from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema, PaginationMeta


class TaskResourceCreate(BaseModel):
    resource_type: str
    title: str = Field(min_length=1, max_length=200)
    content_text: str | None = None
    url: str | None = Field(default=None, max_length=2000)
    order_index: int = Field(default=0, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TrackTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    instructions: str | None = None
    task_type: str
    required: bool = True
    order_index: int = Field(ge=0)
    estimated_minutes: int | None = Field(default=None, ge=1)
    passing_score: int | None = Field(default=None, ge=0, le=100)
    metadata: dict[str, Any] = Field(default_factory=dict)
    due_days_offset: int | None = Field(default=None, ge=0)
    resources: list[TaskResourceCreate] = Field(default_factory=list)
    source_task_id: UUID | None = None


class TrackPhaseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    order_index: int = Field(ge=0)
    tasks: list[TrackTaskCreate] = Field(default_factory=list)
    source_phase_id: UUID | None = None


class TrackTemplateCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = None
    role_target: str | None = Field(default=None, max_length=100)
    estimated_duration_days: int = Field(default=30, ge=1, le=365)
    tags: list[str] = Field(default_factory=list)
    phases: list[TrackPhaseCreate] = Field(default_factory=list)
    purpose: str = Field(default='onboarding')
    track_type: str = Field(default='GENERAL')


class TaskResourceOut(BaseSchema):
    id: UUID
    resource_type: str
    title: str
    content_text: str | None
    url: str | None
    order_index: int
    metadata: dict[str, Any] = Field(alias='metadata_json')
    created_at: datetime
    updated_at: datetime


class TrackTaskOut(BaseSchema):
    id: UUID
    title: str
    description: str | None
    instructions: str | None
    task_type: str
    required: bool
    order_index: int
    estimated_minutes: int | None
    passing_score: int | None
    metadata: dict[str, Any] = Field(alias='metadata_json')
    due_days_offset: int | None
    resources: list[TaskResourceOut]
    created_at: datetime
    updated_at: datetime


class TrackPhaseOut(BaseSchema):
    id: UUID
    title: str
    description: str | None
    order_index: int
    tasks: list[TrackTaskOut]
    created_at: datetime
    updated_at: datetime


class TrackVersionOut(BaseSchema):
    id: UUID
    version_number: int
    status: str
    title: str
    description: str | None
    estimated_duration_days: int
    tags: list[str]
    purpose: str
    track_type: str
    is_current: bool
    published_at: datetime | None
    phases: list[TrackPhaseOut]
    created_at: datetime
    updated_at: datetime


class TrackTemplateOut(BaseSchema):
    id: UUID
    title: str
    description: str | None
    role_target: str | None
    estimated_duration_days: int
    tags: list[str]
    purpose: str
    track_type: str
    is_active: bool
    versions: list[TrackVersionOut]
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_by_name: str | None = None
    updated_by_name: str | None = None


class TrackTemplateUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = None
    role_target: str | None = Field(default=None, max_length=100)
    estimated_duration_days: int = Field(default=30, ge=1, le=365)
    tags: list[str] = Field(default_factory=list)
    phases: list[TrackPhaseCreate] = Field(default_factory=list)
    purpose: str = Field(default='onboarding')
    track_type: str | None = None
    apply_to_assignments: bool = False


class TrackListResponse(BaseModel):
    items: list[TrackTemplateOut]
    meta: PaginationMeta


class DuplicateTrackResponse(BaseModel):
    template_id: UUID
    new_title: str


class PublishTrackResponse(BaseModel):
    template_id: UUID
    version_id: UUID
    status: str
    published_at: datetime
