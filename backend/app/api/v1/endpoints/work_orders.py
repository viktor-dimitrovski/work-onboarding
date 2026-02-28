from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.work_orders import WorkOrderDraft, WorkOrderListResponse, WorkOrderOut, WorkOrderSummary
from app.services import github_repo_service, work_order_service


router = APIRouter(prefix="/work-orders", tags=["work-orders"])


def _extract_wo_id_from_path(path: str) -> str:
    filename = path.split("/")[-1]
    if filename.endswith(".md"):
        filename = filename[:-3]
    if filename.startswith("WO-"):
        return filename.split("-", 3)[:3] and "-".join(filename.split("-", 3)[:3]) or filename
    return filename


def _list_work_order_files(ref: str) -> list[str]:
    try:
        years = github_repo_service.list_dir("work-orders", ref=ref)
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


def _find_work_order_path(wo_id: str, ref: str) -> str:
    for path in _list_work_order_files(ref):
        filename = path.split("/")[-1]
        if filename.startswith(f"{wo_id}-") or filename == f"{wo_id}.md":
            return path
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")


@router.get("", response_model=WorkOrderListResponse)
def list_work_orders(
    q: str | None = Query(default=None),
    year: str | None = Query(default=None),
    requires_deploy: bool | None = Query(default=None),
    service_id: str | None = Query(default=None),
    ref: str | None = Query(default=None),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> WorkOrderListResponse:
    repo_ref = ref or settings.GITHUB_BASE_BRANCH
    summaries: list[WorkOrderSummary] = []
    for path in _list_work_order_files(repo_ref):
        if year and f"/{year}/" not in path:
            continue
        raw = github_repo_service.get_file(path, ref=repo_ref)
        parsed = work_order_service.parse_work_order_markdown(raw["content"])
        wo_id = _extract_wo_id_from_path(path)
        services = parsed.services_touched
        deploy_count = len([s for s in services if s.requires_deploy])
        summary = WorkOrderSummary(
            wo_id=wo_id,
            title=parsed.title or None,
            path=path,
            year=path.split("/")[-2] if "/" in path else "",
            services_count=len(services),
            deploy_count=deploy_count,
        )
        if q:
            q_lower = q.lower()
            matches = q_lower in wo_id.lower() or q_lower in (summary.title or "").lower()
            if not matches:
                if any(q_lower in item.service_id.lower() for item in services):
                    matches = True
            if not matches:
                continue
        if requires_deploy is not None:
            if (deploy_count > 0) != requires_deploy:
                continue
        if service_id:
            if not any(item.service_id == service_id for item in services):
                continue
        summaries.append(summary)
    return WorkOrderListResponse(items=summaries)


@router.get("/{wo_id}", response_model=WorkOrderOut)
def get_work_order(
    wo_id: str,
    ref: str | None = Query(default=None),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> WorkOrderOut:
    repo_ref = ref or settings.GITHUB_BASE_BRANCH
    path = _find_work_order_path(wo_id, repo_ref)
    raw = github_repo_service.get_file(path, ref=repo_ref)
    parsed = work_order_service.parse_work_order_markdown(raw["content"])
    return WorkOrderOut(
        wo_id=wo_id,
        path=path,
        sha=raw.get("sha"),
        raw_markdown=raw["content"],
        parsed=parsed,
    )


@router.post("", response_model=WorkOrderOut, status_code=status.HTTP_201_CREATED)
def create_work_order(
    payload: WorkOrderDraft,
    ctx: TenantContext = Depends(require_tenant_membership),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> WorkOrderOut:
    branch = payload.branch or f"wo/{payload.wo_id}"
    github_repo_service.create_branch(branch, settings.GITHUB_BASE_BRANCH)

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
    path = work_order_service.build_work_order_path(payload.wo_id, payload.title)
    commit_message = f"WO: {payload.wo_id} create (by {current_user.email})"
    github_repo_service.upsert_file(path, content=markdown, branch=branch, message=commit_message)

    pr_body = (
        f"Requested-by: {current_user.email}\n"
        f"User-ID: {current_user.id}\n"
        f"Tenant: {ctx.tenant.slug}\n"
    )
    pr = github_repo_service.create_pr(
        title=f"{payload.wo_id}: {payload.title}",
        head=branch,
        base=settings.GITHUB_BASE_BRANCH,
        body=pr_body,
    )

    fetched = github_repo_service.get_file(path, ref=branch)
    parsed = work_order_service.parse_work_order_markdown(fetched["content"])
    return WorkOrderOut(
        wo_id=payload.wo_id,
        path=path,
        sha=fetched.get("sha"),
        raw_markdown=fetched["content"],
        parsed=parsed,
        pr_url=pr.get("url"),
        branch=branch,
    )


@router.put("/{wo_id}", response_model=WorkOrderOut)
def update_work_order(
    wo_id: str,
    payload: WorkOrderDraft,
    ctx: TenantContext = Depends(require_tenant_membership),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> WorkOrderOut:
    if not payload.sha:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing file sha for update.")
    branch = payload.branch or f"wo/{wo_id}"

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
    path = _find_work_order_path(wo_id, branch)
    commit_message = f"WO: {wo_id} update (by {current_user.email})"
    github_repo_service.upsert_file(
        path,
        content=markdown,
        branch=branch,
        message=commit_message,
        sha=payload.sha,
    )

    pr_body = (
        f"Requested-by: {current_user.email}\n"
        f"User-ID: {current_user.id}\n"
        f"Tenant: {ctx.tenant.slug}\n"
    )
    try:
        pr = github_repo_service.create_pr(
            title=f"{wo_id}: {payload.title}",
            head=branch,
            base=settings.GITHUB_BASE_BRANCH,
            body=pr_body,
        )
    except HTTPException:
        pr = {}

    fetched = github_repo_service.get_file(path, ref=branch)
    parsed = work_order_service.parse_work_order_markdown(fetched["content"])
    return WorkOrderOut(
        wo_id=wo_id,
        path=path,
        sha=fetched.get("sha"),
        raw_markdown=fetched["content"],
        parsed=parsed,
        pr_url=pr.get("url"),
        branch=branch,
    )
