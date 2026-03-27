from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


ReleaseType = Literal['quarterly', 'ad_hoc', 'security', 'bugfix']
ReleaseStatus = Literal['planned', 'draft', 'preparation', 'cab_approved', 'deploying', 'deployed', 'closed']


class PlatformReleaseCreate(BaseModel):
    name: str = Field(..., max_length=120)
    release_type: ReleaseType = 'quarterly'
    status: ReleaseStatus = 'draft'
    environment: str | None = Field(None, max_length=60)
    data_center_id: uuid.UUID | None = None
    cab_approver_id: uuid.UUID | None = None
    work_order_ids: list[uuid.UUID] = Field(default_factory=list)
    planned_start: date | None = None
    planned_end: date | None = None
    planning_notes: str | None = None


class PlatformReleaseUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    release_type: ReleaseType | None = None
    environment: str | None = Field(None, max_length=60)
    data_center_id: uuid.UUID | None = None
    cab_approver_id: uuid.UUID | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    planning_notes: str | None = None


class WorkOrderSelectionUpdate(BaseModel):
    work_order_ids: list[uuid.UUID]


class RecordDeploymentRequest(BaseModel):
    data_center_id: uuid.UUID
    environment: str | None = Field(None, max_length=60)
    deployed_by: uuid.UUID | None = None
    notes: str | None = None


class CABApprovalRequest(BaseModel):
    notes: str | None = None


class DeployToAnotherDCRequest(BaseModel):
    target_data_center_id: uuid.UUID
    name: str | None = Field(None, max_length=120, description="Override the auto-generated name")


class WODCDeploymentOut(BaseModel):
    id: uuid.UUID
    work_order_id: uuid.UUID
    data_center_id: uuid.UUID
    data_center_name: str | None = None
    platform_release_id: uuid.UUID | None
    environment: str | None
    status: str
    deployed_at: datetime | None
    deployed_by: uuid.UUID | None
    notes: str | None
    created_at: datetime

    model_config = {'from_attributes': True}


class PlatformReleaseWorkOrderOut(BaseModel):
    work_order_id: uuid.UUID
    wo_id: str | None = None
    title: str | None = None
    included_at: datetime
    included_by: uuid.UUID | None

    model_config = {'from_attributes': True}


class PlatformReleaseOut(BaseModel):
    id: uuid.UUID
    name: str
    release_type: str
    status: str
    environment: str | None
    data_center_id: uuid.UUID | None
    data_center_name: str | None = None
    cab_approver_id: uuid.UUID | None
    cab_approved_at: datetime | None
    cab_notes: str | None
    generated_at: datetime | None
    generated_by: uuid.UUID | None
    services_snapshot: list[Any]
    changelog_snapshot: list[Any]
    deploy_steps_snapshot: list[Any]
    deployed_at: datetime | None
    work_orders: list[PlatformReleaseWorkOrderOut] = []
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    planned_start: date | None = None
    planned_end: date | None = None
    planning_notes: str | None = None

    model_config = {'from_attributes': True}


class PlatformReleaseSummary(BaseModel):
    id: uuid.UUID
    name: str
    release_type: str
    status: str
    environment: str | None
    data_center_id: uuid.UUID | None
    data_center_name: str | None = None
    cab_approver_id: uuid.UUID | None
    cab_approved_at: datetime | None
    generated_at: datetime | None
    work_order_count: int
    service_count: int
    deployed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    planned_start: date | None = None
    planned_end: date | None = None
    planning_notes: str | None = None

    model_config = {'from_attributes': True}


class PlatformReleaseListResponse(BaseModel):
    items: list[PlatformReleaseSummary]
    total: int


class ReleaseCenterSummaryItem(BaseModel):
    id: str
    name: str
    release_type: str
    status: str
    environment: str | None
    data_center_id: str | None
    data_center_name: str | None
    data_center_slug: str | None
    planned_start: date | None
    planned_end: date | None
    planning_notes: str | None
    work_order_count: int
    cab_approver_id: str | None
    cab_approved_at: datetime | None
    generated_at: datetime | None
    deployed_at: datetime | None
    created_at: datetime
    # Computed fields for the dashboard
    next_action: str | None = None
    waiting_on: dict | None = None
    days_to_window: int | None = None
    active_run_id: str | None = None
    active_run_progress: dict | None = None


class ReleaseCenterResponse(BaseModel):
    in_flight: list[ReleaseCenterSummaryItem]
    planned: list[ReleaseCenterSummaryItem]
    recently_closed: list[ReleaseCenterSummaryItem]
