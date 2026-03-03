"""REST API endpoints for the Integration Registry module."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext
from app.multitenancy.permissions import require_access
from app.schemas.integration_registry import (
    IrAuditLogRead,
    IrCryptoSettings,
    IrCryptoUnlockRequest,
    IrDictionaryItemCreate,
    IrDictionaryItemRead,
    IrDictionaryItemUpdate,
    IrDictionaryRead,
    IrEndpointCreate,
    IrEndpointRead,
    IrEndpointUpdate,
    IrGridPrefsRead,
    IrGridPrefsSave,
    IrInstanceCreate,
    IrInstanceListResponse,
    IrInstanceListRead,
    IrInstanceRead,
    IrInstanceUpdate,
    IrOverview,
    IrRouteHopCreate,
    IrRouteHopRead,
    IrRouteHopUpdate,
    IrServiceCreate,
    IrServiceListRead,
    IrServiceRead,
    IrServiceUpdate,
)
from app.services import integration_registry_service as svc

router = APIRouter(prefix="/integration-registry", tags=["integration-registry"])

MODULE_KEY = "integration_registry"


def _require_read() -> TenantContext:
    return require_access(MODULE_KEY, "ir:read")


def _require_write() -> TenantContext:
    return require_access(MODULE_KEY, "ir:write")


def _require_approve() -> TenantContext:
    return require_access(MODULE_KEY, "ir:approve")


def _require_admin() -> TenantContext:
    return require_access(MODULE_KEY, "ir:admin")


def _raise_crypto_error(exc: Exception) -> None:
    if isinstance(exc, svc.CryptoNotInitializedError):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Encryption not initialized. Admin must set key in Integration Registry settings.",
        )
    if isinstance(exc, svc.EncryptionLockedError):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Encryption key not loaded. Admin must unlock in Integration Registry settings.",
        )
    if isinstance(exc, svc.InvalidEncryptionKeyError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid encryption key")
    raise exc


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@router.get("/overview", response_model=IrOverview)
def get_overview(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> IrOverview:
    return svc.get_overview(db, tenant_id=ctx.tenant.id)


# ---------------------------------------------------------------------------
# Encryption Settings
# ---------------------------------------------------------------------------


@router.get("/settings", response_model=IrCryptoSettings)
def get_crypto_settings(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> IrCryptoSettings:
    record = svc.get_crypto_record(db, tenant_id=ctx.tenant.id)
    state = svc.get_crypto_state(db, tenant_id=ctx.tenant.id)
    return IrCryptoSettings(
        initialized=state["initialized"],
        unlocked=state["unlocked"],
        key_fingerprint=record.key_fingerprint if record else None,
        kdf_params=record.kdf_params_json if record else None,
    )


@router.post("/settings/unlock", response_model=IrCryptoSettings)
def unlock_crypto(
    payload: IrCryptoUnlockRequest,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_admin()),
    current_user: User = Depends(get_current_active_user),
) -> IrCryptoSettings:
    try:
        record = svc.unlock_tenant_key(
            db,
            tenant_id=ctx.tenant.id,
            passphrase=payload.passphrase,
            user_id=current_user.id,
            reinitialize=payload.reinitialize,
        )
        db.commit()
    except Exception as exc:
        _raise_crypto_error(exc)
    return IrCryptoSettings(
        initialized=True,
        unlocked=True,
        key_fingerprint=record.key_fingerprint if record else None,
        kdf_params=record.kdf_params_json if record else None,
    )


@router.post("/settings/lock", response_model=IrCryptoSettings)
def lock_crypto(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_admin()),
) -> IrCryptoSettings:
    svc.lock_tenant_key(ctx.tenant.id)
    record = svc.get_crypto_record(db, tenant_id=ctx.tenant.id)
    state = svc.get_crypto_state(db, tenant_id=ctx.tenant.id)
    return IrCryptoSettings(
        initialized=state["initialized"],
        unlocked=state["unlocked"],
        key_fingerprint=record.key_fingerprint if record else None,
        kdf_params=record.kdf_params_json if record else None,
    )


# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

@router.get("/services", response_model=list[IrServiceListRead])
def list_services(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> list[IrServiceListRead]:
    services = svc.list_services(db, tenant_id=ctx.tenant.id)
    result: list[IrServiceListRead] = []
    for s in services:
        result.append(
            IrServiceListRead(
                id=s.id,
                name=s.name,
                service_type=s.service_type,
                owner_team=s.owner_team,
                status=s.status,
                instance_count=len(s.instances) if s.instances else 0,
            )
        )
    return result


@router.post("/services", response_model=IrServiceRead, status_code=status.HTTP_201_CREATED)
def create_service(
    payload: IrServiceCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
    current_user: User = Depends(get_current_active_user),
) -> IrServiceRead:
    service = svc.create_service(
        db,
        tenant_id=ctx.tenant.id,
        payload=payload,
        user_id=current_user.id,
    )
    db.commit()
    db.refresh(service)
    return IrServiceRead.model_validate(service)


@router.get("/services/{service_id}", response_model=IrServiceRead)
def get_service(
    service_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> IrServiceRead:
    service = svc.get_service(db, service_id=service_id, tenant_id=ctx.tenant.id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    return IrServiceRead.model_validate(service)


@router.put("/services/{service_id}", response_model=IrServiceRead)
def update_service(
    service_id: uuid.UUID,
    payload: IrServiceUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
    current_user: User = Depends(get_current_active_user),
) -> IrServiceRead:
    service = svc.get_service(db, service_id=service_id, tenant_id=ctx.tenant.id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    service = svc.update_service(db, service=service, payload=payload, user_id=current_user.id)
    db.commit()
    db.refresh(service)
    return IrServiceRead.model_validate(service)


# ---------------------------------------------------------------------------
# Instances
# ---------------------------------------------------------------------------

@router.get("/instances", response_model=IrInstanceListResponse)
def list_instances(
    env: str | None = Query(default=None),
    datacenter: str | None = Query(default=None),
    service_type: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> IrInstanceListResponse:
    rows, total = svc.list_instances(
        db,
        tenant_id=ctx.tenant.id,
        env=env,
        datacenter=datacenter,
        service_type=service_type,
        status=status_filter,
        search=search,
        page=page,
        page_size=page_size,
    )
    key = svc.get_tenant_key(ctx.tenant.id)
    items: list[IrInstanceListRead] = [
        IrInstanceListRead(**svc.build_instance_list_item_data(inst, key))
        for inst in rows
    ]

    return IrInstanceListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/instances", response_model=IrInstanceRead, status_code=status.HTTP_201_CREATED)
def create_instance(
    payload: IrInstanceCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
    current_user: User = Depends(get_current_active_user),
) -> IrInstanceRead:
    if payload.env == "PROD":
        _check_approve_permission(ctx)
    try:
        instance = svc.create_instance(
            db,
            tenant_id=ctx.tenant.id,
            payload=payload,
            user_id=current_user.id,
        )
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    instance = svc.get_instance_detail(db, instance_id=instance.id, tenant_id=ctx.tenant.id)
    key = svc.get_tenant_key(ctx.tenant.id)
    return IrInstanceRead(**svc.build_instance_read_data(instance, key))


@router.get("/instances/{instance_id}", response_model=IrInstanceRead)
def get_instance(
    instance_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> IrInstanceRead:
    instance = svc.get_instance_detail(db, instance_id=instance_id, tenant_id=ctx.tenant.id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    key = svc.get_tenant_key(ctx.tenant.id)
    return IrInstanceRead(**svc.build_instance_read_data(instance, key))


@router.put("/instances/{instance_id}", response_model=IrInstanceRead)
def update_instance(
    instance_id: uuid.UUID,
    payload: IrInstanceUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
    current_user: User = Depends(get_current_active_user),
) -> IrInstanceRead:
    instance = svc.get_instance_detail(db, instance_id=instance_id, tenant_id=ctx.tenant.id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    try:
        instance = svc.update_instance(db, instance=instance, payload=payload, user_id=current_user.id)
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    instance = svc.get_instance_detail(db, instance_id=instance_id, tenant_id=ctx.tenant.id)
    key = svc.get_tenant_key(ctx.tenant.id)
    return IrInstanceRead(**svc.build_instance_read_data(instance, key))


@router.post("/instances/{instance_id}/clone-to-prod", response_model=IrInstanceRead, status_code=status.HTTP_201_CREATED)
def clone_to_prod(
    instance_id: uuid.UUID,
    change_reason: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_approve()),
    current_user: User = Depends(get_current_active_user),
) -> IrInstanceRead:
    source = svc.get_instance_detail(db, instance_id=instance_id, tenant_id=ctx.tenant.id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    if source.env != "UAT":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only UAT instances can be cloned to PROD")
    try:
        new_instance = svc.clone_instance_to_prod(
            db, source=source, user_id=current_user.id, change_reason=change_reason
        )
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    new_instance = svc.get_instance_detail(db, instance_id=new_instance.id, tenant_id=ctx.tenant.id)
    key = svc.get_tenant_key(ctx.tenant.id)
    return IrInstanceRead(**svc.build_instance_read_data(new_instance, key))


@router.get("/instances/{instance_id}/history", response_model=list[IrAuditLogRead])
def get_instance_history(
    instance_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> list[IrAuditLogRead]:
    logs = svc.get_instance_history(db, instance_id=instance_id, tenant_id=ctx.tenant.id)
    return [IrAuditLogRead.model_validate(log) for log in logs]


# ---------------------------------------------------------------------------
# Endpoints (sub-resource of Instance)
# ---------------------------------------------------------------------------

@router.post("/instances/{instance_id}/endpoints", response_model=IrEndpointRead, status_code=status.HTTP_201_CREATED)
def create_endpoint(
    instance_id: uuid.UUID,
    payload: IrEndpointCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
    current_user: User = Depends(get_current_active_user),
) -> IrEndpointRead:
    instance = _get_instance_or_404(db, instance_id, ctx.tenant.id)
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    try:
        ep = svc.create_endpoint(db, instance=instance, payload=payload)
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    db.refresh(ep)
    return IrEndpointRead.model_validate(ep)


@router.put("/instances/{instance_id}/endpoints/{endpoint_id}", response_model=IrEndpointRead)
def update_endpoint(
    instance_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    payload: IrEndpointUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
) -> IrEndpointRead:
    instance = _get_instance_or_404(db, instance_id, ctx.tenant.id)
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    ep = svc.get_endpoint(db, endpoint_id=endpoint_id, tenant_id=ctx.tenant.id)
    if not ep or ep.instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found")
    try:
        ep = svc.update_endpoint(db, endpoint=ep, payload=payload)
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    db.refresh(ep)
    return IrEndpointRead.model_validate(ep)


@router.delete("/instances/{instance_id}/endpoints/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_endpoint(
    instance_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
) -> Response:
    instance = _get_instance_or_404(db, instance_id, ctx.tenant.id)
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    ep = svc.get_endpoint(db, endpoint_id=endpoint_id, tenant_id=ctx.tenant.id)
    if not ep or ep.instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found")
    svc.delete_endpoint(db, endpoint=ep)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Route Hops (sub-resource of Instance)
# ---------------------------------------------------------------------------

@router.post("/instances/{instance_id}/route-hops", response_model=IrRouteHopRead, status_code=status.HTTP_201_CREATED)
def create_route_hop(
    instance_id: uuid.UUID,
    payload: IrRouteHopCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
) -> IrRouteHopRead:
    instance = _get_instance_or_404(db, instance_id, ctx.tenant.id)
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    try:
        rh = svc.create_route_hop(db, instance=instance, payload=payload)
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    db.refresh(rh)
    return IrRouteHopRead.model_validate(rh)


@router.put("/instances/{instance_id}/route-hops/{hop_id}", response_model=IrRouteHopRead)
def update_route_hop(
    instance_id: uuid.UUID,
    hop_id: uuid.UUID,
    payload: IrRouteHopUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
) -> IrRouteHopRead:
    instance = _get_instance_or_404(db, instance_id, ctx.tenant.id)
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    rh = svc.get_route_hop(db, hop_id=hop_id, tenant_id=ctx.tenant.id)
    if not rh or rh.instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route hop not found")
    try:
        rh = svc.update_route_hop(db, route_hop=rh, payload=payload)
    except Exception as exc:
        _raise_crypto_error(exc)
    db.commit()
    db.refresh(rh)
    return IrRouteHopRead.model_validate(rh)


@router.delete("/instances/{instance_id}/route-hops/{hop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route_hop(
    instance_id: uuid.UUID,
    hop_id: uuid.UUID,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
) -> Response:
    instance = _get_instance_or_404(db, instance_id, ctx.tenant.id)
    if instance.env == "PROD":
        _check_approve_permission(ctx)
    rh = svc.get_route_hop(db, hop_id=hop_id, tenant_id=ctx.tenant.id)
    if not rh or rh.instance_id != instance_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route hop not found")
    svc.delete_route_hop(db, route_hop=rh)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@router.get("/audit-log", response_model=list[IrAuditLogRead])
def get_audit_log(
    entity_type: str | None = Query(default=None),
    entity_id: uuid.UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> list[IrAuditLogRead]:
    logs, _ = svc.list_audit_log(
        db,
        tenant_id=ctx.tenant.id,
        entity_type=entity_type,
        entity_id=entity_id,
        page=page,
        page_size=page_size,
    )
    return [IrAuditLogRead.model_validate(log) for log in logs]


# ---------------------------------------------------------------------------
# Dictionaries
# ---------------------------------------------------------------------------

@router.get("/dictionaries", response_model=list[IrDictionaryRead])
def list_dictionaries(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> list[IrDictionaryRead]:
    dicts = svc.list_dictionaries(db, tenant_id=ctx.tenant.id)
    return [IrDictionaryRead.model_validate(d) for d in dicts]


@router.get("/dictionaries/{key}/items", response_model=list[IrDictionaryItemRead])
def list_dictionary_items(
    key: str,
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
) -> list[IrDictionaryItemRead]:
    dictionary = svc.get_dictionary_by_key(db, key=key, tenant_id=ctx.tenant.id)
    if not dictionary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dictionary not found")
    items = svc.get_dictionary_items(db, dictionary_id=dictionary.id, active_only=active_only)
    return [IrDictionaryItemRead.model_validate(item) for item in items]


@router.post("/dictionaries/{key}/items", response_model=IrDictionaryItemRead, status_code=status.HTTP_201_CREATED)
def create_dictionary_item(
    key: str,
    payload: IrDictionaryItemCreate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
    current_user: User = Depends(get_current_active_user),
) -> IrDictionaryItemRead:
    dictionary = svc.get_dictionary_by_key(db, key=key, tenant_id=ctx.tenant.id)
    if not dictionary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dictionary not found")
    if not dictionary.is_addable:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This dictionary does not allow adding new items",
        )
    item = svc.create_dictionary_item(
        db, dictionary=dictionary, payload=payload, user_id=current_user.id
    )
    db.commit()
    db.refresh(item)
    return IrDictionaryItemRead.model_validate(item)


@router.patch("/dictionaries/{key}/items/{item_id}", response_model=IrDictionaryItemRead)
def update_dictionary_item(
    key: str,
    item_id: uuid.UUID,
    payload: IrDictionaryItemUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_write()),
) -> IrDictionaryItemRead:
    dictionary = svc.get_dictionary_by_key(db, key=key, tenant_id=ctx.tenant.id)
    if not dictionary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dictionary not found")
    item = svc.get_dictionary_item(db, item_id=item_id)
    if not item or item.dictionary_id != dictionary.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dictionary item not found")
    item = svc.update_dictionary_item(db, item=item, payload=payload)
    db.commit()
    db.refresh(item)
    return IrDictionaryItemRead.model_validate(item)


# ---------------------------------------------------------------------------
# User Grid Preferences
# ---------------------------------------------------------------------------

@router.get("/grid-prefs/{grid_key}", response_model=IrGridPrefsRead)
def get_grid_prefs(
    grid_key: str,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
    current_user: User = Depends(get_current_active_user),
) -> IrGridPrefsRead:
    prefs = svc.get_grid_prefs(
        db, user_id=current_user.id, tenant_id=ctx.tenant.id, grid_key=grid_key
    )
    if not prefs:
        return IrGridPrefsRead(grid_key=grid_key, visible_columns=[], order=[])
    return IrGridPrefsRead(
        grid_key=prefs.grid_key,
        visible_columns=prefs.visible_columns_json or [],
        order=prefs.order_json or [],
    )


@router.put("/grid-prefs/{grid_key}", response_model=IrGridPrefsRead)
def save_grid_prefs(
    grid_key: str,
    payload: IrGridPrefsSave,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(_require_read()),
    current_user: User = Depends(get_current_active_user),
) -> IrGridPrefsRead:
    prefs = svc.save_grid_prefs(
        db,
        user_id=current_user.id,
        tenant_id=ctx.tenant.id,
        grid_key=grid_key,
        payload=payload,
    )
    db.commit()
    db.refresh(prefs)
    return IrGridPrefsRead(
        grid_key=prefs.grid_key,
        visible_columns=prefs.visible_columns_json or [],
        order=prefs.order_json or [],
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_instance_or_404(db: Session, instance_id: uuid.UUID, tenant_id: uuid.UUID):
    from app.models.integration_registry import IrInstance as _IrInstance
    from sqlalchemy import select as _select
    from sqlalchemy.orm import selectinload as _sil

    instance = db.scalar(
        _select(_IrInstance)
        .options(_sil(_IrInstance.endpoints), _sil(_IrInstance.route_hops))
        .where(
            _IrInstance.id == instance_id,
            _IrInstance.tenant_id == tenant_id,
        )
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found")
    return instance


def _check_approve_permission(ctx: TenantContext) -> None:
    from app.multitenancy.permissions import permissions_for_roles
    perms = permissions_for_roles(ctx.roles)
    if "ir:approve" not in perms and "ir:admin" not in perms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PROD changes require Approver or Admin role",
        )


