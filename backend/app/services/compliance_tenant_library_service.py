from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select, update
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceTenantControl,
    ComplianceTenantControlFrameworkRef,
    ComplianceTenantDomain,
    ComplianceTenantFramework,
    ComplianceTenantLibraryImportBatch,
    ComplianceTenantLibraryProfile,
    ComplianceTenantLibraryProfileControl,
)


CANONICAL_TENANT_LIBRARY_FILES = {
    "docs/compliance-hub/compliance_tenant_import_package_v1_2.json",
}


class TenantLibraryError(RuntimeError):
    pass


def load_tenant_library_payload_from_request(
    payload: dict[str, Any] | None, server_file: str | None
) -> tuple[dict[str, Any], str, str]:
    if payload and server_file:
        raise TenantLibraryError("Provide either payload or server_file, not both.")
    if not payload and not server_file:
        raise TenantLibraryError("Either payload or server_file is required.")

    if server_file:
        if server_file not in CANONICAL_TENANT_LIBRARY_FILES:
            raise TenantLibraryError("Unsupported server_file path.")
        raw = _resolve_library_path(server_file)
        if not raw:
            raise TenantLibraryError("server_file not found.")
        data = json.loads(raw.read_text(encoding="utf-8"))
        return data, _sha256_json(data), f"server_file:{server_file}"

    if not isinstance(payload, dict):
        raise TenantLibraryError("payload must be a JSON object.")
    return payload, _sha256_json(payload), "payload"


