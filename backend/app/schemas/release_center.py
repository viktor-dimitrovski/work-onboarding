from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ReleaseCenterCreate(BaseModel):
    track_version_id: UUID
    start_date: date
    target_date: date
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReleaseMetadataUpdate(BaseModel):
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReleaseMetadataOut(BaseModel):
    assignment_id: UUID
    metadata: dict[str, Any]


class ReleaseCenterSummary(BaseModel):
    assignment_id: UUID
    title: str
    status: str
    progress_percent: float
    start_date: date
    target_date: date
    blockers_count: int
    gates_passed: int
    gates_total: int
    environment: str | None = None
    version_tag: str | None = None
    release_manager_user_id: UUID | None = None
    rel_id: str | None = None
    links: dict[str, Any] = Field(default_factory=dict)


class ReleaseCenterListResponse(BaseModel):
    items: list[ReleaseCenterSummary]


class ReleaseTemplateOption(BaseModel):
    template_id: UUID
    version_id: UUID
    title: str
