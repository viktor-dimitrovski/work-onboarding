import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.assignment import OnboardingAssignment


class Comment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = 'comments'
    __table_args__ = (
        CheckConstraint("visibility in ('all', 'mentor_only', 'admin_only')", name='comment_visibility_values'),
        ForeignKeyConstraint(
            ['tenant_id', 'assignment_id'],
            ['onboarding_assignments.tenant_id', 'onboarding_assignments.id'],
            ondelete='CASCADE',
        ),
        ForeignKeyConstraint(
            ['tenant_id', 'assignment_task_id'],
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
    assignment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    assignment_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey('users.id', ondelete='RESTRICT'), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default='all')

    assignment: Mapped['OnboardingAssignment'] = relationship(back_populates='comments')


Index('ix_comments_assignment_id', Comment.assignment_id)
Index('ix_comments_assignment_task_id', Comment.assignment_task_id)
Index('ix_comments_author_id', Comment.author_id)
