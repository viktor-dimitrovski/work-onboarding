from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.release_manifests import (
    ReleaseManifestOut,
    ReleaseManifestPreviewOut,
    ReleaseManifestPreviewRequest,
)
from app.services import github_repo_service, release_manifest_service


router = APIRouter(prefix="/release-manifests", tags=["release-manifests"])


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
    ref: str | None = Query(default=None),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> list[ReleaseManifestOut]:
    repo_ref = ref or settings.GITHUB_BASE_BRANCH
    items: list[ReleaseManifestOut] = []
    for path in _list_release_files(repo_ref):
        if year and f"/{year}/" not in path:
            continue
        raw = github_repo_service.get_file(path, ref=repo_ref)
        rel_id = path.split("/")[-1].replace(".md", "")
        items.append(
            ReleaseManifestOut(
                rel_id=rel_id,
                path=path,
                sha=raw.get("sha"),
                raw_markdown=raw["content"],
            )
        )
    return items


@router.get("/{rel_id}", response_model=ReleaseManifestOut)
def get_release_manifest(
    rel_id: str,
    ref: str | None = Query(default=None),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> ReleaseManifestOut:
    repo_ref = ref or settings.GITHUB_BASE_BRANCH
    path = _find_rel_path(rel_id, repo_ref)
    raw = github_repo_service.get_file(path, ref=repo_ref)
    return ReleaseManifestOut(
        rel_id=rel_id,
        path=path,
        sha=raw.get("sha"),
        raw_markdown=raw["content"],
    )


@router.post("/preview", response_model=ReleaseManifestPreviewOut)
def preview_release_manifest(
    payload: ReleaseManifestPreviewRequest,
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestPreviewOut:
    if not payload.work_orders:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work orders list is required.")
    work_orders = release_manifest_service.load_work_orders_from_repo(payload.work_orders, ref=payload.ref)
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
    ctx: TenantContext = Depends(require_tenant_membership),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> ReleaseManifestOut:
    if not payload.work_orders:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Work orders list is required.")
    work_orders = release_manifest_service.load_work_orders_from_repo(payload.work_orders, ref=payload.ref)
    markdown, _ = release_manifest_service.generate_rel_markdown(
        rel_id=payload.rel_id,
        env=payload.env,
        window=payload.window or "",
        work_orders=work_orders,
        versions=payload.versions,
        release_notes=payload.release_notes,
    )
    branch = f"rel/{payload.rel_id}"
    github_repo_service.create_branch(branch, settings.GITHUB_BASE_BRANCH)

    year = release_manifest_service.guess_year_from_id(payload.rel_id)
    path = f"releases/{year}/{payload.rel_id}.md"
    commit_message = f"REL: {payload.rel_id} create (by {current_user.email})"
    github_repo_service.upsert_file(path, content=markdown, branch=branch, message=commit_message)

    pr_body = (
        f"Requested-by: {current_user.email}\n"
        f"User-ID: {current_user.id}\n"
        f"Tenant: {ctx.tenant.slug}\n"
    )
    try:
        github_repo_service.create_pr(
            title=f"{payload.rel_id}: {payload.env}",
            head=branch,
            base=settings.GITHUB_BASE_BRANCH,
            body=pr_body,
        )
    except HTTPException:
        pass

    fetched = github_repo_service.get_file(path, ref=branch)
    return ReleaseManifestOut(
        rel_id=payload.rel_id,
        path=path,
        sha=fetched.get("sha"),
        raw_markdown=fetched["content"],
    )
