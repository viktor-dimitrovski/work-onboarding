"""SQLAlchemy models for the Integration Registry module.

All tenant-scoped tables live in the `integration_registry` PostgreSQL schema
and use RLS + the `app.tenant_id` session variable for row-level isolation.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import AuditUserMixin, TimestampMixin, UUIDPrimaryKeyMixin

IR_SCHEMA = "integration_registry"


class IrDictionary(UUIDPrimaryKeyMixin, Base):
    """Global or tenant-scoped code list definition (drives all IR dropdowns)."""

    __tablename__ = "ir_dictionary"
    __table_args__ = (
        sa.UniqueConstraint("key", "tenant_id", name="uq_ir_dictionary_key_tenant"),
        {"schema": IR_SCHEMA},
    )

    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_addable: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default=sa.text("true"))
    is_global: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default=sa.text("false"))
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list[IrDictionaryItem]] = relationship(
        back_populates="dictionary",
        cascade="all, delete-orphan",
        order_by="IrDictionaryItem.sort_order",
    )


class IrTenantCrypto(TimestampMixin, AuditUserMixin, Base):
    """Per-tenant crypto metadata (salt + fingerprint)."""

    __tablename__ = "ir_tenant_crypto"
    __table_args__ = {"schema": IR_SCHEMA}

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    kdf_salt: Mapped[bytes] = mapped_column(LargeBinary(), nullable=False)
    key_fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    kdf_params_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )


class IrDictionaryItem(UUIDPrimaryKeyMixin, Base):
    """A single entry within an IrDictionary."""

    __tablename__ = "ir_dictionary_item"
    __table_args__ = (
        sa.UniqueConstraint("dictionary_id", "code", name="uq_ir_dictionary_item_dict_code"),
        {"schema": IR_SCHEMA},
    )

    dictionary_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f"{IR_SCHEMA}.ir_dictionary.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default=sa.text("true"))
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default=sa.text("0"))
    meta_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    dictionary: Mapped[IrDictionary] = relationship(back_populates="items")


class IrService(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    """Logical service catalog entry — one row per named integration service."""

    __tablename__ = "ir_service"
    __table_args__ = {"schema": IR_SCHEMA}

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    service_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    owner_team: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, server_default=sa.text("'active'"))
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    tags: Mapped[list[str]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )

    instances: Mapped[list[IrInstance]] = relationship(
        back_populates="service",
        cascade="all, delete-orphan",
    )


class IrInstance(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    """A deployed instance of a logical service in a specific env+datacenter."""

    __tablename__ = "ir_instance"
    __table_args__ = {"schema": IR_SCHEMA}

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    service_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f"{IR_SCHEMA}.ir_service.id", ondelete="CASCADE"),
        nullable=False,
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    datacenter: Mapped[str | None] = mapped_column(String(80), nullable=True)
    network_zone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, server_default=sa.text("'draft'"))
    contact: Mapped[str | None] = mapped_column(String(200), nullable=True)
    vault_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    type_settings_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )
    tags: Mapped[list[str]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    version: Mapped[int] = mapped_column(Integer(), nullable=False, server_default=sa.text("1"))

    service: Mapped[IrService] = relationship(back_populates="instances")
    endpoints: Mapped[list[IrEndpoint]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
        order_by="IrEndpoint.sort_order",
    )
    route_hops: Mapped[list[IrRouteHop]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
        order_by="IrRouteHop.hop_order",
    )


class IrEndpoint(UUIDPrimaryKeyMixin, Base):
    """FQDN/IP/port entry for an IrInstance (1..N per instance)."""

    __tablename__ = "ir_endpoint"
    __table_args__ = {"schema": IR_SCHEMA}

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f"{IR_SCHEMA}.ir_instance.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    fqdn: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(100), nullable=True)
    port: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    protocol: Mapped[str] = mapped_column(String(20), nullable=False, server_default=sa.text("'HTTPS'"))
    base_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default=sa.text("false"))
    is_primary: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default=sa.text("false"))
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default=sa.text("0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    instance: Mapped[IrInstance] = relationship(back_populates="endpoints")


class IrRouteHop(UUIDPrimaryKeyMixin, Base):
    """A single proxy chain hop for an IrInstance (0..N per instance)."""

    __tablename__ = "ir_route_hop"
    __table_args__ = {"schema": IR_SCHEMA}

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(f"{IR_SCHEMA}.ir_instance.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    direction: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=sa.text("'outbound'")
    )
    hop_order: Mapped[int] = mapped_column(Integer(), nullable=False, server_default=sa.text("0"))
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    proxy_chain: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    instance: Mapped[IrInstance] = relationship(back_populates="route_hops")


class IrAuditLog(UUIDPrimaryKeyMixin, Base):
    """Immutable snapshot audit record written on every create/update/delete."""

    __tablename__ = "ir_audit_log"
    __table_args__ = {"schema": IR_SCHEMA}

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        index=True,
        server_default=sa.text("current_setting('app.tenant_id')::uuid"),
    )
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version: Mapped[int] = mapped_column(Integer(), nullable=False, server_default=sa.text("1"))
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    change_reason: Mapped[str] = mapped_column(Text(), nullable=False)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )


class IrUserGridPrefs(UUIDPrimaryKeyMixin, Base):
    """Per-user column picker preferences for IR grids."""

    __tablename__ = "ir_user_grid_prefs"
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id", "tenant_id", "grid_key",
            name="uq_ir_user_grid_prefs_user_tenant_grid",
        ),
        {"schema": IR_SCHEMA},
    )

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    grid_key: Mapped[str] = mapped_column(String(80), nullable=False)
    visible_columns_json: Mapped[list[str]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    order_json: Mapped[list[str]] = mapped_column(
        JSONB(astext_type=sa.Text()),
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
