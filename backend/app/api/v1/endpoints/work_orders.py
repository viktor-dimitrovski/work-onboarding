from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_db
from app.models.release_mgmt import ReleaseWorkOrder, ReleaseWorkOrderService
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.settings import WorkOrdersGitHubSettings
from app.schemas.work_orders import (
    ServiceTouchedItem,
    WorkOrderDraft,
    WorkOrderListResponse,
    WorkOrderOut,
    WorkOrderParsed,
    WorkOrderSummary,
)
from app.services import github_repo_service, release_mgmt_sync_service, work_order_service


router = APIRouter(prefix="/work-orders", tags=["work-orders"])


def _get_tenant_wo_git(ctx: TenantContext) -> WorkOrdersGitHubSettings:
    raw = ctx.tenant.settings_json or {}
    cfg_raw = raw.get("work_orders_github")
    if not isinstance(cfg_raw, dict):
        cfg_raw = {}
    return WorkOrdersGitHubSettings(**cfg_raw)


def _require_wo_git_config(ctx: TenantContext) -> tuple[WorkOrdersGitHubSettings, str, str, str, int, str]:
    cfg = _get_tenant_wo_git(ctx)
    if not cfg.enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Work Orders GitHub is not enabled for this tenant.",
        )
    if not cfg.repo_full_name or "/" not in cfg.repo_full_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Work Orders GitHub repo is not configured (repo_full_name).",
        )
    if not cfg.installation_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Work Orders GitHub installation_id is not configured.",
        )
    owner, repo = cfg.repo_full_name.split("/", 1)
    base_branch = cfg.base_branch or settings.GITHUB_BASE_BRANCH
    installation_id = int(cfg.installation_id)
    token = github_repo_service.get_installation_token(installation_id)
    return cfg, owner.strip(), repo.strip(), base_branch, installation_id, token


def _work_orders_root(cfg: WorkOrdersGitHubSettings) -> str:
    root = (cfg.folder_path or "work-orders").strip().strip("/")
    return root or "work-orders"


def _work_order_path_for_tenant(cfg: WorkOrdersGitHubSettings, wo_id: str, title: str) -> str:
    default_path = work_order_service.build_work_order_path(wo_id, title)
    root = _work_orders_root(cfg)
    if default_path.startswith("work-orders/"):
        return root + "/" + default_path[len("work-orders/") :]
    return f"{root}/{default_path}"


def _list_work_order_files_tenant(*, owner: str, repo: str, token: str, root: str, ref: str) -> list[str]:
    try:
        years = github_repo_service.list_dir_tenant(owner=owner, repo=repo, token=token, path=root, ref=ref)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return []
        raise
    paths: list[str] = []
    for entry in years:
        if entry.get("type") != "dir":
            continue
        year_path = entry.get("path")
        if not year_path:
            continue
        files = github_repo_service.list_dir_tenant(owner=owner, repo=repo, token=token, path=year_path, ref=ref)
        for file_item in files:
            if file_item.get("type") != "file":
                continue
            path = file_item.get("path") or ""
            if path.endswith(".md"):
                paths.append(path)
    return paths


def _find_work_order_path_tenant(*, owner: str, repo: str, token: str, root: str, wo_id: str, ref: str) -> str:
    for path in _list_work_order_files_tenant(owner=owner, repo=repo, token=token, root=root, ref=ref):
        filename = path.split("/")[-1]
        if filename.startswith(f"{wo_id}-") or filename == f"{wo_id}.md":
            return path
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")


def _guess_year_from_wo_id(wo_id: str) -> str:
    match = re.search(r"\b(20\d{2})\b", wo_id or "")
    if match:
        return match.group(1)
    return str(datetime.utcnow().year)


