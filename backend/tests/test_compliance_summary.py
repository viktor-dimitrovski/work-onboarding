import uuid

from app.models.compliance import (
    ComplianceControlStatus,
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantDomain,
    ComplianceTenantFramework,
    ComplianceTenantLibraryProfile,
    ComplianceTenantLibraryProfileControl,
    ComplianceTenantProfile,
)
from app.models.tenant import Tenant
from app.services.compliance_summary_service import compute_framework_summary, compute_summary


def test_compliance_summary_excludes_na(db_session):
    tenant = Tenant(id=uuid.uuid4(), name='Tenant A', slug='tenant-a', tenant_type='company')
    db_session.add(tenant)
    db_session.commit()

    domain = ComplianceTenantDomain(
        tenant_id=tenant.id, domain_code='api_security', label='API Security', is_active=True
    )
    framework = ComplianceTenantFramework(
        tenant_id=tenant.id,
        framework_key='FW_TEST',
        name='Test Framework',
        tags=[],
        references=[],
        is_active=True,
    )
    db_session.add_all([domain, framework])

    control_a = ComplianceTenantControl(
        tenant_id=tenant.id,
        control_key='CTL_A',
        code='A_01',
        title='A',
        description='A',
        domain_code=domain.domain_code,
        criticality='High',
        weight=2,
        evidence_expected='A',
        default_status='not_started',
        default_score=0,
        is_active=True,
    )
    control_b = ComplianceTenantControl(
        tenant_id=tenant.id,
        control_key='CTL_B',
        code='B_01',
        title='B',
        description='B',
        domain_code=domain.domain_code,
        criticality='Low',
        weight=3,
        evidence_expected='B',
        default_status='not_started',
        default_score=0,
        is_active=True,
    )
    db_session.add_all([control_a, control_b])

    db_session.add(
        ComplianceTenantControlFrameworkRef(
            tenant_id=tenant.id,
            control_key=control_a.control_key,
            framework_key=framework.framework_key,
            ref='A-REF',
            is_active=True,
        )
    )
    db_session.add(
        ComplianceTenantControlFrameworkRef(
            tenant_id=tenant.id,
            control_key=control_b.control_key,
            framework_key=framework.framework_key,
            ref='B-REF',
            is_active=True,
        )
    )

    profile = ComplianceTenantLibraryProfile(
        tenant_id=tenant.id,
        profile_key='PROFILE_TEST',
        name='Test',
        description='Test',
        is_active=True,
    )
    db_session.add(profile)
    db_session.add_all(
        [
            ComplianceTenantLibraryProfileControl(
                tenant_id=tenant.id,
                profile_key=profile.profile_key,
                control_key=control_a.control_key,
                sort_order=0,
            ),
            ComplianceTenantLibraryProfileControl(
                tenant_id=tenant.id,
                profile_key=profile.profile_key,
                control_key=control_b.control_key,
                sort_order=1,
            ),
        ]
    )
    db_session.add(
        ComplianceTenantProfile(tenant_id=tenant.id, profile_key=profile.profile_key, enabled=True)
    )
    db_session.add(
        ComplianceControlStatus(
            tenant_id=tenant.id,
            control_key=control_a.control_key,
            status_enum='implemented',
            score=1,
        )
    )
    db_session.add(
        ComplianceControlStatus(
            tenant_id=tenant.id,
            control_key=control_b.control_key,
            status_enum='na',
            score=0,
            na_reason='not applicable',
        )
    )
    db_session.commit()

    summary = compute_summary(db_session, tenant_id=tenant.id)
    assert summary['overall']['denominator'] == 2
    assert summary['overall']['numerator'] == 2
    assert summary['overall']['compliance'] == 1.0

    framework_summary = compute_framework_summary(db_session, tenant_id=tenant.id, framework_key='FW_TEST')
    assert framework_summary is not None
    assert framework_summary['framework']['denominator'] == 2
    assert framework_summary['framework']['numerator'] == 2
    assert framework_summary['framework']['compliance'] == 1.0


def test_compliance_summary_handles_no_active_profile(db_session):
    tenant = Tenant(id=uuid.uuid4(), name='Tenant A', slug='tenant-a', tenant_type='company')
    db_session.add(tenant)
    db_session.commit()

    summary = compute_summary(db_session, tenant_id=tenant.id)
    assert summary['overall']['denominator'] == 0
    assert summary['overall']['numerator'] == 0
    assert summary['overall']['compliance'] is None

    framework_summary = compute_framework_summary(db_session, tenant_id=tenant.id, framework_key='FW_TEST')
    assert framework_summary is not None
    assert framework_summary['framework']['denominator'] == 0
