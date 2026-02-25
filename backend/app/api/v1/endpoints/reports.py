from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.report import AdminDashboardReport, EmployeeDashboardReport, MentorDashboardReport
from app.services import report_service


router = APIRouter(prefix='/reports', tags=['reports'])


@router.get('/admin-dashboard', response_model=AdminDashboardReport)
def admin_dashboard(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles('super_admin', 'admin', 'hr_viewer')),
) -> AdminDashboardReport:
    return AdminDashboardReport(**report_service.admin_dashboard(db))


@router.get('/employee-dashboard', response_model=EmployeeDashboardReport)
def employee_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('employee', 'super_admin', 'admin')),
) -> EmployeeDashboardReport:
    return EmployeeDashboardReport(**report_service.employee_dashboard(db, employee_id=current_user.id))


@router.get('/mentor-dashboard', response_model=MentorDashboardReport)
def mentor_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('mentor', 'super_admin', 'admin', 'reviewer')),
) -> MentorDashboardReport:
    return MentorDashboardReport(**report_service.mentor_dashboard(db, mentor_id=current_user.id))