@router.get("", response_model=WorkOrderListResponse)
def list_work_orders(
    q: str | None = Query(default=None),
    year: str | None = Query(default=None),
    requires_deploy: bool | None = Query(default=None),
    service_id: str | None = Query(default=None),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> WorkOrderListResponse:
    summaries: list[WorkOrderSummary] = []

    services_count_sq = (
        select(func.count(ReleaseWorkOrderService.id))
        .where(ReleaseWorkOrderService.work_order_id == ReleaseWorkOrder.id)
        .scalar_subquery()
    )
    deploy_count_sq = (
        select(func.count(ReleaseWorkOrderService.id))
        .where(
            and_(
                ReleaseWorkOrderService.work_order_id == ReleaseWorkOrder.id,
                ReleaseWorkOrderService.requires_deploy.is_(True),
            )
        )
        .scalar_subquery()
    )

    query = select(ReleaseWorkOrder, services_count_sq.label("services_count"), deploy_count_sq.label("deploy_count"))

    if year:
        query = query.where(ReleaseWorkOrder.wo_id.ilike(f"%{year}%"))

    if service_id:
        query = query.where(
            exists(
                select(ReleaseWorkOrderService.id).where(
                    and_(
                        ReleaseWorkOrderService.work_order_id == ReleaseWorkOrder.id,
                        ReleaseWorkOrderService.service_id == service_id,
                    )
                )
            )
        )

    if requires_deploy is not None:
        deploy_exists = exists(
            select(ReleaseWorkOrderService.id).where(
                and_(
                    ReleaseWorkOrderService.work_order_id == ReleaseWorkOrder.id,
                    ReleaseWorkOrderService.requires_deploy.is_(True),
                )
            )
        )
        query = query.where(deploy_exists if requires_deploy else ~deploy_exists)

    if q:
        q_like = f"%{q}%"
        service_match = exists(
            select(ReleaseWorkOrderService.id).where(
                and_(
                    ReleaseWorkOrderService.work_order_id == ReleaseWorkOrder.id,
                    ReleaseWorkOrderService.service_id.ilike(q_like),
                )
            )
        )
        query = query.where(
            or_(ReleaseWorkOrder.wo_id.ilike(q_like), ReleaseWorkOrder.title.ilike(q_like), service_match)
        )

    rows = db.execute(query.order_by(ReleaseWorkOrder.updated_at.desc())).all()
    for wo, services_count, deploy_count in rows:
        summaries.append(
            WorkOrderSummary(
                wo_id=wo.wo_id,
                title=wo.title,
                path=wo.git_path or "",
                year=_guess_year_from_wo_id(wo.wo_id),
                services_count=int(services_count or 0),
                deploy_count=int(deploy_count or 0),
                sync_status=wo.sync_status,
                pr_url=wo.pr_url,
                branch=wo.git_branch,
            )
        )
    return WorkOrderListResponse(items=summaries)


@router.get("/{wo_id}", response_model=WorkOrderOut)
def get_work_order(
    wo_id: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> WorkOrderOut:
    wo = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.wo_id == wo_id))
    if not wo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    services = db.scalars(
        select(ReleaseWorkOrderService)
        .where(ReleaseWorkOrderService.work_order_id == wo.id)
        .order_by(ReleaseWorkOrderService.order_index.asc())
    ).all()
    parsed = WorkOrderParsed(
        title=wo.title,
        wo_type=wo.wo_type,
        status=wo.status,
        owner=wo.owner,
        requested_by=wo.requested_by,
        tenants_impacted=list(wo.tenants_impacted or []),
        risk=wo.risk,
        target_envs=list(wo.target_envs or []),
        postman_testing_ref=wo.postman_testing_ref,
        services_touched=[
            ServiceTouchedItem(
                service_id=item.service_id,
                repo=item.repo,
                change_type=item.change_type,
                requires_deploy=item.requires_deploy,
                requires_db_migration=item.requires_db_migration,
                requires_config_change=item.requires_config_change,
                feature_flags=list(item.feature_flags or []),
                release_notes_ref=item.release_notes_ref,
            )
            for item in services
        ],
        body_markdown=wo.body_markdown or '',
    )
    return WorkOrderOut(
        wo_id=wo_id,
        path=wo.git_path or "",
        sha=wo.git_sha,
        raw_markdown=wo.raw_markdown or "",
        parsed=parsed,
        pr_url=wo.pr_url,
        branch=wo.git_branch,
        sync_status=wo.sync_status,
        last_sync_at=wo.last_sync_at,
        last_sync_error=wo.last_sync_error,
        sync_requested_at=wo.sync_requested_at,
        git_repo_full_name=wo.git_repo_full_name,
        git_folder_path=wo.git_folder_path,
        git_path=wo.git_path,
        git_branch=wo.git_branch,
        git_sha=wo.git_sha,
    )


