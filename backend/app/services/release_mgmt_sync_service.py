from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, set_tenant_id
from app.models.release_mgmt import ReleaseManifest, ReleaseWorkOrder, ReleaseWorkOrderService
from app.models.rbac import User
from app.models.tenant import Tenant
from app.schemas.settings import WorkOrdersGitHubSettings
from app.schemas.work_orders import ServiceTouchedItem
from app.services import github_repo_service, release_manifest_service, work_order_service


def _get_tenant_git_config(db: Session, tenant_id: str) -> WorkOrdersGitHubSettings:
    tenant_key = tenant_id
    try:
        tenant_key = UUID(str(tenant_id))
    except (TypeError, ValueError):
        pass
    tenant = db.scalar(select(Tenant).where(Tenant.id == tenant_key))
    raw = tenant.settings_json if tenant and isinstance(tenant.settings_json, dict) else {}
    cfg_raw = raw.get("work_orders_github")
    if not isinstance(cfg_raw, dict):
        cfg_raw = {}
    return WorkOrdersGitHubSettings(**cfg_raw)


def _resolve_repo(cfg: WorkOrdersGitHubSettings) -> tuple[str, str]:
    if not cfg.repo_full_name or "/" not in cfg.repo_full_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GitHub repo is not configured.")
    owner, repo = cfg.repo_full_name.split("/", 1)
    return owner.strip(), repo.strip()


def _author_from_user(db: Session, user_id: str | None) -> dict[str, str]:
    if not user_id:
        return {"name": settings.GITHUB_COMMITTER_NAME, "email": settings.GITHUB_COMMITTER_EMAIL}
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        return {"name": settings.GITHUB_COMMITTER_NAME, "email": settings.GITHUB_COMMITTER_EMAIL}
    return {"name": user.full_name or user.email, "email": user.email}


def _work_order_git_path(cfg: WorkOrdersGitHubSettings, wo_id: str, title: str) -> str:
    path = work_order_service.build_work_order_path(wo_id, title)
    root = (cfg.folder_path or "work-orders").strip().strip("/") or "work-orders"
    if path.startswith("work-orders/"):
        return root + "/" + path[len("work-orders/") :]
    return f"{root}/{path}"


def _release_manifest_git_path(cfg: WorkOrdersGitHubSettings, rel_id: str) -> str:
    year = release_manifest_service.guess_year_from_id(rel_id)
    root = (cfg.release_manifests_folder_path or "releases").strip().strip("/") or "releases"
    return f"{root}/{year}/{rel_id}.md"


def sync_work_order_to_git(db: Session, wo_id: str, *, actor_user_id: str | None = None) -> None:
    wo = db.scalar(select(ReleaseWorkOrder).where(ReleaseWorkOrder.wo_id == wo_id))
    if not wo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")

    cfg = _get_tenant_git_config(db, str(wo.tenant_id))
    if not cfg.enabled or not cfg.installation_id or not cfg.repo_full_name:
        wo.sync_status = "disabled"
        wo.last_sync_error = "GitHub sync is not configured for this tenant."
        db.commit()
        return

    owner, repo = _resolve_repo(cfg)
    token = github_repo_service.get_installation_token(int(cfg.installation_id))
    base_branch = cfg.base_branch or settings.GITHUB_BASE_BRANCH
    branch = wo.git_branch or f"wo/{wo.wo_id}"
    path = _work_order_git_path(cfg, wo.wo_id, wo.title)

    services = db.scalars(
        select(ReleaseWorkOrderService).where(ReleaseWorkOrderService.work_order_id == wo.id)
    ).all()
    service_items = [
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
    ]
    markdown = work_order_service.compile_work_order_markdown(
        wo_id=wo.wo_id,
        title=wo.title,
        wo_type=wo.wo_type,
        status=wo.status,
        owner=wo.owner,
        requested_by=wo.requested_by,
        tenants_impacted=list(wo.tenants_impacted or []),
        risk=wo.risk,
        target_envs=list(wo.target_envs or []),
        postman_testing_ref=wo.postman_testing_ref,
        services_touched=service_items,
        body_markdown=wo.body_markdown or "",
    )

    author = _author_from_user(db, actor_user_id)
    committer = {"name": settings.GITHUB_COMMITTER_NAME, "email": settings.GITHUB_COMMITTER_EMAIL}

    try:
        github_repo_service.create_branch_tenant(
            owner=owner,
            repo=repo,
            token=token,
            new_branch=branch,
            from_branch=base_branch,
        )
        existing = None
        try:
            existing = github_repo_service.get_file_tenant(owner=owner, repo=repo, token=token, path=path, ref=branch)
        except HTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise

        github_repo_service.upsert_file_tenant(
            owner=owner,
            repo=repo,
            token=token,
            path=path,
            content=markdown,
            branch=branch,
            message=f"WO: {wo.wo_id} sync",
            sha=(existing or {}).get("sha"),
            author=author,
            committer=committer,
        )
        fetched = github_repo_service.get_file_tenant(owner=owner, repo=repo, token=token, path=path, ref=branch)
        pr_list = github_repo_service.list_prs_tenant(
            owner=owner, repo=repo, token=token, head=f"{owner}:{branch}", base=base_branch
        )
        wo.git_repo_full_name = cfg.repo_full_name
        wo.git_folder_path = cfg.folder_path
        wo.git_path = path
        wo.git_branch = branch
        wo.git_sha = fetched.get("sha")
        wo.raw_markdown = markdown
        wo.pr_url = pr_list[0].get("html_url") if pr_list else None
        wo.sync_status = "synced"
        wo.last_sync_error = None
        wo.last_sync_at = datetime.utcnow()
    except HTTPException as exc:
        wo.sync_status = "failed"
        wo.last_sync_error = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    finally:
        db.commit()


