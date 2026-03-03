"""Pydantic v2 request/response schemas for the Integration Registry module."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mask_vault_ref(ref: str | None) -> str | None:
    """Return a masked vault reference — show path prefix but not the leaf secret name."""
    if not ref:
        return ref
    # Show the first 4 path segments and replace leaf with ***
    parts = ref.split("/")
    if len(parts) > 4:
        return "/".join(parts[:4]) + "/***"
    return ref


# ---------------------------------------------------------------------------
# Dictionary
# ---------------------------------------------------------------------------

class IrDictionaryRead(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    is_addable: bool
    is_global: bool
    tenant_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class IrDictionaryItemBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=80)
    label: str = Field(..., min_length=1, max_length=200)
    sort_order: int = 0
    meta_json: dict[str, Any] = Field(default_factory=dict)


class IrDictionaryItemCreate(IrDictionaryItemBase):
    pass


class IrDictionaryItemUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=200)
    is_active: bool | None = None
    sort_order: int | None = None
    meta_json: dict[str, Any] | None = None


class IrDictionaryItemRead(IrDictionaryItemBase):
    id: uuid.UUID
    dictionary_id: uuid.UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID | None = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class IrServiceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    service_type: str | None = Field(default=None, max_length=80)
    owner_team: str | None = Field(default=None, max_length=120)
    status: str = Field(default="active", max_length=40)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)


class IrServiceCreate(IrServiceBase):
    change_reason: str = Field(..., min_length=1)


class IrServiceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    service_type: str | None = Field(default=None, max_length=80)
    owner_team: str | None = Field(default=None, max_length=120)
    status: str | None = Field(default=None, max_length=40)
    description: str | None = None
    tags: list[str] | None = None
    change_reason: str = Field(..., min_length=1)


class IrServiceRead(IrServiceBase):
    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID | None = None
    updated_by: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class IrServiceListRead(BaseModel):
    id: uuid.UUID
    name: str
    service_type: str | None = None
    owner_team: str | None = None
    status: str
    instance_count: int = 0

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

class IrEndpointBase(BaseModel):
    fqdn: str | None = Field(default=None, max_length=500)
    ip: str | None = Field(default=None, max_length=100)
    port: int | None = None
    protocol: str = Field(default="HTTPS", max_length=20)
    base_path: str | None = Field(default=None, max_length=500)
    is_public: bool = False
    is_primary: bool = False
    sort_order: int = 0

    @model_validator(mode="after")
    def _require_fqdn_or_ip(self) -> "IrEndpointBase":
        if not self.fqdn and not self.ip:
            raise ValueError("Either fqdn or ip must be provided")
        return self


class IrEndpointCreate(IrEndpointBase):
    pass


class IrEndpointUpdate(BaseModel):
    fqdn: str | None = Field(default=None, max_length=500)
    ip: str | None = Field(default=None, max_length=100)
    port: int | None = None
    protocol: str | None = Field(default=None, max_length=20)
    base_path: str | None = Field(default=None, max_length=500)
    is_public: bool | None = None
    is_primary: bool | None = None
    sort_order: int | None = None


class IrEndpointRead(IrEndpointBase):
    id: uuid.UUID
    instance_id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Route Hop
# ---------------------------------------------------------------------------

class IrRouteHopBase(BaseModel):
    direction: str = Field(default="outbound", max_length=20)
    hop_order: int = 0
    label: str | None = Field(default=None, max_length=200)
    proxy_chain: str | None = Field(default=None, max_length=500)
    notes: str | None = None

    @field_validator("direction")
    @classmethod
    def _validate_direction(cls, v: str) -> str:
        if v not in ("inbound", "outbound"):
            raise ValueError("direction must be 'inbound' or 'outbound'")
        return v


class IrRouteHopCreate(IrRouteHopBase):
    pass


class IrRouteHopUpdate(BaseModel):
    direction: str | None = None
    hop_order: int | None = None
    label: str | None = None
    proxy_chain: str | None = None
    notes: str | None = None


class IrRouteHopRead(IrRouteHopBase):
    id: uuid.UUID
    instance_id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Instance
# ---------------------------------------------------------------------------

class IrInstanceBase(BaseModel):
    env: str = Field(..., max_length=20)
    datacenter: str | None = Field(default=None, max_length=80)
    network_zone: str | None = Field(default=None, max_length=80)
    status: str = Field(default="draft", max_length=40)
    contact: str | None = Field(default=None, max_length=200)
    vault_ref: str | None = Field(default=None, max_length=500)
    type_settings_json: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None


class IrInstanceCreate(IrInstanceBase):
    service_id: uuid.UUID
    change_reason: str = Field(..., min_length=1)
    endpoints: list[IrEndpointCreate] = Field(default_factory=list)
    route_hops: list[IrRouteHopCreate] = Field(default_factory=list)


class IrInstanceUpdate(BaseModel):
    env: str | None = Field(default=None, max_length=20)
    datacenter: str | None = Field(default=None, max_length=80)
    network_zone: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=40)
    contact: str | None = Field(default=None, max_length=200)
    vault_ref: str | None = Field(default=None, max_length=500)
    type_settings_json: dict[str, Any] | None = None
    tags: list[str] | None = None
    notes: str | None = None
    endpoints: list[IrEndpointCreate] | None = None
    route_hops: list[IrRouteHopCreate] | None = None
    change_reason: str = Field(..., min_length=1)


class IrInstanceRead(IrInstanceBase):
    id: uuid.UUID
    service_id: uuid.UUID
    tenant_id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID | None = None
    updated_by: uuid.UUID | None = None
    endpoints: list[IrEndpointRead] = Field(default_factory=list)
    route_hops: list[IrRouteHopRead] = Field(default_factory=list)
    service_name: str | None = None
    encryption_locked: bool = False

    model_config = {"from_attributes": True}


class IrInstanceListRead(BaseModel):
    """Lightweight row for the connections grid."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    service_id: uuid.UUID
    service_name: str | None = None
    env: str
    datacenter: str | None = None
    network_zone: str | None = None
    status: str
    primary_endpoint: str | None = None
    version: int
    updated_at: datetime
    updated_by: uuid.UUID | None = None
    encryption_locked: bool = False

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Encryption settings
# ---------------------------------------------------------------------------


