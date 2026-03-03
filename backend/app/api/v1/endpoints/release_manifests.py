from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_db
from app.models.release_mgmt import ReleaseManifest
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.release_manifests import (
    ReleaseManifestOut,
    ReleaseManifestPreviewOut,
    ReleaseManifestPreviewRequest,
)
from app.schemas.settings import WorkOrdersGitHubSettings
from app.services import github_repo_service, release_manifest_service, release_mgmt_sync_service


router = APIRouter(prefix="/release-manifests", tags=["release-manifests"])


def _get_tenant_wo_git(ctx: TenantContext) -> WorkOrdersGitHubSettings:
    raw = ctx.tenant.settings_json or {}
    cfg_raw = raw.get("work_orders_github")
    if not isinstance(cfg_raw, dict):
        cfg_raw = {}
    return WorkOrdersGitHubSettings(**cfg_raw)


def _list_release_files(ref: str) -> list[str]:
    try:
        years = github_repo_service.list_dir("releases", ref=ref)
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
        files = github_repo_service.list_dir(year_path, ref=ref)
        for file_item in files:
            if file_item.get("type") != "file":
                continue
            path = file_item.get("path") or ""
            if path.endswith(".md"):
                paths.append(path)
    return paths


def _find_rel_path(rel_id: str, ref: str) -> str:
    for path in _list_release_files(ref):
        filename = path.split("/")[-1]
        if filename == f"{rel_id}.md":
            return path
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release manifest not found")