def validate_tenant_library_payload(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    meta = payload.get("meta") or {}
    schema_version = meta.get("schema_version")
    if not schema_version:
        errors.append("meta.schema_version is required.")
    elif not str(schema_version).startswith("1.2"):
        errors.append("meta.schema_version must start with '1.2'.")

    tenant_scope = payload.get("tenant_scope") or {}
    if tenant_scope.get("mode") != "per_tenant":
        warnings.append("tenant_scope.mode is not 'per_tenant'.")

    library = payload.get("library")
    if not isinstance(library, dict):
        errors.append("library section is required.")
        return errors, warnings

    frameworks = library.get("frameworks") or []
    domains = library.get("domains") or []
    controls = library.get("controls") or []
    profiles = library.get("profiles") or []

    _require_list(frameworks, "library.frameworks", errors)
    _require_list(domains, "library.domains", errors)
    _require_list(controls, "library.controls", errors)
    _require_list(profiles, "library.profiles", errors)

    framework_ids = _unique_ids(frameworks, "frameworks", errors)
    domain_codes = _unique_codes(domains, "domains", errors, field="code")
    control_ids = _unique_ids(controls, "controls", errors)
    _unique_codes(controls, "controls", errors, field="code")
    profile_ids = _unique_ids(profiles, "profiles", errors)

    for item in domains:
        if not _has_keys(item, {"code", "label"}):
            errors.append("domain must include code and label.")

    for framework in frameworks:
        if not _has_keys(framework, {"id", "name"}):
            errors.append("framework must include id and name.")

    for control in controls:
        if not _has_keys(
            control,
            {"id", "code", "title", "description", "domain", "criticality", "weight", "evidence_expected"},
        ):
            errors.append("control missing required fields.")
            continue
        if control.get("domain") not in domain_codes:
            errors.append(f"control {control.get('id')} references unknown domain {control.get('domain')}.")
        criticality = control.get("criticality")
        if criticality not in {"Low", "Medium", "High"}:
            errors.append(f"control {control.get('id')} has invalid criticality.")
        default_status = control.get("default_status", "not_started")
        if default_status not in {"not_started", "in_progress", "partial", "mostly", "implemented", "na"}:
            errors.append(f"control {control.get('id')} has invalid default_status.")
        score = control.get("default_score", 0)
        if score is not None:
            try:
                score_val = float(score)
                if score_val < 0 or score_val > 1:
                    errors.append(f"control {control.get('id')} default_score must be between 0 and 1.")
            except (TypeError, ValueError):
                errors.append(f"control {control.get('id')} default_score must be numeric.")
        for ref in control.get("references") or []:
            fw_id = ref.get("framework_id")
            if fw_id and fw_id not in framework_ids:
                errors.append(f"control {control.get('id')} references unknown framework {fw_id}.")

    for profile in profiles:
        if not _has_keys(profile, {"id", "name", "description", "control_ids"}):
            errors.append("profile missing required fields.")
            continue
        missing = [cid for cid in profile.get("control_ids") or [] if cid not in control_ids]
        if missing:
            errors.append(f"profile {profile.get('id')} references unknown controls: {missing[:3]}")

    if not framework_ids:
        warnings.append("No frameworks defined in library.")
    if not profiles:
        warnings.append("No profiles defined in library.")
    if not control_ids:
        warnings.append("No controls defined in library.")

    return errors, warnings


def diff_tenant_library_payload(db: Session, *, tenant_id: UUID, payload: dict[str, Any]) -> dict[str, Any]:
    library = payload.get("library") or {}
    frameworks = {item["id"]: item for item in library.get("frameworks") or [] if isinstance(item, dict)}
    domains = {item["code"]: item for item in library.get("domains") or [] if isinstance(item, dict)}
    controls = {item["id"]: item for item in library.get("controls") or [] if isinstance(item, dict)}
    profiles = {item["id"]: item for item in library.get("profiles") or [] if isinstance(item, dict)}

    added: dict[str, int] = {}
    updated: dict[str, int] = {}
    deactivated: dict[str, int] = {}

    existing_frameworks = db.scalars(
        select(ComplianceTenantFramework).where(ComplianceTenantFramework.tenant_id == tenant_id)
    ).all()
    added["frameworks"], updated["frameworks"], deactivated["frameworks"] = _diff_simple(
        frameworks,
        existing_frameworks,
        lambda f: f.framework_key,
        _framework_signature,
    )

    existing_domains = db.scalars(
        select(ComplianceTenantDomain).where(ComplianceTenantDomain.tenant_id == tenant_id)
    ).all()
    added["domains"], updated["domains"], deactivated["domains"] = _diff_simple(
        domains,
        existing_domains,
        lambda d: d.domain_code,
        _domain_signature,
    )

    existing_controls = db.scalars(
        select(ComplianceTenantControl).where(ComplianceTenantControl.tenant_id == tenant_id)
    ).all()
    added["controls"], updated["controls"], deactivated["controls"] = _diff_simple(
        controls,
        existing_controls,
        lambda c: c.control_key,
        _control_signature,
    )

    existing_profiles = db.scalars(
        select(ComplianceTenantLibraryProfile).where(ComplianceTenantLibraryProfile.tenant_id == tenant_id)
    ).all()
    added["profiles"], updated["profiles"], deactivated["profiles"] = _diff_simple(
        profiles,
        existing_profiles,
        lambda p: p.profile_key,
        _profile_signature,
    )

    return {"added": added, "updated": updated, "deactivated": deactivated}


def apply_tenant_library_payload(
    db: Session,
    *,
    tenant_id: UUID,
    payload: dict[str, Any],
    payload_sha: str,
    source: str,
    version_label: str | None,
    imported_by_user_id: UUID | None,
) -> tuple[ComplianceTenantLibraryImportBatch, dict[str, int]]:
    meta = payload.get("meta") or {}
    library = payload.get("library") or {}
    exported_at = _parse_datetime(meta.get("exported_at"))

    frameworks = _framework_rows(tenant_id, library.get("frameworks") or [])
    domains = _domain_rows(tenant_id, library.get("domains") or [])
    controls = _control_rows(tenant_id, library.get("controls") or [])
    refs = _control_ref_rows(tenant_id, library.get("controls") or [])
    profiles = _profile_rows(tenant_id, library.get("profiles") or [])
    profile_controls = _profile_control_rows(tenant_id, library.get("profiles") or [])

    diff = diff_tenant_library_payload(db, tenant_id=tenant_id, payload=payload)

    _upsert_frameworks(db, frameworks)
    _upsert_domains(db, domains)
    _upsert_controls(db, controls)
    _upsert_control_refs(db, refs)
    _upsert_profiles(db, profiles)

    # Replace profile controls (library-only)
    db.execute(delete(ComplianceTenantLibraryProfileControl).where(ComplianceTenantLibraryProfileControl.tenant_id == tenant_id))
    if profile_controls:
        db.execute(insert(ComplianceTenantLibraryProfileControl).values(profile_controls))

    _deactivate_missing(db, tenant_id, ComplianceTenantFramework, "framework_key", {f["framework_key"] for f in frameworks})
    _deactivate_missing(db, tenant_id, ComplianceTenantDomain, "domain_code", {d["domain_code"] for d in domains})
    _deactivate_missing(db, tenant_id, ComplianceTenantControl, "control_key", {c["control_key"] for c in controls})
    _deactivate_missing(db, tenant_id, ComplianceTenantLibraryProfile, "profile_key", {p["profile_key"] for p in profiles})
    _deactivate_missing(
        db,
        tenant_id,
        ComplianceTenantControlFrameworkRef,
        ("control_key", "framework_key", "ref"),
        {(r["control_key"], r["framework_key"], r["ref"]) for r in refs},
    )

    batch = ComplianceTenantLibraryImportBatch(
        tenant_id=tenant_id,
        schema_version=str(meta.get("schema_version") or ""),
        dataset=str(meta.get("dataset") or ""),
        exported_at=exported_at,
        version_label=version_label,
        source=source,
        payload_sha256=payload_sha,
        payload_json=payload,
        imported_by_user_id=imported_by_user_id,
    )
    db.add(batch)
    db.flush()

    counts = {
        "frameworks": len(frameworks),
        "domains": len(domains),
        "controls": len(controls),
        "framework_refs": len(refs),
        "profiles": len(profiles),
        "profile_controls": len(profile_controls),
    }
    for kind, value in diff.get("deactivated", {}).items():
        counts[f"deactivated_{kind}"] = value

    return batch, counts


def list_tenant_library_versions(db: Session, tenant_id: UUID) -> list[ComplianceTenantLibraryImportBatch]:
    return db.scalars(
        select(ComplianceTenantLibraryImportBatch)
        .where(ComplianceTenantLibraryImportBatch.tenant_id == tenant_id)
        .order_by(ComplianceTenantLibraryImportBatch.imported_at.desc())
    ).all()


def _sha256_json(payload: dict[str, Any]) -> str:
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _resolve_library_path(server_file: str) -> Path | None:
    candidates = [Path.cwd(), Path(__file__).resolve().parents[3]]
    for base in candidates:
        candidate = (base / server_file).resolve()
        if candidate.exists():
            return candidate
    return None


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    raise TenantLibraryError("meta.exported_at must be ISO datetime string.")


def _require_list(value: Any, label: str, errors: list[str]) -> None:
    if not isinstance(value, list):
        errors.append(f"{label} must be an array.")


def _unique_ids(items: list[dict[str, Any]], label: str, errors: list[str]) -> set[str]:
    ids = [item.get("id") for item in items if isinstance(item, dict)]
    if any(not item for item in ids):
        errors.append(f"{label} items must include id.")
    if len(set(ids)) != len(ids):
        errors.append(f"{label} ids must be unique.")
    return set([str(item) for item in ids if item])


def _unique_codes(items: list[dict[str, Any]], label: str, errors: list[str], *, field: str) -> set[str]:
    codes = [item.get(field) for item in items if isinstance(item, dict)]
    if any(not item for item in codes):
        errors.append(f"{label} items must include {field}.")
    if len(set(codes)) != len(codes):
        errors.append(f"{label} {field} values must be unique.")
    return set([str(item) for item in codes if item])


def _has_keys(item: Any, keys: set[str]) -> bool:
    if not isinstance(item, dict):
        return False
    return keys.issubset(item.keys())


def _framework_rows(tenant_id: UUID, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "tenant_id": tenant_id,
                "framework_key": item.get("id"),
                "name": item.get("name") or "",
                "full_name": item.get("full_name"),
                "version": item.get("version"),
                "type": item.get("type"),
                "region": item.get("region"),
                "tags": item.get("tags") or [],
                "references": item.get("references") or [],
                "is_active": True,
            }
        )
    return rows


