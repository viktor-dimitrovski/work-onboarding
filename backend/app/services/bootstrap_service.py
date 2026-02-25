from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.rbac import Role, User, UserRole


ROLE_DESCRIPTIONS = {
    'super_admin': 'Full system access and governance.',
    'admin': 'Operational administrator for tracks and assignments.',
    'mentor': 'Reviews mentee submissions and approvals.',
    'employee': 'Completes assigned onboarding tasks.',
    'hr_viewer': 'Read-only HR reporting access.',
    'reviewer': 'Optional evaluator for specialized assessments.',
}


def ensure_reference_data(db: Session) -> None:
    existing_roles = {role.name: role for role in db.scalars(select(Role)).all()}

    for role_name, description in ROLE_DESCRIPTIONS.items():
        if role_name not in existing_roles:
            db.add(Role(name=role_name, description=description))

    db.flush()

    admin = db.scalar(select(User).where(User.email == settings.FIRST_ADMIN_EMAIL.lower()))
    if not admin:
        admin = User(
            email=settings.FIRST_ADMIN_EMAIL.lower(),
            full_name='Initial Super Admin',
            hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
            is_active=True,
        )
        db.add(admin)
        db.flush()

    role_rows = db.scalars(select(Role).where(Role.name.in_(['super_admin', 'admin']))).all()
    role_ids = {row.role_id for row in db.scalars(select(UserRole).where(UserRole.user_id == admin.id)).all()}

    for role in role_rows:
        if role.id not in role_ids:
            db.add(UserRole(user_id=admin.id, role_id=role.id))

    db.flush()