@router.post("", response_model=WorkOrderOut, status_code=status.HTTP_201_CREATED)
def create_work_order(
    payload: WorkOrderDraft,
    background_tasks: BackgroundTasks,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> WorkOrderOut:
    existing = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.wo_id == payload.wo_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Work order already exists.")

    markdown = work_order_service.compile_work_order_markdown(
        wo_id=payload.wo_id,
        title=payload.title,
        wo_type=payload.wo_type,
        status=payload.status,
        owner=payload.owner,
        requested_by=payload.requested_by,
        tenants_impacted=payload.tenants_impacted,
        risk=payload.risk,
        target_envs=payload.target_envs,
        postman_testing_ref=payload.postman_testing_ref,
        services_touched=payload.services_touched,
        body_markdown=payload.body_markdown,
    )
    cfg = _get_tenant_wo_git(ctx)
    git_branch = f"wo/{payload.wo_id}" if cfg.repo_full_name else None
    git_path = _work_order_path_for_tenant(cfg, payload.wo_id, payload.title) if cfg.repo_full_name else None
    sync_status = "pending" if (cfg.enabled and cfg.repo_full_name) else "disabled"
    sync_requested_at = datetime.utcnow() if (cfg.enabled and cfg.sync_on_save) else None

    wo = ReleaseWorkOrder(
        wo_id=payload.wo_id,
        title=payload.title,
        wo_type=payload.wo_type,
        status=payload.status,
        risk=payload.risk,
        owner=payload.owner,
        requested_by=payload.requested_by,
        tenants_impacted=payload.tenants_impacted,
        target_envs=payload.target_envs,
        postman_testing_ref=payload.postman_testing_ref,
        body_markdown=payload.body_markdown,
        raw_markdown=markdown,
        git_repo_full_name=cfg.repo_full_name,
        git_folder_path=cfg.folder_path or None,
        git_path=git_path,
        git_branch=git_branch,
        sync_status=sync_status,
        sync_requested_at=sync_requested_at,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(wo)
    db.flush()

    for idx, item in enumerate(payload.services_touched or []):
        db.add(
            ReleaseWorkOrderService(
                work_order_id=wo.id,
                order_index=idx,
                service_id=item.service_id,
                repo=item.repo,
                change_type=item.change_type,
                requires_deploy=item.requires_deploy,
                requires_db_migration=item.requires_db_migration,
                requires_config_change=item.requires_config_change,
                feature_flags=list(item.feature_flags or []),
                release_notes_ref=item.release_notes_ref,
                created_by=current_user.id,
                updated_by=current_user.id,
            )
        )

    db.commit()

    if cfg.enabled and cfg.sync_on_save and cfg.repo_full_name:
        background_tasks.add_task(
            release_mgmt_sync_service.sync_work_order_to_git_task,
            str(ctx.tenant.id),
            payload.wo_id,
            actor_user_id=str(current_user.id),
        )

    parsed = WorkOrderParsed(
        title=payload.title,
        wo_type=payload.wo_type,
        status=payload.status,
        owner=payload.owner,
        requested_by=payload.requested_by,
        tenants_impacted=payload.tenants_impacted,
        risk=payload.risk,
        target_envs=payload.target_envs,
        postman_testing_ref=payload.postman_testing_ref,
        services_touched=payload.services_touched,
        body_markdown=payload.body_markdown,
    )
    return WorkOrderOut(
        wo_id=payload.wo_id,
        path=git_path or "",
        sha=wo.git_sha,
        raw_markdown=markdown,
        parsed=parsed,
        pr_url=wo.pr_url,
        branch=wo.git_branch,
        sync_status=wo.sync_status,
        last_sync_at=wo.last_sync_at,
        last_sync_error=wo.last_sync_error,
        sync_requested_at=wo.sync_requested_at,
        git_repo_full_name=wo.git_repo_full_name,
        git_folder_path=wo.git_folder_path,
        git_path=wo.git_path,
        git_branch=wo.git_branch,
        git_sha=wo.git_sha,
    )


@router.put("/{wo_id}", response_model=WorkOrderOut)
def update_work_order(
    wo_id: str,
    payload: WorkOrderDraft,
    background_tasks: BackgroundTasks,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> WorkOrderOut:
    wo = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.wo_id == wo_id))
    if not wo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")

    markdown = work_order_service.compile_work_order_markdown(
        wo_id=wo_id,
        title=payload.title,
        wo_type=payload.wo_type,
        status=payload.status,
        owner=payload.owner,
        requested_by=payload.requested_by,
        tenants_impacted=payload.tenants_impacted,
        risk=payload.risk,
        target_envs=payload.target_envs,
        postman_testing_ref=payload.postman_testing_ref,
        services_touched=payload.services_touched,
        body_markdown=payload.body_markdown,
    )

    cfg = _get_tenant_wo_git(ctx)
    wo.title = payload.title
    wo.wo_type = payload.wo_type
    wo.status = payload.status
    wo.risk = payload.risk
    wo.owner = payload.owner
    wo.requested_by = payload.requested_by
    wo.tenants_impacted = payload.tenants_impacted
    wo.target_envs = payload.target_envs
    wo.postman_testing_ref = payload.postman_testing_ref
    wo.body_markdown = payload.body_markdown
    wo.raw_markdown = markdown
    wo.updated_by = current_user.id

    if cfg.repo_full_name:
        wo.git_repo_full_name = cfg.repo_full_name
        wo.git_folder_path = cfg.folder_path or None
        wo.git_branch = f"wo/{wo_id}"
        wo.git_path = _work_order_path_for_tenant(cfg, wo_id, payload.title)
    else:
        wo.git_repo_full_name = None
        wo.git_folder_path = None
        wo.git_branch = None
        wo.git_path = None

    wo.sync_status = "pending" if (cfg.enabled and cfg.repo_full_name) else "disabled"
    wo.sync_requested_at = datetime.utcnow() if (cfg.enabled and cfg.sync_on_save) else None

    # Replace services
    db.execute(
        ReleaseWorkOrderService.__table__.delete().where(ReleaseWorkOrderService.work_order_id == wo.id)
    )
    for idx, item in enumerate(payload.services_touched or []):
        db.add(
            ReleaseWorkOrderService(
                work_order_id=wo.id,
                order_index=idx,
                service_id=item.service_id,
                repo=item.repo,
                change_type=item.change_type,
                requires_deploy=item.requires_deploy,
                requires_db_migration=item.requires_db_migration,
                requires_config_change=item.requires_config_change,
                feature_flags=list(item.feature_flags or []),
                release_notes_ref=item.release_notes_ref,
                created_by=current_user.id,
                updated_by=current_user.id,
            )
        )

    db.commit()

    if cfg.enabled and cfg.sync_on_save and cfg.repo_full_name:
        background_tasks.add_task(
            release_mgmt_sync_service.sync_work_order_to_git_task,
            str(ctx.tenant.id),
            wo_id,
            actor_user_id=str(current_user.id),
        )

    parsed = WorkOrderParsed(
        title=payload.title,
        wo_type=payload.wo_type,
        status=payload.status,
        owner=payload.owner,
        requested_by=payload.requested_by,
        tenants_impacted=payload.tenants_impacted,
        risk=payload.risk,
        target_envs=payload.target_envs,
        postman_testing_ref=payload.postman_testing_ref,
        services_touched=payload.services_touched,
        body_markdown=payload.body_markdown,
    )
    return WorkOrderOut(
        wo_id=wo_id,
        path=wo.git_path or "",
        sha=wo.git_sha,
        raw_markdown=markdown,
        parsed=parsed,
        pr_url=wo.pr_url,
        branch=wo.git_branch,
        sync_status=wo.sync_status,
        last_sync_at=wo.last_sync_at,
        last_sync_error=wo.last_sync_error,
        sync_requested_at=wo.sync_requested_at,
        git_repo_full_name=wo.git_repo_full_name,
        git_folder_path=wo.git_folder_path,
        git_path=wo.git_path,
        git_branch=wo.git_branch,
        git_sha=wo.git_sha,
    )


@router.post("/{wo_id}/sync", response_model=WorkOrderOut)
def sync_work_order(
    wo_id: str,
    background_tasks: BackgroundTasks,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> WorkOrderOut:
    wo = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.wo_id == wo_id))
    if not wo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    cfg = _get_tenant_wo_git(ctx)
    if not cfg.enabled or not cfg.repo_full_name or not cfg.installation_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GitHub sync is not configured.")

    wo.sync_status = "pending"
    wo.sync_requested_at = datetime.utcnow()
    wo.last_sync_error = None
    db.commit()

    background_tasks.add_task(
        release_mgmt_sync_service.sync_work_order_to_git_task,
        str(ctx.tenant.id),
        wo_id,
        actor_user_id=str(current_user.id),
    )

    services = db.scalars(
        select(ReleaseWorkOrderService)
        .where(ReleaseWorkOrderService.work_order_id == wo.id)
        .order_by(ReleaseWorkOrderService.order_index.asc())
    ).all()
    parsed = WorkOrderParsed(
        title=wo.title,
        wo_type=wo.wo_type,
        status=wo.status,
        owner=wo.owner,
        requested_by=wo.requested_by,
        tenants_impacted=list(wo.tenants_impacted or []),
        risk=wo.risk,
        target_envs=list(wo.target_envs or []),
        postman_testing_ref=wo.postman_testing_ref,
        services_touched=[
            ServiceTouchedItem(
                service_id=item.service_id,
                repo=item.repo,
                change_type=item.change_type,
                requires_deploy=item.requires_deploy,
                requires_db_migration=item.requires_db_migration,
                requires_config_change=item.requires_config_change,
                feature_flags=list(item.feature_flags or []),
                release_notes_ref=item.release_notes_ref,
            )
            for item in services
        ],
        body_markdown=wo.body_markdown or '',
    )
    return WorkOrderOut(
        wo_id=wo_id,
        path=wo.git_path or "",
        sha=wo.git_sha,
        raw_markdown=wo.raw_markdown or "",
        parsed=parsed,
        pr_url=wo.pr_url,
        branch=wo.git_branch,
        sync_status=wo.sync_status,
        last_sync_at=wo.last_sync_at,
        last_sync_error=wo.last_sync_error,
        sync_requested_at=wo.sync_requested_at,
        git_repo_full_name=wo.git_repo_full_name,
        git_folder_path=wo.git_folder_path,
        git_path=wo.git_path,
        git_branch=wo.git_branch,
        git_sha=wo.git_sha,
    )


