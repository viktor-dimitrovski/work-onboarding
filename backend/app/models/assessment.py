import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import AuditUserMixin, TimestampMixin, UUIDPrimaryKeyMixin


class AssessmentCategory(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_categories'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'slug', name='uq_assessment_category_slug'),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    questions: Mapped[list['AssessmentQuestion']] = relationship(back_populates='category')


class AssessmentQuestion(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_questions'
    __table_args__ = (
        CheckConstraint(
            "question_type in ('mcq_single', 'mcq_multi')",
            name='assessment_question_type_values',
        ),
        CheckConstraint(
            "status in ('draft', 'published', 'archived')",
            name='assessment_question_status_values',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'category_id'],
            ['assessment_categories.tenant_id', 'assessment_categories.id'],
            ondelete='SET NULL',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    difficulty: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='draft', index=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    category: Mapped['AssessmentCategory | None'] = relationship(back_populates='questions')
    options: Mapped[list['AssessmentQuestionOption']] = relationship(
        back_populates='question',
        cascade='all, delete-orphan',
        order_by='AssessmentQuestionOption.order_index',
    )


class AssessmentQuestionOption(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_question_options'
    __table_args__ = (
        UniqueConstraint('question_id', 'order_index', name='uq_assessment_question_option_order'),
        ForeignKeyConstraint(
            ['tenant_id', 'question_id'],
            ['assessment_questions.tenant_id', 'assessment_questions.id'],
            ondelete='CASCADE',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    question_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    option_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    question: Mapped['AssessmentQuestion'] = relationship(back_populates='options')


class AssessmentClassificationJob(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_classification_jobs'
    __table_args__ = (
        CheckConstraint(
            "status in ('queued', 'running', 'completed', 'failed')",
            name='assessment_classification_job_status_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='queued', index=True)
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class AssessmentTest(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_tests'
    __table_args__ = (
        CheckConstraint(
            "status in ('draft', 'published', 'archived')",
            name='assessment_test_status_values',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    role_target: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='draft', index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    versions: Mapped[list['AssessmentTestVersion']] = relationship(
        back_populates='test', cascade='all, delete-orphan', order_by='AssessmentTestVersion.version_number'
    )


class AssessmentTestVersion(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_test_versions'
    __table_args__ = (
        UniqueConstraint('test_id', 'version_number', name='uq_assessment_test_versions_test_version'),
        CheckConstraint(
            "status in ('draft', 'published', 'archived')",
            name='assessment_test_version_status_values',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'test_id'],
            ['assessment_tests.tenant_id', 'assessment_tests.id'],
            ondelete='CASCADE',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='draft', index=True)
    passing_score: Mapped[int] = mapped_column(Integer, nullable=False, default=80)
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attempts_allowed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    test: Mapped['AssessmentTest'] = relationship(back_populates='versions')
    questions: Mapped[list['AssessmentTestVersionQuestion']] = relationship(
        back_populates='test_version',
        cascade='all, delete-orphan',
        order_by='AssessmentTestVersionQuestion.order_index',
    )


class AssessmentTestVersionQuestion(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_test_version_questions'
    __table_args__ = (
        UniqueConstraint(
            'test_version_id', 'order_index', name='uq_assessment_test_version_question_order'
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'test_version_id'],
            ['assessment_test_versions.tenant_id', 'assessment_test_versions.id'],
            ondelete='CASCADE',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'question_id'],
            ['assessment_questions.tenant_id', 'assessment_questions.id'],
            ondelete='SET NULL',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    test_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    question_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    question_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    test_version: Mapped['AssessmentTestVersion'] = relationship(back_populates='questions')


class AssessmentDelivery(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_deliveries'
    __table_args__ = (
        CheckConstraint(
            "audience_type in ('assignment', 'campaign')",
            name='assessment_delivery_audience_values',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'test_version_id'],
            ['assessment_test_versions.tenant_id', 'assessment_test_versions.id'],
            ondelete='RESTRICT',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'source_assignment_id'],
            ['onboarding_assignments.tenant_id', 'onboarding_assignments.id'],
            ondelete='SET NULL',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'source_assignment_task_id'],
            ['assignment_tasks.tenant_id', 'assignment_tasks.id'],
            ondelete='SET NULL',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    test_version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    audience_type: Mapped[str] = mapped_column(String(30), nullable=False, default='assignment', index=True)
    source_assignment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_assignment_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    participant_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts_allowed: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    test_version: Mapped['AssessmentTestVersion'] = relationship()
    attempts: Mapped[list['AssessmentAttempt']] = relationship(
        back_populates='delivery', cascade='all, delete-orphan', order_by='AssessmentAttempt.attempt_number'
    )


class AssessmentAttempt(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_attempts'
    __table_args__ = (
        UniqueConstraint(
            'delivery_id', 'user_id', 'attempt_number', name='uq_assessment_attempt_delivery_user'
        ),
        CheckConstraint(
            "status in ('in_progress', 'submitted', 'scored', 'expired')",
            name='assessment_attempt_status_values',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'delivery_id'],
            ['assessment_deliveries.tenant_id', 'assessment_deliveries.id'],
            ondelete='CASCADE',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    delivery_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='in_progress')
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    question_order: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    delivery: Mapped['AssessmentDelivery'] = relationship(back_populates='attempts')
    answers: Mapped[list['AssessmentAttemptAnswer']] = relationship(
        back_populates='attempt', cascade='all, delete-orphan', order_by='AssessmentAttemptAnswer.question_index'
    )


class AssessmentAttemptAnswer(UUIDPrimaryKeyMixin, TimestampMixin, AuditUserMixin, Base):
    __tablename__ = 'assessment_attempt_answers'
    __table_args__ = (
        UniqueConstraint('attempt_id', 'question_index', name='uq_assessment_attempt_answer_order'),
        ForeignKeyConstraint(
            ['tenant_id', 'attempt_id'],
            ['assessment_attempts.tenant_id', 'assessment_attempts.id'],
            ondelete='CASCADE',
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
        server_default=text("current_setting('app.tenant_id')::uuid"),
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    question_index: Mapped[int] = mapped_column(Integer, nullable=False)
    selected_option_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    attempt: Mapped['AssessmentAttempt'] = relationship(back_populates='answers')


Index('ix_assessment_questions_status', AssessmentQuestion.status)
Index('ix_assessment_questions_difficulty', AssessmentQuestion.difficulty)
Index('ix_assessment_questions_type', AssessmentQuestion.question_type)
Index('ix_assessment_questions_category_id', AssessmentQuestion.category_id)
Index('ix_assessment_question_options_question_id', AssessmentQuestionOption.question_id)
Index('ix_assessment_classification_jobs_status', AssessmentClassificationJob.status)
Index('ix_assessment_tests_status', AssessmentTest.status)
Index('ix_assessment_tests_category', AssessmentTest.category)
Index('ix_assessment_test_versions_test_id', AssessmentTestVersion.test_id)
Index('ix_assessment_deliveries_participant_user', AssessmentDelivery.participant_user_id)
Index('ix_assessment_deliveries_source_assignment', AssessmentDelivery.source_assignment_id)
Index('ix_assessment_attempts_delivery_id', AssessmentAttempt.delivery_id)
Index('ix_assessment_attempts_user_id', AssessmentAttempt.user_id)
