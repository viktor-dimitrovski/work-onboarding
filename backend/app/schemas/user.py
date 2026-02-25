from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import BaseSchema, PaginationMeta


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    roles: list[str] = Field(default_factory=list)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    is_active: bool | None = None
    roles: list[str] | None = None


class UserOut(BaseSchema):
    id: UUID
    email: EmailStr
    full_name: str
    is_active: bool
    roles: list[str]
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: list[UserOut]
    meta: PaginationMeta
