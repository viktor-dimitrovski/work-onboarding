from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.report import AdminDashboardReport, EmployeeDashboardReport, MentorDashboardReport
from app.services import report_service


router = APIRouter(prefix='/reports', tags=['reports'])


@router.get('/admin-dashboard', response_model=AdminDashboardReport)
def admin_dashboard(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('reports', 'reports:read')),
) -> AdminDashboardReport:
    if not {'tenant_admin', 'manager'} & set(ctx.roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Insufficient permissions')
    return AdminDashboardReport(**report_service.admin_dashboard(db))


@router.get('/employee-dashboard', response_model=EmployeeDashboardReport)
def employee_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> EmployeeDashboardReport:
    return EmployeeDashboardReport(**report_service.employee_dashboard(db, employee_id=current_user.id))


@router.get('/mentor-dashboard', response_model=MentorDashboardReport)
def mentor_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    ctx: TenantContext = Depends(require_tenant_membership),
    __: object = Depends(require_access('assignments', 'assignments:read')),
) -> MentorDashboardReport:
    if not {'mentor', 'tenant_admin', 'manager'} & set(ctx.roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Insufficient permissions')
    return MentorDashboardReport(**report_service.mentor_dashboard(db, mentor_id=current_user.id))
