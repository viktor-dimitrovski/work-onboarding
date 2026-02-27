from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_user_role_names, require_roles
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.assignment import AssignmentTaskOut, NextTaskResponse
from app.schemas.progress import MentorReviewCreate, MentorReviewOut, QuizAttemptOut, TaskSubmissionCreate, TaskSubmissionOut
from app.models.assignment import QuizAttempt
from app.services import assignment_service, audit_service, progress_service


router = APIRouter(prefix='/progress', tags=['progress'])


@router.post('/assignments/{assignment_id}/tasks/{task_id}/submit', response_model=TaskSubmissionOut)
def submit_task(
    assignment_id: UUID,
    task_id: UUID,
    payload: TaskSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('employee', 'super_admin', 'admin')),
) -> TaskSubmissionOut:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    roles = get_user_role_names(current_user)
    if 'employee' in roles and assignment.employee_id != current_user.id and 'super_admin' not in roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Employees can only submit their own tasks',
        )

    submission = progress_service.submit_task(
        db,
        assignment_id=assignment_id,
        task_id=task_id,
        employee_id=assignment.employee_id,
        submission_type=payload.submission_type,
        answer_text=payload.answer_text,
        file_url=payload.file_url,
        metadata=payload.metadata,
        quiz_score=payload.quiz_score,
        quiz_max_score=payload.quiz_max_score,
        quiz_answers=payload.quiz_answers,
    )
    db.commit()
    return TaskSubmissionOut.model_validate(submission)


@router.post('/assignments/{assignment_id}/tasks/{task_id}/review', response_model=MentorReviewOut)
def review_task(
    assignment_id: UUID,
    task_id: UUID,
    payload: MentorReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('mentor', 'super_admin', 'admin', 'reviewer')),
) -> MentorReviewOut:
    roles = get_user_role_names(current_user)
    review = progress_service.mentor_review_task(
        db,
        assignment_id=assignment_id,
        task_id=task_id,
        mentor_id=current_user.id,
        decision=payload.decision,
        comment=payload.comment,
        allow_override=bool({'super_admin', 'admin'} & roles),
    )

    audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action='mentor_review',
        entity_type='assignment_task',
        entity_id=task_id,
        details={
            'assignment_id': str(assignment_id),
            'decision': payload.decision,
        },
    )
    db.commit()
    return MentorReviewOut.model_validate(review)


@router.get('/assignments/{assignment_id}/next-task', response_model=NextTaskResponse)
def next_task(
    assignment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer')),
) -> NextTaskResponse:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    assignment_service.access_guard(
        assignment,
        user_id=current_user.id,
        roles=get_user_role_names(current_user),
    )
    task = assignment_service.find_next_task(db, assignment)
    return NextTaskResponse(
        assignment_id=assignment_id,
        task=AssignmentTaskOut.model_validate(task) if task else None,
    )


@router.get('/assignments/{assignment_id}/tasks/{task_id}/quiz-attempts', response_model=list[QuizAttemptOut])
def quiz_attempts(
    assignment_id: UUID,
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer')),
) -> list[QuizAttemptOut]:
    assignment = assignment_service.get_assignment_by_id(db, assignment_id)
    roles = get_user_role_names(current_user)
    assignment_service.access_guard(assignment, user_id=current_user.id, roles=roles)

    task = assignment_service.get_assignment_task(db, assignment_id=assignment_id, task_id=task_id)
    if task.task_type != 'quiz':
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Task is not a quiz')

    attempts = db.scalars(
        select(QuizAttempt)
        .where(QuizAttempt.assignment_task_id == task_id)
        .order_by(QuizAttempt.attempt_number.asc())
    ).all()

    return [QuizAttemptOut.model_validate(attempt) for attempt in attempts]
