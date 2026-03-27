from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ItemType = Literal['feature', 'bug_fix', 'security', 'api_change', 'breaking_change', 'config_change']
ReleaseNoteStatus = Literal['draft', 'published', 'approved']
ComponentType = Literal['service', 'config']


class ReleaseNoteCreate(BaseModel):
    repo: str = Field(..., max_length=200)
    branch: str | None = Field(None, max_length=120)
    service_name: str = Field(..., max_length=200)
    component_type: ComponentType = 'service'
    tag: str = Field(..., max_length=120)


class ReleaseNoteItemCreate(BaseModel):
    item_type: ItemType
    title: str = Field(..., max_length=500)
    description: str | None = None
    migration_step: str | None = None
    order_index: int = 0


class ReleaseNoteItemUpdate(BaseModel):
    item_type: ItemType | None = None
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    migration_step: str | None = None
    order_index: int | None = None


class ReorderItemsRequest(BaseModel):
    items: list[dict]  # [{id: str, order_index: int}]


class ApprovalRequest(BaseModel):
    approved_by: uuid.UUID


class AddAuthorRequest(BaseModel):
    user_id: uuid.UUID


class AuthorOut(BaseModel):
    user_id: uuid.UUID
    full_name: str | None = None
    email: str | None = None
    added_at: datetime

    model_config = {'from_attributes': True}


class ReleaseNoteItemOut(BaseModel):
    id: uuid.UUID
    item_type: str
    title: str
    description: str | None
    migration_step: str | None
    order_index: int
    created_by: uuid.UUID | None
    updated_at: datetime

    model_config = {'from_attributes': True}


class ReleaseNoteOut(BaseModel):
    id: uuid.UUID
    repo: str
    branch: str | None
    service_name: str
    component_type: str
    tag: str
    status: str
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    authors: list[AuthorOut] = []
    items: list[ReleaseNoteItemOut] = []
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class ReleaseNoteSummary(BaseModel):
    id: uuid.UUID
    repo: str
    branch: str | None
    service_name: str
    component_type: str
    tag: str
    status: str
    approved_by: uuid.UUID | None
    item_count: int
    author_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class ReleaseNoteListResponse(BaseModel):
    items: list[ReleaseNoteSummary]
    total: int


class DCDeploymentStatus(BaseModel):
    data_center_id: str
    data_center_name: str
    data_center_slug: str
    status: str
    deployed_at: datetime | None = None
    platform_release_name: str | None = None


class FunctionalitySearchResult(BaseModel):
    item_id: str
    item_title: str
    item_type: str
    description: str | None
    release_note_id: str
    release_note_status: str
    is_draft: bool
    service_name: str
    repo: str
    tag: str
    component_type: str
    dc_deployments: list[DCDeploymentStatus] = []