@router.post("/sync", response_model=dict)
def bulk_sync_work_orders(
    background_tasks: BackgroundTasks,
    sync_status: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=1000),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> dict:
    cfg = _get_tenant_wo_git(ctx)
    if not cfg.enabled or not cfg.repo_full_name or not cfg.installation_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GitHub sync is not configured.")

    query = select(ReleaseWorkOrder).where(ReleaseWorkOrder.sync_status != "disabled")
    if sync_status:
        query = query.where(ReleaseWorkOrder.sync_status == sync_status)
    else:
        query = query.where(ReleaseWorkOrder.sync_status != "synced")
    if status_filter:
        query = query.where(ReleaseWorkOrder.status == status_filter)

    items = db.scalars(query.order_by(ReleaseWorkOrder.updated_at.desc()).limit(limit)).all()
    wo_ids = [item.wo_id for item in items]
    if not wo_ids:
        return {"count": 0, "items": []}

    for item in items:
        item.sync_status = "pending"
        item.sync_requested_at = datetime.utcnow()
        item.last_sync_error = None
    db.commit()

    for wo_id in wo_ids:
        background_tasks.add_task(
            release_mgmt_sync_service.sync_work_order_to_git_task,
            str(ctx.tenant.id),
            wo_id,
            actor_user_id=str(current_user.id),
        )
    return {"count": len(wo_ids), "items": wo_ids}