def sync_work_order_to_git_task(tenant_id: str, wo_id: str, *, actor_user_id: str | None = None) -> None:
    db = SessionLocal()
    try:
        set_tenant_id(db, tenant_id)
        sync_work_order_to_git(db, wo_id, actor_user_id=actor_user_id)
    finally:
        db.close()


def sync_release_manifest_to_git(db: Session, rel_id: str, *, actor_user_id: str | None = None) -> None:
    rel = db.scalar(select(ReleaseManifest).where(ReleaseManifest.rel_id == rel_id))
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release manifest not found")

    cfg = _get_tenant_git_config(db, str(rel.tenant_id))
    if not cfg.enabled or not cfg.installation_id or not cfg.repo_full_name:
        rel.sync_status = "disabled"
        rel.last_sync_error = "GitHub sync is not configured for this tenant."
        db.commit()
        return

    owner, repo = _resolve_repo(cfg)
    token = github_repo_service.get_installation_token(int(cfg.installation_id))
    base_branch = cfg.base_branch or settings.GITHUB_BASE_BRANCH
    branch = rel.git_branch or f"rel/{rel.rel_id}"
    path = _release_manifest_git_path(cfg, rel.rel_id)
    markdown = rel.raw_markdown or ""
    if not markdown:
        work_orders = release_manifest_service.load_work_orders_from_db(db, list(rel.includes_work_orders or []))
        markdown, deploy_list = release_manifest_service.generate_rel_markdown(
            rel_id=rel.rel_id,
            env=rel.env or "",
            window=rel.window or "",
            work_orders=work_orders,
            versions=rel.versions or {},
            release_notes=rel.release_notes or {},
        )
        rel.deploy_list = [item.model_dump() for item in deploy_list]
        rel.raw_markdown = markdown

    author = _author_from_user(db, actor_user_id)
    committer = {"name": settings.GITHUB_COMMITTER_NAME, "email": settings.GITHUB_COMMITTER_EMAIL}

    try:
        github_repo_service.create_branch_tenant(
            owner=owner,
            repo=repo,
            token=token,
            new_branch=branch,
            from_branch=base_branch,
        )
        existing = None
        try:
            existing = github_repo_service.get_file_tenant(owner=owner, repo=repo, token=token, path=path, ref=branch)
        except HTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise

        github_repo_service.upsert_file_tenant(
            owner=owner,
            repo=repo,
            token=token,
            path=path,
            content=markdown,
            branch=branch,
            message=f"REL: {rel.rel_id} sync",
            sha=(existing or {}).get("sha"),
            author=author,
            committer=committer,
        )
        fetched = github_repo_service.get_file_tenant(owner=owner, repo=repo, token=token, path=path, ref=branch)
        pr_list = github_repo_service.list_prs_tenant(
            owner=owner, repo=repo, token=token, head=f"{owner}:{branch}", base=base_branch
        )
        rel.git_repo_full_name = cfg.repo_full_name
        rel.git_folder_path = cfg.release_manifests_folder_path
        rel.git_path = path
        rel.git_branch = branch
        rel.git_sha = fetched.get("sha")
        rel.pr_url = pr_list[0].get("html_url") if pr_list else None
        rel.sync_status = "synced"
        rel.last_sync_error = None
        rel.last_sync_at = datetime.utcnow()
    except HTTPException as exc:
        rel.sync_status = "failed"
        rel.last_sync_error = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    finally:
        db.commit()


def sync_release_manifest_to_git_task(tenant_id: str, rel_id: str, *, actor_user_id: str | None = None) -> None:
    db = SessionLocal()
    try:
        set_tenant_id(db, tenant_id)
        sync_release_manifest_to_git(db, rel_id, actor_user_id=actor_user_id)
    finally:
        db.close()
