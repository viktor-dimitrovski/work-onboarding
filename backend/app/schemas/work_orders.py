from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ServiceTouchedItem(BaseModel):
    service_id: str = Field(min_length=1)
    repo: str | None = None
    change_type: str | None = None
    requires_deploy: bool = False
    requires_db_migration: bool = False
    requires_config_change: bool = False
    feature_flags: list[str] = Field(default_factory=list)
    release_notes_ref: str | None = None


class WorkOrderDraft(BaseModel):
    wo_id: str = Field(min_length=6)
    title: str = Field(min_length=1)
    wo_type: str | None = Field(default=None, alias="type")
    status: str | None = None
    owner: str | None = None
    requested_by: str | None = None
    tenants_impacted: list[str] = Field(default_factory=list)
    risk: str | None = None
    target_envs: list[str] = Field(default_factory=list)
    postman_testing_ref: str | None = None
    services_touched: list[ServiceTouchedItem] = Field(default_factory=list)
    body_markdown: str = ''
    branch: str | None = None
    sha: str | None = None


class WorkOrderParsed(BaseModel):
    title: str
    wo_type: str | None = Field(default=None, alias="type")
    status: str | None = None
    owner: str | None = None
    requested_by: str | None = None
    tenants_impacted: list[str] = Field(default_factory=list)
    risk: str | None = None
    target_envs: list[str] = Field(default_factory=list)
    postman_testing_ref: str | None = None
    services_touched: list[ServiceTouchedItem] = Field(default_factory=list)
    body_markdown: str = ''


class WODCStatus(BaseModel):
    data_center_id: str
    data_center_name: str
    slug: str
    status: str
    deployed_at: datetime | None = None


class WorkOrderSummary(BaseModel):
    wo_id: str
    id: str | None = None
    title: str | None = None
    path: str
    year: str
    services_count: int = 0
    deploy_count: int = 0
    sync_status: str | None = None
    pr_url: str | None = None
    branch: str | None = None
    dc_deployments: list[WODCStatus] = []
    platform_release_id: str | None = None
    platform_release_name: str | None = None


class WorkOrderOut(BaseModel):
    wo_id: str
    path: str
    sha: str | None = None
    raw_markdown: str
    parsed: WorkOrderParsed
    pr_url: str | None = None
    branch: str | None = None
    sync_status: str | None = None
    last_sync_at: datetime | None = None
    last_sync_error: str | None = None
    sync_requested_at: datetime | None = None
    git_repo_full_name: str | None = None
    git_folder_path: str | None = None
    git_path: str | None = None
    git_branch: str | None = None
    git_sha: str | None = None


class WorkOrderListResponse(BaseModel):
    items: list[WorkOrderSummary]
