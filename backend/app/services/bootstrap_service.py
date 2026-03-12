from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.rbac import Role, User, UserRole
from app.models.tenant import Tenant, TenantMembership
from app.db.session import set_tenant_id
from app.modules.billing.models import CreditPack, Meter, MeterRate, Plan, PlanPrice


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
            password_change_required=False,
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
                roles_json=['tenant_admin'],
                status='active',
            )
        )
        db.flush()

    ensure_billing_reference_data(db)


_ALL_MODULES = {
    'tracks', 'assignments', 'assessments', 'reports', 'compliance',
    'users', 'settings', 'billing', 'releases', 'integration_registry',
}

SEED_PLANS: list[dict] = [
    {
        'key': 'free',
        'name': 'Free',
        'tenant_type_scope': 'all',
        'module_defaults': {
            'tracks': True,
            'assignments': True,
            'assessments': False,
            'reports': False,
            'compliance': False,
            'users': True,
            'settings': True,
            'billing': False,
            'releases': False,
            'integration_registry': False,
        },
        'limits_json': {
            'max_users': 5,
            'max_tracks': 3,
            'max_assessments': 10,
            'max_file_uploads_per_month': 50,
            'max_ai_pdf_imports_per_month': 5,
            'max_ai_classifications_per_month': 20,
            'storage_mb': 500,
        },
    },
    {
        'key': 'starter',
        'name': 'Starter',
        'tenant_type_scope': 'all',
        'module_defaults': {
            'tracks': True,
            'assignments': True,
            'assessments': True,
            'reports': True,
            'compliance': False,
            'users': True,
            'settings': True,
            'billing': True,
            'releases': False,
            'integration_registry': False,
        },
        'limits_json': {
            'max_users': 25,
            'max_tracks': 20,
            'max_assessments': 100,
            'max_file_uploads_per_month': 500,
            'max_ai_pdf_imports_per_month': 50,
            'max_ai_classifications_per_month': 200,
            'storage_mb': 5000,
        },
    },
    {
        'key': 'professional',
        'name': 'Professional',
        'tenant_type_scope': 'all',
        'module_defaults': {
            'tracks': True,
            'assignments': True,
            'assessments': True,
            'reports': True,
            'compliance': True,
            'users': True,
            'settings': True,
            'billing': True,
            'releases': True,
            'integration_registry': False,
        },
        'limits_json': {
            'max_users': 200,
            'max_tracks': -1,
            'max_assessments': -1,
            'max_file_uploads_per_month': 5000,
            'max_ai_pdf_imports_per_month': 500,
            'max_ai_classifications_per_month': 2000,
            'storage_mb': 50000,
        },
    },
    {
        'key': 'enterprise',
        'name': 'Enterprise',
        'tenant_type_scope': 'all',
        'module_defaults': {k: True for k in _ALL_MODULES},
        'limits_json': {
            'max_users': -1,
            'max_tracks': -1,
            'max_assessments': -1,
            'max_file_uploads_per_month': -1,
            'max_ai_pdf_imports_per_month': -1,
            'max_ai_classifications_per_month': -1,
            'storage_mb': -1,
        },
    },
    {
        'key': 'education-starter',
        'name': 'Education Starter',
        'tenant_type_scope': 'education',
        'module_defaults': {
            'tracks': True,
            'assignments': True,
            'assessments': True,
            'reports': True,
            'compliance': False,
            'users': True,
            'settings': True,
            'billing': True,
            'releases': False,
            'integration_registry': False,
        },
        'limits_json': {
            'max_users': 50,
            'max_tracks': 20,
            'max_assessments': 200,
            'max_file_uploads_per_month': 500,
            'max_ai_pdf_imports_per_month': 50,
            'max_ai_classifications_per_month': 200,
            'storage_mb': 5000,
        },
    },
    {
        'key': 'education-pro',
        'name': 'Education Professional',
        'tenant_type_scope': 'education',
        'module_defaults': {
            'tracks': True,
            'assignments': True,
            'assessments': True,
            'reports': True,
            'compliance': True,
            'users': True,
            'settings': True,
            'billing': True,
            'releases': True,
            'integration_registry': False,
        },
        'limits_json': {
            'max_users': 500,
            'max_tracks': -1,
            'max_assessments': -1,
            'max_file_uploads_per_month': 5000,
            'max_ai_pdf_imports_per_month': 500,
            'max_ai_classifications_per_month': 2000,
            'storage_mb': 50000,
        },
    },
]

