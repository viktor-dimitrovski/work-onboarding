import uuid

import pytest
from sqlalchemy import text

from app.models.tenant import Tenant
from app.models.track import TrackTemplate


def _set_tenant(db, tenant_id: uuid.UUID) -> None:
    db.execute(text("select set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": str(tenant_id)})


def _enable_rls(db, table: str) -> None:
    db.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
    db.execute(
        text(
            f"""
            CREATE POLICY tenant_isolation_{table}
            ON {table}
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
            """
        )
    )


def test_rls_blocks_cross_tenant_reads_and_writes(db_session):
    tenant_a = Tenant(id=uuid.uuid4(), name='Tenant A', slug='tenant-a', tenant_type='company')
    tenant_b = Tenant(id=uuid.uuid4(), name='Tenant B', slug='tenant-b', tenant_type='company')
    db_session.add_all([tenant_a, tenant_b])
    db_session.commit()

    _enable_rls(db_session, 'track_templates')
    db_session.commit()

    _set_tenant(db_session, tenant_a.id)
    template = TrackTemplate(title='Welcome', description='Tenant A', role_target=None)
    db_session.add(template)
    db_session.commit()

    _set_tenant(db_session, tenant_b.id)
    results = db_session.query(TrackTemplate).all()
    assert results == []

    _set_tenant(db_session, tenant_b.id)
    with pytest.raises(Exception):
        db_session.add(
            TrackTemplate(
                title='Invalid Insert',
                description='Wrong tenant',
                role_target=None,
                tenant_id=tenant_a.id,
            )
        )
        db_session.commit()
