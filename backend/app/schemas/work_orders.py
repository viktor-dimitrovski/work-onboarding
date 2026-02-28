from __future__ import annotations

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


class WorkOrderSummary(BaseModel):
    wo_id: str
    title: str | None = None
    path: str
    year: str
    services_count: int = 0
    deploy_count: int = 0


class WorkOrderOut(BaseModel):
    wo_id: str
    path: str
    sha: str | None = None
    raw_markdown: str
    parsed: WorkOrderParsed
    pr_url: str | None = None
    branch: str | None = None


class WorkOrderListResponse(BaseModel):
    items: list[WorkOrderSummary]
