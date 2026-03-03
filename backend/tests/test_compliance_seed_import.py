from sqlalchemy import func, select

from app.models.compliance import ComplianceControl, ComplianceFramework, ComplianceProfile
from app.services.compliance_seed_service import import_seed_payload, load_seed_payload_from_request


def test_compliance_seed_import_is_idempotent(db_session):
    data, sha, source = load_seed_payload_from_request(
        None, "docs/compliance-hub/compliance_seed_min_required_v1.json"
    )
    batch, _ = import_seed_payload(
        db_session,
        payload=data,
        payload_sha=sha,
        source=source,
        imported_by_user_id=None,
    )
    db_session.commit()

    assert batch.id is not None
    framework_count = db_session.scalar(select(func.count()).select_from(ComplianceFramework))
    control_count = db_session.scalar(select(func.count()).select_from(ComplianceControl))
    profile_count = db_session.scalar(select(func.count()).select_from(ComplianceProfile))

    data2, sha2, source2 = load_seed_payload_from_request(
        None, "docs/compliance-hub/compliance_seed_min_required_v1.json"
    )
    import_seed_payload(
        db_session,
        payload=data2,
        payload_sha=sha2,
        source=source2,
        imported_by_user_id=None,
    )
    db_session.commit()

    framework_count_after = db_session.scalar(select(func.count()).select_from(ComplianceFramework))
    control_count_after = db_session.scalar(select(func.count()).select_from(ComplianceControl))
    profile_count_after = db_session.scalar(select(func.count()).select_from(ComplianceProfile))

    assert framework_count_after == framework_count
    assert control_count_after == control_count
    assert profile_count_after == profile_count
