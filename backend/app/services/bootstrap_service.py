from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.rbac import Role, User, UserRole
from app.models.tenant import Tenant, TenantMembership
from app.db.session import set_tenant_id
from app.modules.billing.models import Meter, MeterRate


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

    # Ensure the initial super admin can operate inside the default tenant in local/dev.
    # Many API endpoints require a tenant membership (TenantContext.roles is derived from it).
    default_slug = (settings.DEFAULT_TENANT_SLUG or 'default').strip().lower()
    tenant = db.scalar(select(Tenant).where(Tenant.slug == default_slug))
    if not tenant:
        tenant = Tenant(name='Default Tenant', slug=default_slug, tenant_type='company', is_active=True)
        db.add(tenant)
        db.flush()

    # Set tenant context for RLS-protected inserts.
    set_tenant_id(db, str(tenant.id))

    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant.id,
            TenantMembership.user_id == admin.id,
        )
    )
    if not membership:
        db.add(
            TenantMembership(
                tenant_id=tenant.id,
                user_id=admin.id,
                role='tenant_admin',
                status='active',
            )
        )
        db.flush()

    ensure_billing_reference_data(db)


def ensure_billing_reference_data(db: Session) -> None:
    inspector = inspect(db.get_bind())
    if 'billing' not in inspector.get_schema_names():
        return
    if 'meters' not in inspector.get_table_names(schema='billing'):
        return

    now = datetime.now(timezone.utc)
    seed_meters = [
        {
            'event_key': 'active_user_day',
            'name': 'Active user day',
            'unit_label': 'day',
            'unit_price': Decimal('0.05'),
        },
        {
            'event_key': 'assignment.task_submit',
            'name': 'Task submissions',
            'unit_label': 'task',
            'unit_price': Decimal('0.01'),
        },
        {
            'event_key': 'quiz_attempt',
            'name': 'Quiz attempts',
            'unit_label': 'attempt',
            'unit_price': Decimal('0.01'),
        },
        {
            'event_key': 'file_upload',
            'name': 'File uploads',
            'unit_label': 'file',
            'unit_price': Decimal('0.002'),
        },
        {
            'event_key': 'assessment.attempt_submit',
            'name': 'Assessment submissions',
            'unit_label': 'attempt',
            'unit_price': Decimal('0.02'),
        },
        {
            'event_key': 'ai.pdf_import',
            'name': 'AI PDF imports',
            'unit_label': 'question',
            'unit_price': Decimal('0.03'),
        },
        {
            'event_key': 'ai.classify_questions',
            'name': 'AI question classification',
            'unit_label': 'question',
            'unit_price': Decimal('0.005'),
        },
    ]

    for seed in seed_meters:
        meter = db.scalar(select(Meter).where(Meter.event_key == seed['event_key']))
        if not meter:
            meter = Meter(
                event_key=seed['event_key'],
                name=seed['name'],
                unit_label=seed['unit_label'],
                aggregation='sum',
                rule_json={'type': 'simple_count'},
                is_active=True,
            )
            db.add(meter)
            db.flush()

        existing_rate = db.scalar(
            select(MeterRate)
            .where(MeterRate.meter_id == meter.id, MeterRate.currency == 'usd')
            .order_by(MeterRate.effective_from.desc())
        )
        if not existing_rate:
            db.add(
                MeterRate(
                    meter_id=meter.id,
                    currency='usd',
                    unit_price=seed['unit_price'],
                    pricing_json={},
                    effective_from=now,
                    effective_until=None,
                    is_active=True,
                )
            )