@router.post("/{wo_id}/pr", response_model=WorkOrderOut)
def create_or_get_work_order_pr(
    wo_id: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> WorkOrderOut:
    wo = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.wo_id == wo_id))
    if not wo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")

    cfg, owner, repo, base_branch, _installation_id, token = _require_wo_git_config(ctx)
    branch = wo.git_branch or f"wo/{wo_id}"

    # Ensure branch/file are synced before PR creation.
    release_mgmt_sync_service.sync_work_order_to_git(db, wo_id, actor_user_id=str(current_user.id))

    pr_list = github_repo_service.list_prs_tenant(
        owner=owner,
        repo=repo,
        token=token,
        head=f"{owner}:{branch}",
        base=base_branch,
    )
    if pr_list:
        pr_url = pr_list[0].get("html_url")
    else:
        pr_body = (
            f"Requested-by: {current_user.email}\n"
            f"User-ID: {current_user.id}\n"
            f"Tenant: {ctx.tenant.slug}\n"
        )
        created = github_repo_service.create_pr_tenant(
            owner=owner,
            repo=repo,
            token=token,
            title=f"{wo_id}: {wo.title}",
            head=branch,
            base=base_branch,
            body=pr_body,
        )
        pr_url = created.get("url")
    wo.pr_url = pr_url
    db.commit()

    services = db.scalars(
        select(ReleaseWorkOrderService)
        .where(ReleaseWorkOrderService.work_order_id == wo.id)
        .order_by(ReleaseWorkOrderService.order_index.asc())
    ).all()
    parsed = WorkOrderParsed(
        title=wo.title,
        wo_type=wo.wo_type,
        status=wo.status,
        owner=wo.owner,
        requested_by=wo.requested_by,
        tenants_impacted=list(wo.tenants_impacted or []),
        risk=wo.risk,
        target_envs=list(wo.target_envs or []),
        postman_testing_ref=wo.postman_testing_ref,
        services_touched=[
            ServiceTouchedItem(
                service_id=item.service_id,
                repo=item.repo,
                change_type=item.change_type,
                requires_deploy=item.requires_deploy,
                requires_db_migration=item.requires_db_migration,
                requires_config_change=item.requires_config_change,
                feature_flags=list(item.feature_flags or []),
                release_notes_ref=item.release_notes_ref,
            )
            for item in services
        ],
        body_markdown=wo.body_markdown or '',
    )
    return WorkOrderOut(
        wo_id=wo_id,
        path=wo.git_path or "",
        sha=wo.git_sha,
        raw_markdown=wo.raw_markdown or "",
        parsed=parsed,
        pr_url=wo.pr_url,
        branch=wo.git_branch,
        sync_status=wo.sync_status,
        last_sync_at=wo.last_sync_at,
        last_sync_error=wo.last_sync_error,
        sync_requested_at=wo.sync_requested_at,
        git_repo_full_name=wo.git_repo_full_name,
        git_folder_path=wo.git_folder_path,
        git_path=wo.git_path,
        git_branch=wo.git_branch,
        git_sha=wo.git_sha,
    )