def _domain_rows(tenant_id: UUID, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "tenant_id": tenant_id,
            "domain_code": item.get("code"),
            "label": item.get("label") or "",
            "is_active": True,
        }
        for item in items
        if isinstance(item, dict)
    ]


def _control_rows(tenant_id: UUID, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "tenant_id": tenant_id,
                "control_key": item.get("id"),
                "code": item.get("code") or "",
                "title": item.get("title") or "",
                "description": item.get("description") or "",
                "domain_code": item.get("domain") or "",
                "criticality": item.get("criticality") or "Medium",
                "weight": int(item.get("weight") or 1),
                "evidence_expected": item.get("evidence_expected") or "",
                "default_status": item.get("default_status") or "not_started",
                "default_score": float(item.get("default_score") or 0.0),
                "is_active": True,
            }
        )
    return rows


def _control_ref_rows(tenant_id: UUID, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        control_key = item.get("id")
        for ref in item.get("references") or []:
            if not isinstance(ref, dict):
                continue
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "control_key": control_key,
                    "framework_key": ref.get("framework_id"),
                    "ref": ref.get("ref") or "",
                    "note": ref.get("note"),
                    "is_active": True,
                }
            )
    return rows


def _profile_rows(tenant_id: UUID, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "tenant_id": tenant_id,
            "profile_key": item.get("id"),
            "name": item.get("name") or "",
            "description": item.get("description") or "",
            "is_active": True,
        }
        for item in items
        if isinstance(item, dict)
    ]


