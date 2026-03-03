from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceControl,
    ComplianceControlFrameworkRef,
    ComplianceDomain,
    ComplianceFramework,
    ComplianceProfile,
    ComplianceProfileControl,
    ComplianceSeedImportBatch,
)


ALLOWED_SERVER_FILES = {
    "docs/compliance-hub/compliance_seed_min_required_v1.json",
}


class SeedImportError(ValueError):
    pass


def _parse_exported_at(value: str) -> datetime:
    if not value:
        raise SeedImportError("meta.exported_at is required.")
    safe = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(safe)
    except ValueError as exc:
        raise SeedImportError(f"meta.exported_at must be ISO 8601, got: {value}") from exc


def _payload_sha256(raw_text: str) -> str:
    return hashlib.sha256(raw_text.encode("utf-8")).hexdigest()


def _load_server_file(server_file: str) -> str:
    if server_file not in ALLOWED_SERVER_FILES:
        raise SeedImportError("server_file is not allowed.")
    repo_root = None
    for parent in Path(__file__).resolve().parents:
        if (parent / "docs").exists():
            repo_root = parent
            break
    if not repo_root:
        raise SeedImportError("Unable to resolve repository root for server_file.")
    path = (repo_root / server_file).resolve()
    if not path.exists():
        raise SeedImportError(f"server_file not found: {server_file}")
    return path.read_text(encoding="utf-8")


def _validate_seed_payload(payload: dict[str, Any]) -> None:
    meta = payload.get("meta") or {}
    schema_version = meta.get("schema_version")
    if schema_version != "1.0":
        raise SeedImportError("meta.schema_version must be '1.0'.")

    domains = payload.get("domains") or []
    domain_codes = {d.get("code") for d in domains if isinstance(d, dict)}

    frameworks = payload.get("frameworks") or []
    framework_keys = {f.get("id") for f in frameworks if isinstance(f, dict)}

    controls = payload.get("controls") or []
    control_keys = {c.get("id") for c in controls if isinstance(c, dict)}

    for control in controls:
        if not isinstance(control, dict):
            raise SeedImportError("controls must be an array of objects.")
        domain = control.get("domain")
        if domain not in domain_codes:
            raise SeedImportError(f"Unknown domain in control {control.get('id')}: {domain}")
        references = control.get("references") or []
        for ref in references:
            if not isinstance(ref, dict):
                raise SeedImportError(f"Invalid reference in control {control.get('id')}.")
            framework_id = ref.get("framework_id")
            if framework_id not in framework_keys:
                raise SeedImportError(
                    f"Unknown framework_id {framework_id} in control {control.get('id')}"
                )

    profiles = payload.get("profiles") or []
    for profile in profiles:
        if not isinstance(profile, dict):
            raise SeedImportError("profiles must be an array of objects.")
        control_ids = profile.get("control_ids") or []
        for control_id in control_ids:
            if control_id not in control_keys:
                raise SeedImportError(
                    f"Unknown control_id {control_id} in profile {profile.get('id')}"
                )