class IrCryptoSettings(BaseModel):
    initialized: bool
    unlocked: bool
    key_fingerprint: str | None = None
    kdf_params: dict[str, Any] | None = None


class IrCryptoUnlockRequest(BaseModel):
    passphrase: str = Field(..., min_length=1)
    reinitialize: bool = False


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

class IrAuditLogRead(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    version: int
    action: str
    changed_by: uuid.UUID | None = None
    changed_at: datetime
    change_reason: str
    snapshot_json: dict[str, Any]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# User Grid Preferences
# ---------------------------------------------------------------------------

class IrGridPrefsRead(BaseModel):
    grid_key: str
    visible_columns: list[str]
    order: list[str]

    model_config = {"from_attributes": True}


class IrGridPrefsSave(BaseModel):
    visible_columns: list[str]
    order: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Overview / Dashboard
# ---------------------------------------------------------------------------

class IrOverviewRecentItem(BaseModel):
    instance_id: uuid.UUID
    service_name: str
    env: str
    status: str
    changed_at: datetime
    changed_by: uuid.UUID | None = None


class IrOverview(BaseModel):
    total: int
    uat_count: int
    prod_count: int
    draft_count: int
    active_count: int
    service_count: int
    recently_changed: list[IrOverviewRecentItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Paginated list wrapper
# ---------------------------------------------------------------------------

class IrInstanceListResponse(BaseModel):
    items: list[IrInstanceListRead]
    total: int
    page: int
    page_size: int
