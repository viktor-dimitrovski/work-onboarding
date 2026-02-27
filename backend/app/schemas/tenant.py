from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema, PaginationMeta


class TenantOut(BaseSchema):
    id: UUID
    name: str
    slug: str
    tenant_type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TenantCreate(BaseModel):
    name: str
    slug: str
    tenant_type: str = 'company'
    is_active: bool = True
    plan_id: UUID | None = None


class TenantUpdate(BaseModel):
    name: str | None = None
    tenant_type: str | None = None
    is_active: bool | None = None


class TenantListResponse(BaseModel):
    items: list[TenantOut]
    meta: PaginationMeta


class PlanOut(BaseSchema):
    id: UUID
    key: str
    name: str
    tenant_type_scope: str
    module_defaults: dict
    limits_json: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UsageEventSummary(BaseModel):
    event_key: str
    total_quantity: float


class UsageSummaryResponse(BaseModel):
    tenant_id: UUID
    from_date: datetime | None = None
    to_date: datetime | None = None
    items: list[UsageEventSummary] = Field(default_factory=list)


class TenantModuleOut(BaseModel):
    module_key: str
    enabled: bool
    source: str


class TenantModuleUpdate(BaseModel):
    module_key: str
    enabled: bool


class TenantAdminInvite(BaseModel):
    email: str
    full_name: str
    password: str | None = None


class TenantContextOut(BaseModel):
    tenant: TenantOut
    role: str | None
    role_label: str | None
    permissions: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