def _profile_control_rows(tenant_id: UUID, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        profile_key = item.get("id")
        for idx, control_id in enumerate(item.get("control_ids") or []):
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "profile_key": profile_key,
                    "control_key": control_id,
                    "sort_order": idx,
                }
            )
    return rows


def _upsert_frameworks(db: Session, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    stmt = insert(ComplianceTenantFramework).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["tenant_id", "framework_key"],
        set_={
            "name": stmt.excluded.name,
            "full_name": stmt.excluded.full_name,
            "version": stmt.excluded.version,
            "type": stmt.excluded.type,
            "region": stmt.excluded.region,
            "tags": stmt.excluded.tags,
            "references": stmt.excluded.references,
            "is_active": True,
        },
    )
    db.execute(stmt)


def _upsert_domains(db: Session, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    stmt = insert(ComplianceTenantDomain).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["tenant_id", "domain_code"],
        set_={
            "label": stmt.excluded.label,
            "is_active": True,
        },
    )
    db.execute(stmt)


def _upsert_controls(db: Session, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    stmt = insert(ComplianceTenantControl).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["tenant_id", "control_key"],
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
            "is_active": True,
        },
    )
    db.execute(stmt)


def _upsert_control_refs(db: Session, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    stmt = insert(ComplianceTenantControlFrameworkRef).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["tenant_id", "control_key", "framework_key", "ref"],
        set_={
            "note": stmt.excluded.note,
            "is_active": True,
        },
    )
    db.execute(stmt)


def _upsert_profiles(db: Session, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    stmt = insert(ComplianceTenantLibraryProfile).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["tenant_id", "profile_key"],
        set_={
            "name": stmt.excluded.name,
            "description": stmt.excluded.description,
            "is_active": True,
        },
    )
    db.execute(stmt)


def _deactivate_missing(
    db: Session,
    tenant_id: UUID,
    model: Any,
    key_field: str | tuple[str, str, str],
    allowed_keys: set[Any],
) -> None:
    if not allowed_keys:
        db.execute(update(model).where(model.tenant_id == tenant_id).values(is_active=False))
        return

    if isinstance(key_field, tuple):
        condition = sa.tuple_(*[getattr(model, key) for key in key_field]).notin_(list(allowed_keys))
    else:
        condition = getattr(model, key_field).notin_(list(allowed_keys))

    db.execute(
        update(model)
        .where(
            model.tenant_id == tenant_id,
            condition,
        )
        .values(is_active=False)
    )


def _diff_simple(
    payload_map: dict[str, dict[str, Any]],
    existing_rows: list[Any],
    key_fn: Any,
    signature_fn: Any,
) -> tuple[int, int, int]:
    existing_map = {key_fn(row): row for row in existing_rows}
    added = 0
    updated = 0
    for key, payload_item in payload_map.items():
        existing = existing_map.get(key)
        if not existing:
            added += 1
            continue
        if signature_fn(payload_item) != signature_fn(existing) or not getattr(existing, "is_active", True):
            updated += 1
    deactivated = len([row for row in existing_rows if key_fn(row) not in payload_map and getattr(row, "is_active", True)])
    return added, updated, deactivated


def _framework_signature(obj: Any) -> tuple:
    if isinstance(obj, dict):
        return (
            obj.get("name"),
            obj.get("full_name"),
            obj.get("version"),
            obj.get("type"),
            obj.get("region"),
            tuple(obj.get("tags") or []),
            json.dumps(obj.get("references") or [], sort_keys=True),
        )
    return (obj.name, obj.full_name, obj.version, obj.type, obj.region, tuple(obj.tags or []), json.dumps(obj.references or [], sort_keys=True))


def _domain_signature(obj: Any) -> tuple:
    if isinstance(obj, dict):
        return (obj.get("label"),)
    return (obj.label,)


def _control_signature(obj: Any) -> tuple:
    if isinstance(obj, dict):
        return (
            obj.get("code"),
            obj.get("title"),
            obj.get("description"),
            obj.get("domain"),
            obj.get("criticality"),
            obj.get("weight"),
            obj.get("evidence_expected"),
            obj.get("default_status"),
            obj.get("default_score"),
        )
    return (
        obj.code,
        obj.title,
        obj.description,
        obj.domain_code,
        obj.criticality,
        obj.weight,
        obj.evidence_expected,
        obj.default_status,
        obj.default_score,
    )


def _profile_signature(obj: Any) -> tuple:
    if isinstance(obj, dict):
        return (obj.get("name"), obj.get("description"))
    return (obj.name, obj.description)
