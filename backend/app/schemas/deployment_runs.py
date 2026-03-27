from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class DeploymentRunCreate(BaseModel):
    data_center_id: str
    environment: str


class DeploymentRunItemUpdate(BaseModel):
    status: str
    notes: str | None = None

    @field_validator('status')
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {'pending', 'in_progress', 'done', 'blocked', 'postponed', 'skipped'}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v

    @field_validator('notes')
    @classmethod
    def notes_required_for_blocked(cls, v: str | None, info: object) -> str | None:
        return v


class MarkAllDoneRequest(BaseModel):
    pass


class CompleteRunRequest(BaseModel):
    notes: str | None = None
    force: bool = False


class ReopenRunRequest(BaseModel):
    reopen_reason: str


class AbortRunRequest(BaseModel):
    notes: str


class DeploymentRunItemOut(BaseModel):
    id: str
    deployment_run_id: str
    group_key: str
    group_label: str
    step_index: int
    item_title: str
    migration_step: str | None
    status: str
    notes: str | None
    marked_by: str | None
    marked_at: datetime | None

    model_config = {"from_attributes": True}


class DeploymentRunOut(BaseModel):
    id: str
    platform_release_id: str
    data_center_id: str
    data_center_name: str | None = None
    data_center_slug: str | None = None
    environment: str
    status: str
    started_by: str | None
    started_at: datetime
    completed_at: datetime | None
    reopened_at: datetime | None
    reopened_by: str | None
    reopen_reason: str | None
    notes: str | None
    created_at: datetime
    items: list[DeploymentRunItemOut] = []

    # Computed progress fields
    total_items: int = 0
    done_items: int = 0
    blocked_items: int = 0
    pending_items: int = 0

    model_config = {"from_attributes": True}


class DeploymentRunSummary(BaseModel):
    id: str
    platform_release_id: str
    data_center_id: str
    data_center_name: str | None = None
    data_center_slug: str | None = None
    environment: str
    status: str
    started_by: str | None
    started_at: datetime
    completed_at: datetime | None
    total_items: int = 0
    done_items: int = 0
    blocked_items: int = 0
    pending_items: int = 0

    model_config = {"from_attributes": True}
