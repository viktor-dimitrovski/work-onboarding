"""Business logic for the Integration Registry module.

Every write operation:
1. Applies the change to the ORM entity
2. Increments `version` on the entity
3. Creates an IrAuditLog snapshot record
4. Uses db.flush() — the caller's request lifecycle commits the transaction
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import os

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.integration_registry import (
    IrAuditLog,
    IrDictionary,
    IrDictionaryItem,
    IrEndpoint,
    IrInstance,
    IrRouteHop,
    IrService,
    IrTenantCrypto,
    IrUserGridPrefs,
)
from app.schemas.integration_registry import (
    IrDictionaryItemCreate,
    IrDictionaryItemUpdate,
    IrEndpointCreate,
    IrEndpointUpdate,
    IrGridPrefsSave,
    IrInstanceCreate,
    IrInstanceUpdate,
    IrOverview,
    IrOverviewRecentItem,
    IrRouteHopCreate,
    IrRouteHopUpdate,
    IrServiceCreate,
    IrServiceUpdate,
)
from app.utils.crypto_at_rest import KdfParams, decrypt_str, derive_key, encrypt_str, fingerprint_key, is_encrypted_value
from app.utils.tenant_keyring import get_key, is_unlocked, lock_tenant, store_key


# ---------------------------------------------------------------------------
# Internal audit helper
# ---------------------------------------------------------------------------

def _write_audit(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    entity_type: str,
    entity_id: uuid.UUID,
    version: int,
    action: str,
    changed_by: uuid.UUID | None,
    change_reason: str,
    snapshot: dict[str, Any],
) -> None:
    log = IrAuditLog(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        entity_type=entity_type,
        entity_id=entity_id,
        version=version,
        action=action,
        changed_by=changed_by,
        changed_at=datetime.now(timezone.utc),
        change_reason=change_reason,
        snapshot_json=snapshot,
    )
    db.add(log)


def _next_audit_version(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    entity_type: str,
    entity_id: uuid.UUID,
) -> int:
    current = (
        db.scalar(
            select(func.max(IrAuditLog.version)).where(
                IrAuditLog.tenant_id == tenant_id,
                IrAuditLog.entity_type == entity_type,
                IrAuditLog.entity_id == entity_id,
            )
        )
        or 0
    )
    return int(current) + 1


KEY_ID = "integration_registry"
KDF_DEFAULTS = KdfParams()


class EncryptionLockedError(RuntimeError):
    pass


class InvalidEncryptionKeyError(RuntimeError):
    pass


class CryptoNotInitializedError(RuntimeError):
    pass


def _aad(tenant_id: uuid.UUID, table: str, column: str) -> bytes:
    return f"{tenant_id}:{table}:{column}".encode("utf-8")


def _encrypt_value(
    value: str | None,
    *,
    tenant_id: uuid.UUID,
    table: str,
    column: str,
    key: bytes,
) -> str | None:
    if value is None:
        return None
    if value == "":
        return ""
    if is_encrypted_value(value):
        return value
    return encrypt_str(value, key, _aad(tenant_id, table, column))


def _decrypt_value(
    value: str | None,
    *,
    tenant_id: uuid.UUID,
    table: str,
    column: str,
    key: bytes,
) -> str | None:
    if value is None:
        return None
    if value == "":
        return ""
    if not is_encrypted_value(value):
        return value
    try:
        return decrypt_str(value, key, _aad(tenant_id, table, column))
    except Exception:
        return None


def get_tenant_key(tenant_id: uuid.UUID) -> bytes | None:
    return get_key(tenant_id, KEY_ID)


def build_instance_read_data(instance: IrInstance, key: bytes | None) -> dict[str, Any]:
    locked = key is None
    tenant_id = instance.tenant_id

    def dec(value: str | None, table: str, column: str) -> str | None:
        if locked:
            return None
        return _decrypt_value(value, tenant_id=tenant_id, table=table, column=column, key=key)

    endpoints: list[dict[str, Any]] = []
    for ep in instance.endpoints or []:
        endpoints.append(
            {
                "id": ep.id,
                "instance_id": ep.instance_id,
                "tenant_id": ep.tenant_id,
                "fqdn": dec(ep.fqdn, "ir_endpoint", "fqdn"),
                "ip": dec(ep.ip, "ir_endpoint", "ip"),
                "port": ep.port,
                "protocol": ep.protocol,
                "base_path": dec(ep.base_path, "ir_endpoint", "base_path"),
                "is_public": ep.is_public,
                "is_primary": ep.is_primary,
                "sort_order": ep.sort_order,
                "created_at": ep.created_at,
                "updated_at": ep.updated_at,
            }
        )

    route_hops: list[dict[str, Any]] = []
    for rh in instance.route_hops or []:
        route_hops.append(
            {
                "id": rh.id,
                "instance_id": rh.instance_id,
                "tenant_id": rh.tenant_id,
                "direction": rh.direction,
                "hop_order": rh.hop_order,
                "label": dec(rh.label, "ir_route_hop", "label"),
                "proxy_chain": dec(rh.proxy_chain, "ir_route_hop", "proxy_chain"),
                "notes": dec(rh.notes, "ir_route_hop", "notes"),
                "created_at": rh.created_at,
            }
        )

    return {
        "id": instance.id,
        "tenant_id": instance.tenant_id,
        "service_id": instance.service_id,
        "service_name": instance.service.name if instance.service else None,
        "env": instance.env,
        "datacenter": instance.datacenter,
        "network_zone": instance.network_zone,
        "status": instance.status,
        "contact": dec(instance.contact, "ir_instance", "contact"),
        "vault_ref": dec(instance.vault_ref, "ir_instance", "vault_ref"),
        "type_settings_json": instance.type_settings_json,
        "tags": instance.tags,
        "notes": dec(instance.notes, "ir_instance", "notes"),
        "version": instance.version,
        "created_at": instance.created_at,
        "updated_at": instance.updated_at,
        "created_by": instance.created_by,
        "updated_by": instance.updated_by,
        "endpoints": endpoints,
        "route_hops": route_hops,
        "encryption_locked": locked,
    }


def build_instance_list_item_data(instance: IrInstance, key: bytes | None) -> dict[str, Any]:
    locked = key is None
    tenant_id = instance.tenant_id

    def dec(value: str | None, table: str, column: str) -> str | None:
        if locked:
            return None
        return _decrypt_value(value, tenant_id=tenant_id, table=table, column=column, key=key)

    primary_endpoint = None
    if not locked:
        eps = instance.endpoints or []
        primary = next((e for e in eps if e.is_primary), None) or (eps[0] if eps else None)
        if primary:
            host = dec(primary.fqdn, "ir_endpoint", "fqdn") or dec(primary.ip, "ir_endpoint", "ip") or ""
            primary_endpoint = f"{host}:{primary.port}" if primary.port else host

    return {
        "id": instance.id,
        "tenant_id": instance.tenant_id,
        "service_id": instance.service_id,
        "service_name": instance.service.name if instance.service else None,
        "env": instance.env,
        "datacenter": instance.datacenter,
        "network_zone": instance.network_zone,
        "status": instance.status,
        "primary_endpoint": primary_endpoint,
        "version": instance.version,
        "updated_at": instance.updated_at,
        "updated_by": instance.updated_by,
        "encryption_locked": locked,
    }

def get_crypto_record(db: Session, *, tenant_id: uuid.UUID) -> IrTenantCrypto | None:
    return db.scalar(
        select(IrTenantCrypto).where(IrTenantCrypto.tenant_id == tenant_id)
    )


def get_crypto_state(db: Session, *, tenant_id: uuid.UUID) -> dict[str, bool]:
    initialized = get_crypto_record(db, tenant_id=tenant_id) is not None
    unlocked = is_unlocked(tenant_id, KEY_ID)
    return {"initialized": initialized, "unlocked": unlocked}


def unlock_tenant_key(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    passphrase: str,
    user_id: uuid.UUID | None,
    reinitialize: bool = False,
) -> IrTenantCrypto:
    record = get_crypto_record(db, tenant_id=tenant_id)
    if record is None or reinitialize:
        salt = os.urandom(16)
        key = derive_key(passphrase, salt, KDF_DEFAULTS)
        fingerprint = fingerprint_key(key)
        if record is None:
            record = IrTenantCrypto(
                tenant_id=tenant_id,
                kdf_salt=salt,
                key_fingerprint=fingerprint,
                kdf_params_json=KDF_DEFAULTS.as_json(),
                created_by=user_id,
                updated_by=user_id,
            )
            db.add(record)
        else:
            record.kdf_salt = salt
            record.key_fingerprint = fingerprint
            record.kdf_params_json = KDF_DEFAULTS.as_json()
            record.updated_by = user_id
        db.flush()
        store_key(tenant_id, KEY_ID, key)
        return record

    try:
        params = record.kdf_params_json or {}
        kdf_params = KdfParams(**params)
    except Exception:
        kdf_params = KDF_DEFAULTS
    key = derive_key(passphrase, record.kdf_salt, kdf_params)
    if fingerprint_key(key) != record.key_fingerprint:
        raise InvalidEncryptionKeyError("Invalid encryption key")
    store_key(tenant_id, KEY_ID, key)
    return record


def require_unlocked_key(db: Session, *, tenant_id: uuid.UUID) -> bytes:
    record = get_crypto_record(db, tenant_id=tenant_id)
    if record is None:
        raise CryptoNotInitializedError("Encryption not initialized")
    key = get_key(tenant_id, KEY_ID)
    if not key:
        raise EncryptionLockedError("Encryption key not loaded")
    return key


def lock_tenant_key(tenant_id: uuid.UUID) -> None:
    lock_tenant(tenant_id, KEY_ID)

def _service_snapshot(svc: IrService) -> dict[str, Any]:
    return {
        "id": str(svc.id),
        "tenant_id": str(svc.tenant_id),
        "name": svc.name,
        "service_type": svc.service_type,
        "owner_team": svc.owner_team,
        "status": svc.status,
        "description": svc.description,
        "tags": svc.tags,
    }


def _instance_snapshot(db: Session, inst: IrInstance) -> dict[str, Any]:
    service_name = db.scalar(select(IrService.name).where(IrService.id == inst.service_id))

    endpoints = list(
        db.scalars(
            select(IrEndpoint)
            .where(IrEndpoint.instance_id == inst.id, IrEndpoint.tenant_id == inst.tenant_id)
            .order_by(IrEndpoint.sort_order, IrEndpoint.created_at)
        ).all()
    )
    route_hops = list(
        db.scalars(
            select(IrRouteHop)
            .where(IrRouteHop.instance_id == inst.id, IrRouteHop.tenant_id == inst.tenant_id)
            .order_by(IrRouteHop.hop_order, IrRouteHop.created_at)
        ).all()
    )

    primary_ep = next((e for e in endpoints if e.is_primary), None) or (endpoints[0] if endpoints else None)
    primary_endpoint: str | None = None
    if primary_ep:
        host = primary_ep.fqdn or primary_ep.ip or ""
        primary_endpoint = f"{host}:{primary_ep.port}" if primary_ep.port else host

    return {
        "id": str(inst.id),
        "tenant_id": str(inst.tenant_id),
        "service_id": str(inst.service_id),
        "service_name": service_name,
        "env": inst.env,
        "datacenter": inst.datacenter,
        "network_zone": inst.network_zone,
        "status": inst.status,
        "contact": inst.contact,
        "vault_ref": inst.vault_ref,
        "type_settings_json": inst.type_settings_json,
        "tags": inst.tags,
        "notes": inst.notes,
        "version": inst.version,
        "primary_endpoint": primary_endpoint,
        "endpoints": [
            {
                "fqdn": e.fqdn,
                "ip": e.ip,
                "port": e.port,
                "protocol": e.protocol,
                "base_path": e.base_path,
                "is_public": e.is_public,
                "is_primary": e.is_primary,
                "sort_order": e.sort_order,
            }
            for e in endpoints
        ],
        "route_hops": [
            {
                "direction": rh.direction,
                "hop_order": rh.hop_order,
                "label": rh.label,
                "proxy_chain": rh.proxy_chain,
                "notes": rh.notes,
            }
            for rh in route_hops
        ],
    }


# ---------------------------------------------------------------------------
# Services (logical catalog)
# ---------------------------------------------------------------------------

def list_services(db: Session, *, tenant_id: uuid.UUID) -> list[IrService]:
    return list(
        db.scalars(
            select(IrService)
            .where(IrService.tenant_id == tenant_id)
            .order_by(IrService.name)
        ).all()
    )


def get_service(db: Session, *, service_id: uuid.UUID, tenant_id: uuid.UUID) -> IrService | None:
    return db.scalar(
        select(IrService).where(
            IrService.id == service_id,
            IrService.tenant_id == tenant_id,
        )
    )


def create_service(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    payload: IrServiceCreate,
    user_id: uuid.UUID | None,
) -> IrService:
    svc = IrService(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        name=payload.name,
        service_type=payload.service_type,
        owner_team=payload.owner_team,
        status=payload.status,
        description=payload.description,
        tags=payload.tags,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(svc)
    db.flush()
    _write_audit(
        db,
        tenant_id=tenant_id,
        entity_type="ir_service",
        entity_id=svc.id,
        version=1,
        action="create",
        changed_by=user_id,
        change_reason=payload.change_reason,
        snapshot=_service_snapshot(svc),
    )
    db.flush()
    return svc


def update_service(
    db: Session,
    *,
    service: IrService,
    payload: IrServiceUpdate,
    user_id: uuid.UUID | None,
) -> IrService:
    if payload.name is not None:
        service.name = payload.name
    if payload.service_type is not None:
        service.service_type = payload.service_type
    if payload.owner_team is not None:
        service.owner_team = payload.owner_team
    if payload.status is not None:
        service.status = payload.status
    if payload.description is not None:
        service.description = payload.description
    if payload.tags is not None:
        service.tags = payload.tags
    service.updated_by = user_id
    db.flush()
    version = _next_audit_version(
        db,
        tenant_id=service.tenant_id,
        entity_type="ir_service",
        entity_id=service.id,
    )
    _write_audit(
        db,
        tenant_id=service.tenant_id,
        entity_type="ir_service",
        entity_id=service.id,
        version=version,
        action="update",
        changed_by=user_id,
        change_reason=payload.change_reason,
        snapshot=_service_snapshot(service),
    )
    db.flush()
    return service


# ---------------------------------------------------------------------------
# Instances
# ---------------------------------------------------------------------------

def list_instances(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    env: str | None = None,
    datacenter: str | None = None,
    service_type: str | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[IrInstance], int]:
    q = (
        select(IrInstance)
        .join(IrService, IrInstance.service_id == IrService.id)
        .options(
            selectinload(IrInstance.service),
            selectinload(IrInstance.endpoints),
        )
        .where(IrInstance.tenant_id == tenant_id)
    )
    if env:
        q = q.where(IrInstance.env == env)
    if datacenter:
        q = q.where(IrInstance.datacenter == datacenter)
    if status:
        q = q.where(IrInstance.status == status)
    if service_type:
        q = q.join(IrService, IrInstance.service_id == IrService.id, isouter=True).where(
            IrService.service_type == service_type
        )
    if search:
        pattern = f"%{search.lower()}%"
        q = q.where(
            or_(
                func.lower(IrService.name).like(pattern),
                func.lower(IrInstance.datacenter).like(pattern),
                func.lower(IrInstance.network_zone).like(pattern),
            )
        )

    count_q = select(func.count()).select_from(q.subquery())
    total = db.scalar(count_q) or 0

    q = q.order_by(IrInstance.updated_at.desc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    rows = list(db.scalars(q).all())
    return rows, total


def get_instance_detail(
    db: Session, *, instance_id: uuid.UUID, tenant_id: uuid.UUID
) -> IrInstance | None:
    return db.scalar(
        select(IrInstance)
        .options(
            selectinload(IrInstance.service),
            selectinload(IrInstance.endpoints),
            selectinload(IrInstance.route_hops),
        )
        .where(
            IrInstance.id == instance_id,
            IrInstance.tenant_id == tenant_id,
        )
    )


def create_instance(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    payload: IrInstanceCreate,
    user_id: uuid.UUID | None,
) -> IrInstance:
    key = require_unlocked_key(db, tenant_id=tenant_id)
    inst = IrInstance(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        service_id=payload.service_id,
        env=payload.env,
        datacenter=payload.datacenter,
        network_zone=payload.network_zone,
        status=payload.status,
        contact=_encrypt_value(payload.contact, tenant_id=tenant_id, table="ir_instance", column="contact", key=key),
        vault_ref=_encrypt_value(
            payload.vault_ref, tenant_id=tenant_id, table="ir_instance", column="vault_ref", key=key
        ),
        type_settings_json=payload.type_settings_json,
        tags=payload.tags,
        notes=_encrypt_value(payload.notes, tenant_id=tenant_id, table="ir_instance", column="notes", key=key),
        version=1,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(inst)
    db.flush()

    for i, ep in enumerate(payload.endpoints):
        _add_endpoint(db, instance=inst, payload=ep, sort_order=i, key=key)

    for i, rh in enumerate(payload.route_hops):
        _add_route_hop(db, instance=inst, payload=rh, hop_order=i, key=key)

    db.flush()
    _write_audit(
        db,
        tenant_id=tenant_id,
        entity_type="ir_connection",
        entity_id=inst.id,
        version=1,
        action="create",
        changed_by=user_id,
        change_reason=payload.change_reason,
        snapshot=_instance_snapshot(db, inst),
    )
    db.flush()
    return inst


def update_instance(
    db: Session,
    *,
    instance: IrInstance,
    payload: IrInstanceUpdate,
    user_id: uuid.UUID | None,
) -> IrInstance:
    key = require_unlocked_key(db, tenant_id=instance.tenant_id)
    if payload.env is not None:
        instance.env = payload.env
    if payload.datacenter is not None:
        instance.datacenter = payload.datacenter
    if payload.network_zone is not None:
        instance.network_zone = payload.network_zone
    if payload.status is not None:
        instance.status = payload.status
    if payload.contact is not None:
        instance.contact = _encrypt_value(
            payload.contact, tenant_id=instance.tenant_id, table="ir_instance", column="contact", key=key
        )
    if payload.vault_ref is not None:
        instance.vault_ref = _encrypt_value(
            payload.vault_ref, tenant_id=instance.tenant_id, table="ir_instance", column="vault_ref", key=key
        )
    if payload.type_settings_json is not None:
        instance.type_settings_json = payload.type_settings_json
    if payload.tags is not None:
        instance.tags = payload.tags
    if payload.notes is not None:
        instance.notes = _encrypt_value(
            payload.notes, tenant_id=instance.tenant_id, table="ir_instance", column="notes", key=key
        )
    if payload.endpoints is not None:
        # Replace endpoints as a whole (MVP approach).
        existing_eps = list(
            db.scalars(
                select(IrEndpoint).where(
                    IrEndpoint.instance_id == instance.id,
                    IrEndpoint.tenant_id == instance.tenant_id,
                )
            ).all()
        )
        for ep in existing_eps:
            db.delete(ep)
        db.flush()
        for i, ep in enumerate(payload.endpoints):
            _add_endpoint(db, instance=instance, payload=ep, sort_order=i, key=key)

    if payload.route_hops is not None:
        existing_hops = list(
            db.scalars(
                select(IrRouteHop).where(
                    IrRouteHop.instance_id == instance.id,
                    IrRouteHop.tenant_id == instance.tenant_id,
                )
            ).all()
        )
        for rh in existing_hops:
            db.delete(rh)
        db.flush()
        for i, rh in enumerate(payload.route_hops):
            _add_route_hop(db, instance=instance, payload=rh, hop_order=i, key=key)
    instance.version = (instance.version or 1) + 1
    instance.updated_by = user_id
    db.flush()
    _write_audit(
        db,
        tenant_id=instance.tenant_id,
        entity_type="ir_connection",
        entity_id=instance.id,
        version=instance.version,
        action="update",
        changed_by=user_id,
        change_reason=payload.change_reason,
        snapshot=_instance_snapshot(db, instance),
    )
    db.flush()
    return instance


def clone_instance_to_prod(
    db: Session,
    *,
    source: IrInstance,
    user_id: uuid.UUID | None,
    change_reason: str,
) -> IrInstance:
    """Clone a UAT instance to PROD with status 'draft'."""
    key = require_unlocked_key(db, tenant_id=source.tenant_id)
    new_inst = IrInstance(
        id=uuid.uuid4(),
        tenant_id=source.tenant_id,
        service_id=source.service_id,
        env="PROD",
        datacenter=source.datacenter,
        network_zone=source.network_zone,
        status="draft",
        contact=_encrypt_value(
            source.contact, tenant_id=source.tenant_id, table="ir_instance", column="contact", key=key
        ),
        vault_ref=None,
        type_settings_json=dict(source.type_settings_json),
        tags=list(source.tags),
        notes=_encrypt_value(
            f"Cloned from UAT instance {source.id}.",
            tenant_id=source.tenant_id,
            table="ir_instance",
            column="notes",
            key=key,
        ),
        version=1,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(new_inst)
    db.flush()

    for ep in source.endpoints:
        _add_endpoint(
            db,
            instance=new_inst,
            payload=IrEndpointCreate(
                fqdn=ep.fqdn,
                ip=ep.ip,
                port=ep.port,
                protocol=ep.protocol,
                base_path=ep.base_path,
                is_public=ep.is_public,
                is_primary=ep.is_primary,
                sort_order=ep.sort_order,
            ),
            sort_order=ep.sort_order,
            key=key,
        )

    for rh in source.route_hops:
        _add_route_hop(
            db,
            instance=new_inst,
            payload=IrRouteHopCreate(
                direction=rh.direction,
                hop_order=rh.hop_order,
                label=rh.label,
                proxy_chain=rh.proxy_chain,
                notes=rh.notes,
            ),
            hop_order=rh.hop_order,
            key=key,
        )

    db.flush()
    _write_audit(
        db,
        tenant_id=new_inst.tenant_id,
        entity_type="ir_connection",
        entity_id=new_inst.id,
        version=1,
        action="create",
        changed_by=user_id,
        change_reason=change_reason,
        snapshot=_instance_snapshot(db, new_inst),
    )
    db.flush()
    return new_inst


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _add_endpoint(
    db: Session,
    *,
    instance: IrInstance,
    payload: IrEndpointCreate,
    sort_order: int = 0,
    key: bytes,
) -> IrEndpoint:
    ep = IrEndpoint(
        id=uuid.uuid4(),
        instance_id=instance.id,
        tenant_id=instance.tenant_id,
        fqdn=_encrypt_value(
            payload.fqdn, tenant_id=instance.tenant_id, table="ir_endpoint", column="fqdn", key=key
        ),
        ip=_encrypt_value(
            payload.ip, tenant_id=instance.tenant_id, table="ir_endpoint", column="ip", key=key
        ),
        port=payload.port,
        protocol=payload.protocol,
        base_path=_encrypt_value(
            payload.base_path, tenant_id=instance.tenant_id, table="ir_endpoint", column="base_path", key=key
        ),
        is_public=payload.is_public,
        is_primary=payload.is_primary,
        sort_order=sort_order,
    )
    db.add(ep)
    return ep


def create_endpoint(
    db: Session,
    *,
    instance: IrInstance,
    payload: IrEndpointCreate,
) -> IrEndpoint:
    key = require_unlocked_key(db, tenant_id=instance.tenant_id)
    ep = _add_endpoint(db, instance=instance, payload=payload, sort_order=payload.sort_order, key=key)
    db.flush()
    return ep


def update_endpoint(
    db: Session,
    *,
    endpoint: IrEndpoint,
    payload: IrEndpointUpdate,
) -> IrEndpoint:
    key = require_unlocked_key(db, tenant_id=endpoint.tenant_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field in ("fqdn", "ip", "base_path"):
            setattr(
                endpoint,
                field,
                _encrypt_value(
                    value, tenant_id=endpoint.tenant_id, table="ir_endpoint", column=field, key=key
                ),
            )
        else:
            setattr(endpoint, field, value)
    db.flush()
    return endpoint


def delete_endpoint(db: Session, *, endpoint: IrEndpoint) -> None:
    db.delete(endpoint)
    db.flush()


def get_endpoint(
    db: Session, *, endpoint_id: uuid.UUID, tenant_id: uuid.UUID
) -> IrEndpoint | None:
    return db.scalar(
        select(IrEndpoint).where(
            IrEndpoint.id == endpoint_id,
            IrEndpoint.tenant_id == tenant_id,
        )
    )


# ---------------------------------------------------------------------------
# Route Hops
# ---------------------------------------------------------------------------

def _add_route_hop(
    db: Session,
    *,
    instance: IrInstance,
    payload: IrRouteHopCreate,
    hop_order: int = 0,
    key: bytes,
) -> IrRouteHop:
    rh = IrRouteHop(
        id=uuid.uuid4(),
        instance_id=instance.id,
        tenant_id=instance.tenant_id,
        direction=payload.direction,
        hop_order=hop_order,
        label=_encrypt_value(
            payload.label, tenant_id=instance.tenant_id, table="ir_route_hop", column="label", key=key
        ),
        proxy_chain=_encrypt_value(
            payload.proxy_chain,
            tenant_id=instance.tenant_id,
            table="ir_route_hop",
            column="proxy_chain",
            key=key,
        ),
        notes=_encrypt_value(
            payload.notes, tenant_id=instance.tenant_id, table="ir_route_hop", column="notes", key=key
        ),
    )
    db.add(rh)
    return rh


def create_route_hop(
    db: Session,
    *,
    instance: IrInstance,
    payload: IrRouteHopCreate,
) -> IrRouteHop:
    key = require_unlocked_key(db, tenant_id=instance.tenant_id)
    rh = _add_route_hop(
        db, instance=instance, payload=payload, hop_order=payload.hop_order, key=key
    )
    db.flush()
    return rh


def update_route_hop(
    db: Session,
    *,
    route_hop: IrRouteHop,
    payload: IrRouteHopUpdate,
) -> IrRouteHop:
    key = require_unlocked_key(db, tenant_id=route_hop.tenant_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field in ("label", "proxy_chain", "notes"):
            setattr(
                route_hop,
                field,
                _encrypt_value(
                    value,
                    tenant_id=route_hop.tenant_id,
                    table="ir_route_hop",
                    column=field,
                    key=key,
                ),
            )
        else:
            setattr(route_hop, field, value)
    db.flush()
    return route_hop


def delete_route_hop(db: Session, *, route_hop: IrRouteHop) -> None:
    db.delete(route_hop)
    db.flush()


def get_route_hop(
    db: Session, *, hop_id: uuid.UUID, tenant_id: uuid.UUID
) -> IrRouteHop | None:
    return db.scalar(
        select(IrRouteHop).where(
            IrRouteHop.id == hop_id,
            IrRouteHop.tenant_id == tenant_id,
        )
    )


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

def list_audit_log(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[IrAuditLog], int]:
    q = select(IrAuditLog).where(IrAuditLog.tenant_id == tenant_id)
    if entity_type:
        if entity_type == "ir_connection":
            q = q.where(IrAuditLog.entity_type.in_(["ir_connection", "ir_instance"]))
        else:
            q = q.where(IrAuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(IrAuditLog.entity_id == entity_id)

    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    q = q.order_by(IrAuditLog.changed_at.desc()).offset((page - 1) * page_size).limit(page_size)
    return list(db.scalars(q).all()), total


def get_instance_history(
    db: Session,
    *,
    instance_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[IrAuditLog]:
    return list(
        db.scalars(
            select(IrAuditLog)
            .where(
                IrAuditLog.tenant_id == tenant_id,
                IrAuditLog.entity_type.in_(["ir_connection", "ir_instance"]),
                IrAuditLog.entity_id == instance_id,
            )
            .order_by(IrAuditLog.version.desc())
        ).all()
    )


# ---------------------------------------------------------------------------
# Dictionaries
# ---------------------------------------------------------------------------

def list_dictionaries(db: Session, *, tenant_id: uuid.UUID) -> list[IrDictionary]:
    """Return global dictionaries plus any tenant-scoped ones."""
    return list(
        db.scalars(
            select(IrDictionary)
            .where(
                or_(
                    IrDictionary.is_global.is_(True),
                    IrDictionary.tenant_id == tenant_id,
                )
            )
            .order_by(IrDictionary.name)
        ).all()
    )


def get_dictionary_by_key(
    db: Session, *, key: str, tenant_id: uuid.UUID
) -> IrDictionary | None:
    return db.scalar(
        select(IrDictionary).where(
            IrDictionary.key == key,
            or_(
                IrDictionary.is_global.is_(True),
                IrDictionary.tenant_id == tenant_id,
            ),
        )
    )


def get_dictionary_items(
    db: Session, *, dictionary_id: uuid.UUID, active_only: bool = True
) -> list[IrDictionaryItem]:
    q = select(IrDictionaryItem).where(IrDictionaryItem.dictionary_id == dictionary_id)
    if active_only:
        q = q.where(IrDictionaryItem.is_active.is_(True))
    return list(db.scalars(q.order_by(IrDictionaryItem.sort_order, IrDictionaryItem.label)).all())


def create_dictionary_item(
    db: Session,
    *,
    dictionary: IrDictionary,
    payload: IrDictionaryItemCreate,
    user_id: uuid.UUID | None,
) -> IrDictionaryItem:
    item = IrDictionaryItem(
        id=uuid.uuid4(),
        dictionary_id=dictionary.id,
        code=payload.code,
        label=payload.label,
        is_active=True,
        sort_order=payload.sort_order,
        meta_json=payload.meta_json,
        created_by=user_id,
    )
    db.add(item)
    db.flush()
    return item


def update_dictionary_item(
    db: Session,
    *,
    item: IrDictionaryItem,
    payload: IrDictionaryItemUpdate,
) -> IrDictionaryItem:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.flush()
    return item


def get_dictionary_item(
    db: Session, *, item_id: uuid.UUID
) -> IrDictionaryItem | None:
    return db.scalar(
        select(IrDictionaryItem).where(IrDictionaryItem.id == item_id)
    )


# ---------------------------------------------------------------------------
# User grid preferences
# ---------------------------------------------------------------------------

def get_grid_prefs(
    db: Session, *, user_id: uuid.UUID, tenant_id: uuid.UUID, grid_key: str
) -> IrUserGridPrefs | None:
    return db.scalar(
        select(IrUserGridPrefs).where(
            IrUserGridPrefs.user_id == user_id,
            IrUserGridPrefs.tenant_id == tenant_id,
            IrUserGridPrefs.grid_key == grid_key,
        )
    )


def save_grid_prefs(
    db: Session,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    grid_key: str,
    payload: IrGridPrefsSave,
) -> IrUserGridPrefs:
    prefs = get_grid_prefs(db, user_id=user_id, tenant_id=tenant_id, grid_key=grid_key)
    if prefs is None:
        prefs = IrUserGridPrefs(
            id=uuid.uuid4(),
            user_id=user_id,
            tenant_id=tenant_id,
            grid_key=grid_key,
        )
        db.add(prefs)
    prefs.visible_columns_json = payload.visible_columns
    prefs.order_json = payload.order
    db.flush()
    return prefs


# ---------------------------------------------------------------------------
# Overview / dashboard
# ---------------------------------------------------------------------------

def get_overview(db: Session, *, tenant_id: uuid.UUID) -> IrOverview:
    instances = list(
        db.scalars(
            select(IrInstance)
            .options(selectinload(IrInstance.service))
            .where(IrInstance.tenant_id == tenant_id)
        ).all()
    )
    total = len(instances)
    uat_count = sum(1 for i in instances if i.env == "UAT")
    prod_count = sum(1 for i in instances if i.env == "PROD")
    draft_count = sum(1 for i in instances if i.status == "draft")
    active_count = sum(1 for i in instances if i.status == "active")

    service_count = db.scalar(
        select(func.count(IrService.id)).where(IrService.tenant_id == tenant_id)
    ) or 0

    recent_instances = list(
        db.scalars(
            select(IrInstance)
            .options(selectinload(IrInstance.service))
            .where(IrInstance.tenant_id == tenant_id)
            .order_by(IrInstance.updated_at.desc())
            .limit(5)
        ).all()
    )
    recently_changed: list[IrOverviewRecentItem] = [
        IrOverviewRecentItem(
            instance_id=i.id,
            service_name=i.service.name if i.service else "",
            env=i.env,
            status=i.status,
            changed_at=i.updated_at,
            changed_by=i.updated_by,
        )
        for i in recent_instances
    ]

    return IrOverview(
        total=total,
        uat_count=uat_count,
        prod_count=prod_count,
        draft_count=draft_count,
        active_count=active_count,
        service_count=service_count,
        recently_changed=recently_changed,
    )
