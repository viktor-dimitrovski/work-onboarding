import uuid

import pytest
from sqlalchemy import text

from app.models.tenant import Tenant
from app.models.track import TrackTemplate
from app.models.compliance import ComplianceControlStatus
from app.models.release_mgmt import ReleaseWorkOrder


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


def _enable_rls_schema(db, table: str) -> None:
    policy = f"tenant_isolation_{table.replace('.', '_')}"
    db.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
    db.execute(
        text(
            f"""
            CREATE POLICY {policy}
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


def test_release_mgmt_rls(db_session):
    tenant_a = Tenant(id=uuid.uuid4(), name='Tenant A', slug='tenant-a', tenant_type='company')
    tenant_b = Tenant(id=uuid.uuid4(), name='Tenant B', slug='tenant-b', tenant_type='company')
    db_session.add_all([tenant_a, tenant_b])
    db_session.commit()

    _enable_rls_schema(db_session, 'release_mgmt.work_orders')
    db_session.commit()

    _set_tenant(db_session, tenant_a.id)
    db_session.add(ReleaseWorkOrder(wo_id='WO-2026-0001', title='Tenant A WO'))
    db_session.commit()

    _set_tenant(db_session, tenant_b.id)
    results = db_session.query(ReleaseWorkOrder).all()
    assert results == []

    _set_tenant(db_session, tenant_b.id)
    with pytest.raises(Exception):
        db_session.add(ReleaseWorkOrder(wo_id='WO-2026-0002', title='Wrong tenant', tenant_id=tenant_a.id))
        db_session.commit()


def test_compliance_rls(db_session):
    tenant_a = Tenant(id=uuid.uuid4(), name='Tenant A', slug='tenant-a', tenant_type='company')
    tenant_b = Tenant(id=uuid.uuid4(), name='Tenant B', slug='tenant-b', tenant_type='company')
    db_session.add_all([tenant_a, tenant_b])
    db_session.commit()

    _enable_rls_schema(db_session, 'compliance.control_status')
    db_session.commit()

    _set_tenant(db_session, tenant_a.id)
    db_session.add(ComplianceControlStatus(control_key='CTL_TEST_01', status_enum='not_started', score=0))
    db_session.commit()

    _set_tenant(db_session, tenant_b.id)
    results = db_session.query(ComplianceControlStatus).all()
    assert results == []

    _set_tenant(db_session, tenant_b.id)
    with pytest.raises(Exception):
        db_session.add(
            ComplianceControlStatus(
                control_key='CTL_TEST_01',
                status_enum='not_started',
                score=0,
                tenant_id=tenant_a.id,
            )
        )
        db_session.commit()