@router.get("", response_model=list[ReleaseManifestOut])
def list_release_manifests(
    year: str | None = Query(default=None),
    ref: str | None = Query(default=None, alias="ref"),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> list[ReleaseManifestOut]:
    items: list[ReleaseManifestOut] = []
    query = select(ReleaseManifest)
    if year:
        query = query.where(ReleaseManifest.rel_id.ilike(f"%{year}%"))
    rows = db.scalars(query.order_by(ReleaseManifest.updated_at.desc())).all()
    for rel in rows:
        items.append(
            ReleaseManifestOut(
                rel_id=rel.rel_id,
                path=rel.git_path or "",
                sha=rel.git_sha,
                raw_markdown=rel.raw_markdown or "",
                env=rel.env,
                window=rel.window,
                includes_work_orders=list(rel.includes_work_orders or []),
                versions=rel.versions or {},
                release_notes=rel.release_notes or {},
                deploy_list=rel.deploy_list or [],
                sync_status=rel.sync_status,
                last_sync_at=rel.last_sync_at,
                last_sync_error=rel.last_sync_error,
                sync_requested_at=rel.sync_requested_at,
                pr_url=rel.pr_url,
                branch=rel.git_branch,
                git_repo_full_name=rel.git_repo_full_name,
                git_folder_path=rel.git_folder_path,
                git_path=rel.git_path,
                git_branch=rel.git_branch,
                git_sha=rel.git_sha,
            )
        )
    return items


@router.get("/{rel_id}", response_model=ReleaseManifestOut)
def get_release_manifest(
    rel_id: str,
    ref: str | None = Query(default=None, alias="ref"),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> ReleaseManifestOut:
    rel = db.scalar(select(ReleaseManifest).where(ReleaseManifest.rel_id == rel_id))
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release manifest not found")
    return ReleaseManifestOut(
        rel_id=rel.rel_id,
        path=rel.git_path or "",
        sha=rel.git_sha,
        raw_markdown=rel.raw_markdown or "",
        env=rel.env,
        window=rel.window,
        includes_work_orders=list(rel.includes_work_orders or []),
        versions=rel.versions or {},
        release_notes=rel.release_notes or {},
        deploy_list=rel.deploy_list or [],
        sync_status=rel.sync_status,
        last_sync_at=rel.last_sync_at,
        last_sync_error=rel.last_sync_error,
        sync_requested_at=rel.sync_requested_at,
        pr_url=rel.pr_url,
        branch=rel.git_branch,
        git_repo_full_name=rel.git_repo_full_name,
        git_folder_path=rel.git_folder_path,
        git_path=rel.git_path,
        git_branch=rel.git_branch,
        git_sha=rel.git_sha,
    )


@router.post("/preview", response_model=ReleaseManifestPreviewOut)
def preview_release_manifest(
    payload: ReleaseManifestPreviewRequest,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestPreviewOut:
    if not payload.work_orders:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work orders list is required.")
    work_orders = release_manifest_service.load_work_orders_from_db(db, payload.work_orders)
    markdown, deploy_list = release_manifest_service.generate_rel_markdown(
        rel_id=payload.rel_id,
        env=payload.env,
        window=payload.window or "",
        work_orders=work_orders,
        versions=payload.versions,
        release_notes=payload.release_notes,
    )
    return ReleaseManifestPreviewOut(markdown=markdown, deploy_list=deploy_list)


@router.post("", response_model=ReleaseManifestOut, status_code=status.HTTP_201_CREATED)
def create_release_manifest(
    payload: ReleaseManifestPreviewRequest,
    background_tasks: BackgroundTasks,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestOut:
    if not payload.work_orders:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work orders list is required.")
    work_orders = release_manifest_service.load_work_orders_from_db(db, payload.work_orders)
    markdown, _ = release_manifest_service.generate_rel_markdown(
        rel_id=payload.rel_id,
        env=payload.env,
        window=payload.window or "",
        work_orders=work_orders,
        versions=payload.versions,
        release_notes=payload.release_notes,
    )
    existing = db.scalar(select(ReleaseManifest).where(ReleaseManifest.rel_id == payload.rel_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Release manifest already exists.")

    cfg = _get_tenant_wo_git(ctx)
    year = release_manifest_service.guess_year_from_id(payload.rel_id)
    root = (cfg.release_manifests_folder_path or "releases").strip().strip("/") or "releases"
    git_path = f"{root}/{year}/{payload.rel_id}.md" if cfg.repo_full_name else None
    git_branch = f"rel/{payload.rel_id}" if cfg.repo_full_name else None
    sync_status = "pending" if (cfg.enabled and cfg.repo_full_name) else "disabled"
    sync_requested_at = datetime.utcnow() if (cfg.enabled and cfg.sync_on_save) else None

    rel = ReleaseManifest(
        rel_id=payload.rel_id,
        env=payload.env,
        window=payload.window or None,
        includes_work_orders=payload.work_orders,
        versions=payload.versions,
        release_notes=payload.release_notes,
        deploy_list=[],
        raw_markdown=markdown,
        git_repo_full_name=cfg.repo_full_name,
        git_folder_path=root,
        git_path=git_path,
        git_branch=git_branch,
        sync_status=sync_status,
        sync_requested_at=sync_requested_at,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(rel)
    db.commit()

    if cfg.enabled and cfg.sync_on_save and cfg.repo_full_name:
        background_tasks.add_task(
            release_mgmt_sync_service.sync_release_manifest_to_git_task,
            str(ctx.tenant.id),
            payload.rel_id,
            actor_user_id=str(current_user.id),
        )

    return ReleaseManifestOut(
        rel_id=rel.rel_id,
        path=rel.git_path or "",
        sha=rel.git_sha,
        raw_markdown=rel.raw_markdown or "",
        env=rel.env,
        window=rel.window,
        includes_work_orders=list(rel.includes_work_orders or []),
        versions=rel.versions or {},
        release_notes=rel.release_notes or {},
        deploy_list=rel.deploy_list or [],
        sync_status=rel.sync_status,
        last_sync_at=rel.last_sync_at,
        last_sync_error=rel.last_sync_error,
        sync_requested_at=rel.sync_requested_at,
        pr_url=rel.pr_url,
        branch=rel.git_branch,
        git_repo_full_name=rel.git_repo_full_name,
        git_folder_path=rel.git_folder_path,
        git_path=rel.git_path,
        git_branch=rel.git_branch,
        git_sha=rel.git_sha,
    )


@router.put("/{rel_id}", response_model=ReleaseManifestOut)
def update_release_manifest(
    rel_id: str,
    payload: ReleaseManifestPreviewRequest,
    background_tasks: BackgroundTasks,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestOut:
    rel = db.scalar(select(ReleaseManifest).where(ReleaseManifest.rel_id == rel_id))
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release manifest not found")
    if not payload.work_orders:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work orders list is required.")

    work_orders = release_manifest_service.load_work_orders_from_db(db, payload.work_orders)
    markdown, _ = release_manifest_service.generate_rel_markdown(
        rel_id=rel_id,
        env=payload.env,
        window=payload.window or "",
        work_orders=work_orders,
        versions=payload.versions,
        release_notes=payload.release_notes,
    )

    cfg = _get_tenant_wo_git(ctx)
    year = release_manifest_service.guess_year_from_id(rel_id)
    root = (cfg.release_manifests_folder_path or "releases").strip().strip("/") or "releases"
    git_path = f"{root}/{year}/{rel_id}.md" if cfg.repo_full_name else None
    git_branch = f"rel/{rel_id}" if cfg.repo_full_name else None

    rel.env = payload.env
    rel.window = payload.window or None
    rel.includes_work_orders = payload.work_orders
    rel.versions = payload.versions
    rel.release_notes = payload.release_notes
    rel.raw_markdown = markdown
    rel.git_repo_full_name = cfg.repo_full_name
    rel.git_folder_path = root
    rel.git_path = git_path
    rel.git_branch = git_branch
    rel.sync_status = "pending" if (cfg.enabled and cfg.repo_full_name) else "disabled"
    rel.sync_requested_at = datetime.utcnow() if (cfg.enabled and cfg.sync_on_save) else None
    rel.updated_by = current_user.id
    db.commit()

    if cfg.enabled and cfg.sync_on_save and cfg.repo_full_name:
        background_tasks.add_task(
            release_mgmt_sync_service.sync_release_manifest_to_git_task,
            str(ctx.tenant.id),
            rel_id,
            actor_user_id=str(current_user.id),
        )

    return ReleaseManifestOut(
        rel_id=rel.rel_id,
        path=rel.git_path or "",
        sha=rel.git_sha,
        raw_markdown=rel.raw_markdown or "",
        env=rel.env,
        window=rel.window,
        includes_work_orders=list(rel.includes_work_orders or []),
        versions=rel.versions or {},
        release_notes=rel.release_notes or {},
        deploy_list=rel.deploy_list or [],
        sync_status=rel.sync_status,
        last_sync_at=rel.last_sync_at,
        last_sync_error=rel.last_sync_error,
        sync_requested_at=rel.sync_requested_at,
        pr_url=rel.pr_url,
        branch=rel.git_branch,
        git_repo_full_name=rel.git_repo_full_name,
        git_folder_path=rel.git_folder_path,
        git_path=rel.git_path,
        git_branch=rel.git_branch,
        git_sha=rel.git_sha,
    )


@router.post("/{rel_id}/pr", response_model=ReleaseManifestOut)
def create_or_get_release_manifest_pr(
    rel_id: str,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestOut:
    rel = db.scalar(select(ReleaseManifest).where(ReleaseManifest.rel_id == rel_id))
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release manifest not found")

    cfg = _get_tenant_wo_git(ctx)
    if not cfg.enabled or not cfg.repo_full_name or not cfg.installation_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GitHub sync is not configured.")

    owner, repo = cfg.repo_full_name.split("/", 1)
    token = github_repo_service.get_installation_token(int(cfg.installation_id))
    base_branch = cfg.base_branch or settings.GITHUB_BASE_BRANCH
    branch = rel.git_branch or f"rel/{rel_id}"

    release_mgmt_sync_service.sync_release_manifest_to_git(db, rel_id, actor_user_id=str(current_user.id))

    pr_list = github_repo_service.list_prs_tenant(
        owner=owner.strip(),
        repo=repo.strip(),
        token=token,
        head=f"{owner.strip()}:{branch}",
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
            owner=owner.strip(),
            repo=repo.strip(),
            token=token,
            title=f"{rel_id}: {rel.env or ''}",
            head=branch,
            base=base_branch,
            body=pr_body,
        )
        pr_url = created.get("url")
    rel.pr_url = pr_url
    db.commit()

    return ReleaseManifestOut(
        rel_id=rel.rel_id,
        path=rel.git_path or "",
        sha=rel.git_sha,
        raw_markdown=rel.raw_markdown or "",
        env=rel.env,
        window=rel.window,
        includes_work_orders=list(rel.includes_work_orders or []),
        versions=rel.versions or {},
        release_notes=rel.release_notes or {},
        deploy_list=rel.deploy_list or [],
        sync_status=rel.sync_status,
        last_sync_at=rel.last_sync_at,
        last_sync_error=rel.last_sync_error,
        sync_requested_at=rel.sync_requested_at,
        pr_url=rel.pr_url,
        branch=rel.git_branch,
        git_repo_full_name=rel.git_repo_full_name,
        git_folder_path=rel.git_folder_path,
        git_path=rel.git_path,
        git_branch=rel.git_branch,
        git_sha=rel.git_sha,
    )


@router.post("/{rel_id}/sync", response_model=ReleaseManifestOut)
def sync_release_manifest(
    rel_id: str,
    background_tasks: BackgroundTasks,
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestOut:
    rel = db.scalar(select(ReleaseManifest).where(ReleaseManifest.rel_id == rel_id))
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release manifest not found")

    cfg = _get_tenant_wo_git(ctx)
    if not cfg.enabled or not cfg.repo_full_name or not cfg.installation_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GitHub sync is not configured.")

    rel.sync_status = "pending"
    rel.sync_requested_at = datetime.utcnow()
    rel.last_sync_error = None
    db.commit()

    background_tasks.add_task(
        release_mgmt_sync_service.sync_release_manifest_to_git_task,
        str(ctx.tenant.id),
        rel_id,
        actor_user_id=str(current_user.id),
    )

    return ReleaseManifestOut(
        rel_id=rel.rel_id,
        path=rel.git_path or "",
        sha=rel.git_sha,
        raw_markdown=rel.raw_markdown or "",
        env=rel.env,
        window=rel.window,
        includes_work_orders=list(rel.includes_work_orders or []),
        versions=rel.versions or {},
        release_notes=rel.release_notes or {},
        deploy_list=rel.deploy_list or [],
        sync_status=rel.sync_status,
        last_sync_at=rel.last_sync_at,
        last_sync_error=rel.last_sync_error,
        sync_requested_at=rel.sync_requested_at,
        pr_url=rel.pr_url,
        branch=rel.git_branch,
        git_repo_full_name=rel.git_repo_full_name,
        git_folder_path=rel.git_folder_path,
        git_path=rel.git_path,
        git_branch=rel.git_branch,
        git_sha=rel.git_sha,
    )


@router.post("/sync", response_model=dict)
def bulk_sync_release_manifests(
    background_tasks: BackgroundTasks,
    sync_status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    ctx: TenantContext = Depends(require_tenant_membership),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> dict:
    cfg = _get_tenant_wo_git(ctx)
    if not cfg.enabled or not cfg.repo_full_name or not cfg.installation_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GitHub sync is not configured.")

    query = select(ReleaseManifest).where(ReleaseManifest.sync_status != "disabled")
    if sync_status:
        query = query.where(ReleaseManifest.sync_status == sync_status)
    else:
        query = query.where(ReleaseManifest.sync_status != "synced")

    items = db.scalars(query.order_by(ReleaseManifest.updated_at.desc()).limit(limit)).all()
    rel_ids = [item.rel_id for item in items]
    if not rel_ids:
        return {"count": 0, "items": []}

    for item in items:
        item.sync_status = "pending"
        item.sync_requested_at = datetime.utcnow()
        item.last_sync_error = None
    db.commit()

    for rel_id in rel_ids:
        background_tasks.add_task(
            release_mgmt_sync_service.sync_release_manifest_to_git_task,
            str(ctx.tenant.id),
            rel_id,
            actor_user_id=str(current_user.id),
        )
    return {"count": len(rel_ids), "items": rel_ids}