SEED_PLAN_PRICES: list[dict] = [
    {'plan_key': 'free', 'interval': 'month', 'currency': 'eur', 'amount': Decimal('0.00'), 'nickname': 'Free'},
    {'plan_key': 'starter', 'interval': 'month', 'currency': 'eur', 'amount': Decimal('29.00'), 'nickname': 'Starter Monthly'},
    {'plan_key': 'starter', 'interval': 'year', 'currency': 'eur', 'amount': Decimal('290.00'), 'nickname': 'Starter Yearly'},
    {'plan_key': 'professional', 'interval': 'month', 'currency': 'eur', 'amount': Decimal('99.00'), 'nickname': 'Professional Monthly'},
    {'plan_key': 'professional', 'interval': 'year', 'currency': 'eur', 'amount': Decimal('990.00'), 'nickname': 'Professional Yearly'},
    {'plan_key': 'enterprise', 'interval': 'month', 'currency': 'eur', 'amount': Decimal('299.00'), 'nickname': 'Enterprise Monthly'},
    {'plan_key': 'enterprise', 'interval': 'year', 'currency': 'eur', 'amount': Decimal('2990.00'), 'nickname': 'Enterprise Yearly'},
    {'plan_key': 'education-starter', 'interval': 'month', 'currency': 'eur', 'amount': Decimal('19.00'), 'nickname': 'Edu Starter Monthly'},
    {'plan_key': 'education-starter', 'interval': 'year', 'currency': 'eur', 'amount': Decimal('190.00'), 'nickname': 'Edu Starter Yearly'},
    {'plan_key': 'education-pro', 'interval': 'month', 'currency': 'eur', 'amount': Decimal('59.00'), 'nickname': 'Edu Pro Monthly'},
    {'plan_key': 'education-pro', 'interval': 'year', 'currency': 'eur', 'amount': Decimal('590.00'), 'nickname': 'Edu Pro Yearly'},
]

SEED_CREDIT_PACKS: list[dict] = [
    {'key': 'ai-100', 'name': '100 AI Credits', 'credits': 100, 'price_amount': Decimal('4.99'), 'currency': 'eur'},
    {'key': 'ai-500', 'name': '500 AI Credits', 'credits': 500, 'price_amount': Decimal('19.99'), 'currency': 'eur'},
    {'key': 'ai-2000', 'name': '2000 AI Credits', 'credits': 2000, 'price_amount': Decimal('59.99'), 'currency': 'eur'},
]

SEED_METERS: list[dict] = [
    {'event_key': 'active_user_day', 'name': 'Active user day', 'unit_label': 'day', 'unit_price': Decimal('0.05')},
    {'event_key': 'assignment.task_submit', 'name': 'Task submissions', 'unit_label': 'task', 'unit_price': Decimal('0.01')},
    {'event_key': 'quiz_attempt', 'name': 'Quiz attempts', 'unit_label': 'attempt', 'unit_price': Decimal('0.01')},
    {'event_key': 'file_upload', 'name': 'File uploads', 'unit_label': 'file', 'unit_price': Decimal('0.002')},
    {'event_key': 'assessment.attempt_submit', 'name': 'Assessment submissions', 'unit_label': 'attempt', 'unit_price': Decimal('0.02')},
    {'event_key': 'ai.pdf_import', 'name': 'AI PDF imports', 'unit_label': 'question', 'unit_price': Decimal('0.03')},
    {'event_key': 'ai.classify_questions', 'name': 'AI question classification', 'unit_label': 'question', 'unit_price': Decimal('0.005')},
]


def ensure_billing_reference_data(db: Session) -> None:
    inspector = inspect(db.get_bind())
    if 'billing' not in inspector.get_schema_names():
        return
    if 'meters' not in inspector.get_table_names(schema='billing'):
        return

    now = datetime.now(timezone.utc)

    for seed in SEED_METERS:
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
            .where(MeterRate.meter_id == meter.id, MeterRate.currency == 'eur')
            .order_by(MeterRate.effective_from.desc())
        )
        if not existing_rate:
            db.add(
                MeterRate(
                    meter_id=meter.id,
                    currency='eur',
                    unit_price=seed['unit_price'],
                    pricing_json={},
                    effective_from=now,
                    effective_until=None,
                    is_active=True,
                )
            )

    _ensure_plans(db)
    _ensure_plan_prices(db)
    _ensure_credit_packs(db)


def _ensure_plans(db: Session) -> None:
    for seed in SEED_PLANS:
        existing = db.scalar(select(Plan).where(Plan.key == seed['key']))
        if existing:
            continue
        db.add(Plan(
            key=seed['key'],
            name=seed['name'],
            tenant_type_scope=seed['tenant_type_scope'],
            module_defaults=seed['module_defaults'],
            limits_json=seed['limits_json'],
            is_active=True,
        ))
    db.flush()


def _ensure_plan_prices(db: Session) -> None:
    plan_lookup: dict[str, Plan] = {}
    for plan in db.scalars(select(Plan)).all():
        plan_lookup[plan.key] = plan

    for seed in SEED_PLAN_PRICES:
        plan = plan_lookup.get(seed['plan_key'])
        if not plan:
            continue
        existing = db.scalar(
            select(PlanPrice).where(
                PlanPrice.plan_id == plan.id,
                PlanPrice.provider == 'stripe',
                PlanPrice.billing_interval == seed['interval'],
                PlanPrice.currency == seed['currency'],
            )
        )
        if existing:
            continue
        db.add(PlanPrice(
            plan_id=plan.id,
            provider='stripe',
            billing_interval=seed['interval'],
            currency=seed['currency'],
            amount=seed['amount'],
            nickname=seed['nickname'],
            provider_price_id=None,
        ))
    db.flush()


def _ensure_credit_packs(db: Session) -> None:
    for seed in SEED_CREDIT_PACKS:
        existing = db.scalar(select(CreditPack).where(CreditPack.key == seed['key']))
        if existing:
            continue
        db.add(CreditPack(
            key=seed['key'],
            name=seed['name'],
            currency=seed.get('currency', 'eur'),
            credits=seed['credits'],
            price_amount=seed['price_amount'],
            is_active=True,
        ))
    db.flush()
