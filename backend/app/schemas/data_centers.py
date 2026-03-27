from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DataCenterCreate(BaseModel):
    name: str = Field(..., max_length=120)
    slug: str = Field(..., max_length=80, pattern=r'^[a-z0-9-]+$')
    location: str | None = Field(None, max_length=120)
    cluster_url: str | None = Field(None, max_length=255)
    k8s_context: str | None = Field(None, max_length=120)
    environment: str = Field('production', pattern=r'^(production|staging|dr)$')
    is_primary: bool = False
    is_dr: bool = False
    is_active: bool = True


class DataCenterUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    location: str | None = Field(None, max_length=120)
    cluster_url: str | None = Field(None, max_length=255)
    k8s_context: str | None = Field(None, max_length=120)
    environment: str | None = Field(None, pattern=r'^(production|staging|dr)$')
    is_primary: bool | None = None
    is_dr: bool | None = None
    is_active: bool | None = None


class DataCenterOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    location: str | None
    cluster_url: str | None
    k8s_context: str | None
    environment: str
    is_primary: bool
    is_dr: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {'from_attributes': True}


class DataCenterListResponse(BaseModel):
    items: list[DataCenterOut]
    total: int
