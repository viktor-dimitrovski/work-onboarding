from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

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
    admin_email: EmailStr | None = None
    admin_full_name: str | None = None


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


class PlanCreate(BaseModel):
    key: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=100)
    tenant_type_scope: str = Field(default='all', min_length=2, max_length=20)
    module_defaults: dict = Field(default_factory=dict)
    limits_json: dict = Field(default_factory=dict)
    is_active: bool = True


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    tenant_type_scope: str | None = Field(default=None, min_length=2, max_length=20)
    module_defaults: dict | None = None
    limits_json: dict | None = None
    is_active: bool | None = None


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


class TenantChangePlan(BaseModel):
    plan_id: UUID


class TenantAdminInvite(BaseModel):
    email: EmailStr
    full_name: str


class TenantContextOut(BaseModel):
    tenant: TenantOut
    role: str | None
    role_label: str | None
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)


class TenantSummaryOut(BaseModel):
    id: UUID
    name: str
    slug: str
    tenant_type: str
    is_active: bool


class UserTenantMembershipOut(BaseModel):
    tenant: TenantSummaryOut
    status: str
    roles: list[str] = Field(default_factory=list)


class TenantMemberOut(BaseModel):
    id: UUID
    user_id: UUID
    email: str
    full_name: str | None = None
    roles: list[str] = Field(default_factory=list)
    status: str
    created_at: datetime


class TenantMemberStatusUpdate(BaseModel):
    status: str = Field(description="'active' or 'disabled'")
