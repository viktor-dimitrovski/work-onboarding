import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import AuditUserMixin, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.comment import Comment


class OnboardingAssignment(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'onboarding_assignments'
    __table_args__ = (
        CheckConstraint(
            "status in ('not_started', 'in_progress', 'blocked', 'completed', 'overdue', 'archived')",
            name='onboarding_assignment_status_values',
        ),
        CheckConstraint('target_date >= start_date', name='onboarding_assignment_target_date_values'),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False
    )
    mentor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('track_templates.id', ondelete='RESTRICT'), nullable=False
    )
    track_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('track_versions.id', ondelete='RESTRICT'), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='not_started', index=True)
    progress_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column('snapshot', JSONB, nullable=False, default=dict)

    phases: Mapped[list['AssignmentPhase']] = relationship(
        back_populates='assignment', cascade='all, delete-orphan', order_by='AssignmentPhase.order_index'
    )
    tasks: Mapped[list['AssignmentTask']] = relationship(
        back_populates='assignment', cascade='all, delete-orphan', order_by='AssignmentTask.order_index'
    )
    comments: Mapped[list['Comment']] = relationship(
        back_populates='assignment', cascade='all, delete-orphan', order_by='Comment.created_at'
    )


class AssignmentPhase(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assignment_phases'
    __table_args__ = (
        UniqueConstraint('assignment_id', 'order_index', name='uq_assignment_phases_assignment_order'),
        CheckConstraint(
            "status in ('not_started', 'in_progress', 'completed')",
            name='assignment_phase_status_values',
        ),
    )

    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('onboarding_assignments.id', ondelete='CASCADE'), nullable=False
    )
    source_phase_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='not_started')
    progress_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    assignment: Mapped['OnboardingAssignment'] = relationship(back_populates='phases')
    tasks: Mapped[list['AssignmentTask']] = relationship(
        back_populates='phase', cascade='all, delete-orphan', order_by='AssignmentTask.order_index'
    )


class AssignmentTask(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assignment_tasks'
    __table_args__ = (
        UniqueConstraint('assignment_phase_id', 'order_index', name='uq_assignment_tasks_phase_order'),
        CheckConstraint(
            "status in ('not_started', 'in_progress', 'blocked', 'pending_review', 'revision_requested', 'completed', 'overdue')",
            name='assignment_task_status_values',
        ),
    )

    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('onboarding_assignments.id', ondelete='CASCADE'), nullable=False
    )
    assignment_phase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignment_phases.id', ondelete='CASCADE'), nullable=False
    )
    source_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)
    required: Mapped[bool] = mapped_column(nullable=False, default=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    passing_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column('metadata', JSONB, nullable=False, default=dict)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='not_started', index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    progress_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_next_recommended: Mapped[bool] = mapped_column(nullable=False, default=False, index=True)

    assignment: Mapped['OnboardingAssignment'] = relationship(back_populates='tasks')
    phase: Mapped['AssignmentPhase'] = relationship(back_populates='tasks')
    submissions: Mapped[list['TaskSubmission']] = relationship(
        back_populates='assignment_task', cascade='all, delete-orphan', order_by='TaskSubmission.submitted_at'
    )
    mentor_reviews: Mapped[list['MentorReview']] = relationship(
        back_populates='assignment_task', cascade='all, delete-orphan', order_by='MentorReview.reviewed_at'
    )
    quiz_attempts: Mapped[list['QuizAttempt']] = relationship(
        back_populates='assignment_task', cascade='all, delete-orphan', order_by='QuizAttempt.attempt_number'
    )


class TaskSubmission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'task_submissions'
    __table_args__ = (
        CheckConstraint(
            "status in ('submitted', 'reviewed', 'revision_requested')",
            name='task_submission_status_values',
        ),
    )

    assignment_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignment_tasks.id', ondelete='CASCADE'), nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False
    )
    submission_type: Mapped[str] = mapped_column(String(50), nullable=False)
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column('metadata', JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='submitted')
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    assignment_task: Mapped['AssignmentTask'] = relationship(back_populates='submissions')


class MentorReview(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'mentor_reviews'
    __table_args__ = (
        CheckConstraint(
            "decision in ('approve', 'reject', 'revision_requested')",
            name='mentor_review_decision_values',
        ),
    )

    assignment_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignment_tasks.id', ondelete='CASCADE'), nullable=False
    )
    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey('task_submissions.id', ondelete='SET NULL'), nullable=True
    )
    mentor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False
    )
    decision: Mapped[str] = mapped_column(String(30), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    assignment_task: Mapped['AssignmentTask'] = relationship(back_populates='mentor_reviews')


class QuizAttempt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'quiz_attempts'

    assignment_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('assignment_tasks.id', ondelete='CASCADE'), nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    max_score: Mapped[float] = mapped_column(Float, nullable=False)
    passed: Mapped[bool] = mapped_column(nullable=False, default=False)
    answers_json: Mapped[dict[str, Any]] = mapped_column('answers', JSONB, nullable=False, default=dict)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    assignment_task: Mapped['AssignmentTask'] = relationship(back_populates='quiz_attempts')


Index('ix_onboarding_assignments_employee_id', OnboardingAssignment.employee_id)
Index('ix_onboarding_assignments_mentor_id', OnboardingAssignment.mentor_id)
Index('ix_onboarding_assignments_track_version_id', OnboardingAssignment.track_version_id)
Index('ix_assignment_phases_assignment_id', AssignmentPhase.assignment_id)
Index('ix_assignment_tasks_assignment_id', AssignmentTask.assignment_id)
Index('ix_assignment_tasks_assignment_phase_id', AssignmentTask.assignment_phase_id)
Index('ix_task_submissions_assignment_task_id', TaskSubmission.assignment_task_id)
Index('ix_task_submissions_employee_id', TaskSubmission.employee_id)
Index('ix_mentor_reviews_assignment_task_id', MentorReview.assignment_task_id)
Index('ix_mentor_reviews_mentor_id', MentorReview.mentor_id)
Index('ix_quiz_attempts_assignment_task_id', QuizAttempt.assignment_task_id)
Index('ix_quiz_attempts_employee_id', QuizAttempt.employee_id)
