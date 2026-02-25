from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, distinct, func, select
from sqlalchemy.orm import Session

from app.models.assignment import AssignmentTask, MentorReview, OnboardingAssignment


def admin_dashboard(db: Session) -> dict[str, float | int]:
    active_onboardings = int(
        db.scalar(
            select(func.count())
            .select_from(OnboardingAssignment)
            .where(OnboardingAssignment.status.in_(['not_started', 'in_progress', 'blocked', 'overdue']))
        )
        or 0
    )

    completion_rate_percent = float(
        db.scalar(select(func.coalesce(func.avg(OnboardingAssignment.progress_percent), 0.0))) or 0.0
    )

    overdue_tasks = int(
        db.scalar(
            select(func.count())
            .select_from(AssignmentTask)
            .where(
                AssignmentTask.due_date < date.today(),
                AssignmentTask.status.notin_(['completed']),
            )
        )
        or 0
    )

    mentor_approval_queue = int(
        db.scalar(
            select(func.count())
            .select_from(AssignmentTask)
            .where(AssignmentTask.status == 'pending_review')
        )
        or 0
    )

    return {
        'active_onboardings': active_onboardings,
        'completion_rate_percent': round(completion_rate_percent, 2),
        'overdue_tasks': overdue_tasks,
        'mentor_approval_queue': mentor_approval_queue,
    }


def employee_dashboard(db: Session, *, employee_id: UUID) -> dict[str, float | int | str | None]:
    assignments = db.scalars(
        select(OnboardingAssignment).where(OnboardingAssignment.employee_id == employee_id)
    ).all()
    assignment_ids = [assignment.id for assignment in assignments]

    upcoming_cutoff = date.today() + timedelta(days=7)

    upcoming_tasks = 0
    overdue_tasks = 0
    current_phase = None

    if assignment_ids:
        upcoming_tasks = int(
            db.scalar(
                select(func.count())
                .select_from(AssignmentTask)
                .where(
                    AssignmentTask.assignment_id.in_(assignment_ids),
                    AssignmentTask.status.in_(['not_started', 'in_progress', 'revision_requested']),
                    AssignmentTask.due_date.is_not(None),
                    AssignmentTask.due_date <= upcoming_cutoff,
                    AssignmentTask.due_date >= date.today(),
                )
            )
            or 0
        )

        overdue_tasks = int(
            db.scalar(
                select(func.count())
                .select_from(AssignmentTask)
                .where(
                    AssignmentTask.assignment_id.in_(assignment_ids),
                    AssignmentTask.status.notin_(['completed']),
                    AssignmentTask.due_date.is_not(None),
                    AssignmentTask.due_date < date.today(),
                )
            )
            or 0
        )

        first_active = next(
            (
                assignment
                for assignment in sorted(assignments, key=lambda row: row.created_at, reverse=True)
                if assignment.status in {'not_started', 'in_progress', 'blocked', 'overdue'}
            ),
            None,
        )
        if first_active:
            current_phase = first_active.title

    average_progress_percent = 0.0
    if assignments:
        average_progress_percent = round(
            sum(assignment.progress_percent for assignment in assignments) / len(assignments),
            2,
        )

    return {
        'assignment_count': len(assignments),
        'current_phase': current_phase,
        'upcoming_tasks': upcoming_tasks,
        'overdue_tasks': overdue_tasks,
        'average_progress_percent': average_progress_percent,
    }


def mentor_dashboard(db: Session, *, mentor_id: UUID) -> dict[str, int]:
    mentee_count = int(
        db.scalar(
            select(func.count(distinct(OnboardingAssignment.employee_id))).where(
                OnboardingAssignment.mentor_id == mentor_id
            )
        )
        or 0
    )

    pending_reviews = int(
        db.scalar(
            select(func.count())
            .select_from(AssignmentTask)
            .join(OnboardingAssignment, AssignmentTask.assignment_id == OnboardingAssignment.id)
            .where(
                and_(
                    OnboardingAssignment.mentor_id == mentor_id,
                    AssignmentTask.status == 'pending_review',
                )
            )
        )
        or 0
    )

    recent_feedback = int(
        db.scalar(
            select(func.count())
            .select_from(MentorReview)
            .where(
                MentorReview.mentor_id == mentor_id,
                MentorReview.reviewed_at >= datetime.now(UTC) - timedelta(days=14),
            )
        )
        or 0
    )

    return {
        'mentee_count': mentee_count,
        'pending_reviews': pending_reviews,
        'recent_feedback': recent_feedback,
    }
