from fastapi import APIRouter, Depends

from app.api.v1.endpoints import (
    admin,
    audit,
    assessments,
    assignments,
    auth,
    billing,
    compliance,
    health,
    integration_registry,
    keybindings,
    progress,
    reports,
    release_manifests,
    release_center,
    settings,
    tracks,
    usage,
    users,
    tenants,
    work_orders,
)
from app.api.deps import require_password_change_completed
from app.multitenancy.deps import require_tenant_membership


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(admin.router, dependencies=[Depends(require_password_change_completed)])
api_router.include_router(billing.webhook_router)
api_router.include_router(keybindings.router, dependencies=[Depends(require_password_change_completed)])

tenant_deps = [Depends(require_password_change_completed), Depends(require_tenant_membership)]
api_router.include_router(users.router, dependencies=tenant_deps)
api_router.include_router(tracks.router, dependencies=tenant_deps)
api_router.include_router(assignments.router, dependencies=tenant_deps)
api_router.include_router(progress.router, dependencies=tenant_deps)
api_router.include_router(reports.router, dependencies=tenant_deps)
api_router.include_router(assessments.router, dependencies=tenant_deps)
api_router.include_router(tenants.router, dependencies=tenant_deps)
api_router.include_router(audit.router, dependencies=tenant_deps)
api_router.include_router(settings.router, dependencies=tenant_deps)
api_router.include_router(usage.router, dependencies=tenant_deps)
api_router.include_router(billing.router, dependencies=tenant_deps)
api_router.include_router(compliance.router, dependencies=tenant_deps)
api_router.include_router(work_orders.router, dependencies=tenant_deps)
api_router.include_router(release_manifests.router, dependencies=tenant_deps)
api_router.include_router(release_center.router, dependencies=tenant_deps)
api_router.include_router(integration_registry.router, dependencies=tenant_deps)
