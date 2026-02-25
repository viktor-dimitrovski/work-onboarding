from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_user_role_names, require_roles
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.assignment import AssignmentCreate, AssignmentListResponse, AssignmentOut
from app.schemas.common import PaginationMeta
from app.services import assignment_service, audit_service, track_service


router = APIRouter(prefix='/assignments', tags=['assignments'])


@router.get('', response_model=AssignmentListResponse)
def list_assignments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias='status'),
    employee_id: UUID | None = Query(default=None),
    mentor_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer')),
) -> AssignmentListResponse:
    roles = get_user_role_names(current_user)
    effective_employee_id = employee_id
    effective_mentor_id = mentor_id

    if 'employee' in roles and not {'super_admin', 'admin', 'hr_viewer'} & roles:
        effective_employee_id = current_user.id
    if 'mentor' in roles and not {'super_admin', 'admin', 'hr_viewer'} & roles:
        effective_mentor_id = current_user.id

    assignments, total = assignment_service.list_assignments(
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
        employee_id=effective_employee_id,
        mentor_id=effective_mentor_id,
    )

    return AssignmentListResponse(
        items=[AssignmentOut.model_validate(item) for item in assignments],
        meta=PaginationMeta(page=page, page_size=page_size, total=total),
    )


@router.post('', response_model=AssignmentOut, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin')),
) -> AssignmentOut:
    track_version = track_service.get_published_track_version(db, payload.track_version_id)

    assignment = assignment_service.create_assignment_from_track(
        db,
        actor_user_id=current_user.id,
        employee_id=payload.employee_id,
        mentor_id=payload.mentor_id,
        track_version=track_version,
        start_date=payload.start_date,
        target_date=payload.target_date,
    )
    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='assignment_create',
        entity_type='onboarding_assignment',
        entity_id=assignment.id,
        details={
            'employee_id': str(payload.employee_id),
            'mentor_id': str(payload.mentor_id) if payload.mentor_id else None,
            'track_version_id': str(payload.track_version_id),
        },
    )
    db.commit()

    return AssignmentOut.model_validate(assignment)


@router.get('/my', response_model=list[AssignmentOut])
def my_assignments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('employee')),
) -> list[AssignmentOut]:
    assignments = assignment_service.get_employee_assignments(db, employee_id=current_user.id)
    return [AssignmentOut.model_validate(item) for item in assignments]


@router.get('/{assignment_id}', response_model=AssignmentOut)
def get_assignment(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer')),
) -> AssignmentOut:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    assignment_service.access_guard(
        assignment,
        user_id=current_user.id,
        roles=get_user_role_names(current_user),
    )
    return AssignmentOut.model_validate(assignment)