def import_seed_payload(
    db: Session,
    *,
    payload: dict[str, Any],
    payload_sha: str,
    source: str,
    imported_by_user_id: UUID | None,
) -> tuple[ComplianceSeedImportBatch, dict[str, int]]:
    _validate_seed_payload(payload)

    meta = payload.get("meta") or {}
    frameworks = payload.get("frameworks") or []
    domains = payload.get("domains") or []
    controls = payload.get("controls") or []
    profiles = payload.get("profiles") or []

    dataset = meta.get("dataset") or "unknown"
    schema_version = meta.get("schema_version") or "unknown"
    exported_at = _parse_exported_at(meta.get("exported_at") or "")

    framework_keys = [item.get("id") for item in frameworks if isinstance(item, dict) and item.get("id")]
    domain_codes = [item.get("code") for item in domains if isinstance(item, dict) and item.get("code")]
    control_keys = [item.get("id") for item in controls if isinstance(item, dict) and item.get("id")]
    profile_keys = [item.get("id") for item in profiles if isinstance(item, dict) and item.get("id")]

    existing_frameworks = set()
    if framework_keys:
        existing_frameworks = set(
            db.scalars(
                select(ComplianceFramework.framework_key).where(
                    ComplianceFramework.framework_key.in_(framework_keys)
                )
            ).all()
        )
    existing_domains = set()
    if domain_codes:
        existing_domains = set(
            db.scalars(select(ComplianceDomain.code).where(ComplianceDomain.code.in_(domain_codes))).all()
        )
    existing_controls = set()
    if control_keys:
        existing_controls = set(
            db.scalars(
                select(ComplianceControl.control_key).where(ComplianceControl.control_key.in_(control_keys))
            ).all()
        )
    existing_profiles = set()
    if profile_keys:
        existing_profiles = set(
            db.scalars(
                select(ComplianceProfile.profile_key).where(ComplianceProfile.profile_key.in_(profile_keys))
            ).all()
        )

    framework_rows = [
        {
            "framework_key": item.get("id"),
            "name": item.get("name"),
            "full_name": item.get("full_name"),
            "version": item.get("version"),
            "type": item.get("type"),
            "region": item.get("region"),
            "tags": item.get("tags") or [],
            "references": item.get("references") or [],
        }
        for item in frameworks
        if isinstance(item, dict) and item.get("id")
    ]
    if framework_rows:
        stmt = insert(ComplianceFramework).values(framework_rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["framework_key"],
            set_={
                "name": stmt.excluded.name,
                "full_name": stmt.excluded.full_name,
                "version": stmt.excluded.version,
                "type": stmt.excluded.type,
                "region": stmt.excluded.region,
                "tags": stmt.excluded.tags,
                "references": stmt.excluded.references,
            },
        )
        db.execute(stmt)

    domain_rows = [
        {"code": item.get("code"), "label": item.get("label")}
        for item in domains
        if isinstance(item, dict) and item.get("code")
    ]
    if domain_rows:
        stmt = insert(ComplianceDomain).values(domain_rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["code"],
            set_={"label": stmt.excluded.label},
        )
        db.execute(stmt)

    control_rows = [
        {
            "control_key": item.get("id"),
            "code": item.get("code"),
            "title": item.get("title"),
            "description": item.get("description"),
            "domain_code": item.get("domain"),
            "criticality": item.get("criticality"),
            "weight": item.get("weight") or 1,
            "evidence_expected": item.get("evidence_expected") or "",
            "default_status": item.get("default_status") or "not_started",
            "default_score": item.get("default_score") or 0,
        }
        for item in controls
        if isinstance(item, dict) and item.get("id")
    ]
    if control_rows:
        stmt = insert(ComplianceControl).values(control_rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["control_key"],
            set_={
                "code": stmt.excluded.code,
                "title": stmt.excluded.title,
                "description": stmt.excluded.description,
                "domain_code": stmt.excluded.domain_code,
                "criticality": stmt.excluded.criticality,
                "weight": stmt.excluded.weight,
                "evidence_expected": stmt.excluded.evidence_expected,
                "default_status": stmt.excluded.default_status,
                "default_score": stmt.excluded.default_score,
            },
        )
        db.execute(stmt)

    framework_map: dict[str, UUID] = {}
    if framework_keys:
        framework_map = dict(
            db.execute(
                select(ComplianceFramework.framework_key, ComplianceFramework.id).where(
                    ComplianceFramework.framework_key.in_(framework_keys)
                )
            ).all()
        )
    control_map: dict[str, UUID] = {}
    if control_keys:
        control_map = dict(
            db.execute(
                select(ComplianceControl.control_key, ComplianceControl.id).where(
                    ComplianceControl.control_key.in_(control_keys)
                )
            ).all()
        )

    ref_rows: list[dict[str, Any]] = []
    for item in controls:
        if not isinstance(item, dict):
            continue
        control_id = control_map.get(item.get("id"))
        if not control_id:
            continue
        for ref in item.get("references") or []:
            framework_id = framework_map.get(ref.get("framework_id"))
            ref_value = ref.get("ref")
            if not framework_id or not ref_value:
                continue
            ref_rows.append(
                {
                    "control_id": control_id,
                    "framework_id": framework_id,
                    "ref": ref_value,
                    "note": ref.get("note"),
                }
            )
    if ref_rows:
        stmt = insert(ComplianceControlFrameworkRef).values(ref_rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["control_id", "framework_id", "ref"],
            set_={"note": stmt.excluded.note},
        )
        db.execute(stmt)

    profile_rows = [
        {
            "profile_key": item.get("id"),
            "name": item.get("name"),
            "description": item.get("description") or "",
        }
        for item in profiles
        if isinstance(item, dict) and item.get("id")
    ]
    if profile_rows:
        stmt = insert(ComplianceProfile).values(profile_rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["profile_key"],
            set_={"name": stmt.excluded.name, "description": stmt.excluded.description},
        )
        db.execute(stmt)

    profile_map: dict[str, UUID] = {}
    if profile_keys:
        profile_map = dict(
            db.execute(
                select(ComplianceProfile.profile_key, ComplianceProfile.id).where(
                    ComplianceProfile.profile_key.in_(profile_keys)
                )
            ).all()
        )

    profile_control_rows: list[dict[str, Any]] = []
    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        profile_id = profile_map.get(profile.get("id"))
        if not profile_id:
            continue
        control_ids = profile.get("control_ids") or []
        for idx, control_key in enumerate(control_ids):
            control_id = control_map.get(control_key)
            if not control_id:
                continue
            profile_control_rows.append(
                {
                    "profile_id": profile_id,
                    "control_id": control_id,
                    "sort_order": idx,
                }
            )
    if profile_control_rows:
        stmt = insert(ComplianceProfileControl).values(profile_control_rows)
        stmt = stmt.on_conflict_do_nothing(index_elements=["profile_id", "control_id"])
        db.execute(stmt)

    batch = ComplianceSeedImportBatch(
        dataset=dataset,
        schema_version=schema_version,
        exported_at=exported_at,
        source=source,
        payload_sha256=payload_sha,
        imported_by_user_id=imported_by_user_id,
    )
    db.add(batch)
    db.flush()

    counts = {
        "frameworks": len(framework_rows),
        "domains": len(domain_rows),
        "controls": len(control_rows),
        "control_framework_refs": len(ref_rows),
        "profiles": len(profile_rows),
        "profile_controls": len(profile_control_rows),
        "frameworks_inserted": len([k for k in framework_keys if k not in existing_frameworks]),
        "frameworks_updated": len([k for k in framework_keys if k in existing_frameworks]),
        "domains_inserted": len([k for k in domain_codes if k not in existing_domains]),
        "domains_updated": len([k for k in domain_codes if k in existing_domains]),
        "controls_inserted": len([k for k in control_keys if k not in existing_controls]),
        "controls_updated": len([k for k in control_keys if k in existing_controls]),
        "profiles_inserted": len([k for k in profile_keys if k not in existing_profiles]),
        "profiles_updated": len([k for k in profile_keys if k in existing_profiles]),
    }

    return batch, counts


def load_seed_payload_from_request(payload: dict[str, Any] | None, server_file: str | None) -> tuple[dict[str, Any], str, str]:
    if payload and server_file:
        raise SeedImportError("Provide either payload or server_file, not both.")
    if not payload and not server_file:
        raise SeedImportError("Provide either payload or server_file.")

    if server_file:
        raw_text = _load_server_file(server_file)
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise SeedImportError("server_file contains invalid JSON.") from exc
        sha = _payload_sha256(raw_text)
        return data, sha, "server_file"

    if payload is not None and not isinstance(payload, dict):
        raise SeedImportError("payload must be a JSON object.")

    raw_text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    sha = _payload_sha256(raw_text)
    return payload or {}, sha, "payload"
