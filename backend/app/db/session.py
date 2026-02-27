from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

_DEFAULT_TENANT_ID: str | None = None


def _resolve_default_tenant_id(db: Session) -> str | None:
    """
    Resolve a fallback tenant ID for requests that don't set tenant context (e.g. /auth/login).

    This exists to keep RLS-backed tables (audit_log) writable even when no tenant host was resolved yet.
    """
    slug = settings.DEFAULT_TENANT_SLUG or 'default'
    tenant_id = db.execute(
        text("select id::text from tenants where slug = :slug limit 1"),
        {"slug": slug},
    ).scalar()
    if tenant_id:
        return str(tenant_id)

    tenant_id = db.execute(text("select id::text from tenants order by created_at asc limit 1")).scalar()
    return str(tenant_id) if tenant_id else None


def _ensure_session_tenant_id(db: Session) -> None:
    global _DEFAULT_TENANT_ID  # noqa: PLW0603
    existing = db.execute(text("select current_setting('app.tenant_id', true)")).scalar()
    if existing:
        return

    if not _DEFAULT_TENANT_ID:
        _DEFAULT_TENANT_ID = _resolve_default_tenant_id(db)

    if _DEFAULT_TENANT_ID:
        set_tenant_id(db, _DEFAULT_TENANT_ID)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        _ensure_session_tenant_id(db)
        yield db
    finally:
        db.close()


def set_tenant_id(db: Session, tenant_id: str) -> None:
    db.execute(text("SET LOCAL app.tenant_id = :tenant_id"), {"tenant_id": tenant_id})
