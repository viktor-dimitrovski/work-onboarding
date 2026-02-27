from fastapi import APIRouter, Depends

from app.api.v1.endpoints import admin, assessments, assignments, auth, health, progress, reports, tracks, usage, users, tenants
from app.multitenancy.deps import require_tenant_membership


api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(users.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(tracks.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(assignments.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(progress.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(reports.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(assessments.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(tenants.router, dependencies=[Depends(require_tenant_membership)])
api_router.include_router(usage.router, dependencies=[Depends(require_tenant_membership)])
