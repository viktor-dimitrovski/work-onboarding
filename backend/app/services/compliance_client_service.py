from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.compliance import (
    ComplianceClientMatchResult,
    ComplianceClientMatchRun,
    ComplianceClientRequirement,
    ComplianceClientSetVersion,
    ComplianceTenantControl,
    ComplianceTenantLibraryImportBatch,
)
from app.services.openai_responses_service import call_openai_responses_json
from app.services.compliance_vector_search_service import get_top_k_controls


CLIENT_MATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["matches"],
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["control_key", "confidence", "coverage_score", "rationale"],
                "properties": {
                    "control_key": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "coverage_score": {"type": "number", "minimum": 0, "maximum": 1},
                    "rationale": {"type": "string"},
                    "suggested_evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["type", "value"],
                            "properties": {
                                "type": {"type": "string", "enum": ["link", "text"]},
                                "value": {"type": "string"},
                            },
                        },
                    },
                },
            },
        }
    },
}


def parse_requirements(text: str) -> list[str]:
    lines = [line.strip() for line in (text or "").splitlines()]
    items = [line for line in lines if line]
    return items


def run_client_match(
    db: Session,
    *,
    tenant_id: UUID,
    version: ComplianceClientSetVersion,
    requirements: list[ComplianceClientRequirement],
    run_type: str,
) -> tuple[ComplianceClientMatchRun, list[ComplianceClientMatchResult]]:
    controls = db.scalars(
        select(ComplianceTenantControl)
        .where(ComplianceTenantControl.tenant_id == tenant_id, ComplianceTenantControl.is_active.is_(True))
        .order_by(ComplianceTenantControl.code.asc())
    ).all()
    candidates = get_top_k_controls(
        db,
        tenant_id=tenant_id,
        text=" ".join([req.text for req in requirements[:10]]),
        k=50,
    )
    if candidates is not None:
        controls = candidates

    batch_id = db.scalar(
        select(ComplianceTenantLibraryImportBatch.id)
        .where(ComplianceTenantLibraryImportBatch.tenant_id == tenant_id)
        .order_by(ComplianceTenantLibraryImportBatch.imported_at.desc())
        .limit(1)
    )
    input_hash = _input_hash(requirements, batch_id)

    cached_run = db.scalar(
        select(ComplianceClientMatchRun)
        .where(
            ComplianceClientMatchRun.tenant_id == tenant_id,
            ComplianceClientMatchRun.client_set_version_id == version.id,
            ComplianceClientMatchRun.input_hash == input_hash,
            ComplianceClientMatchRun.status == "success",
        )
        .order_by(ComplianceClientMatchRun.finished_at.desc().nullslast())
        .limit(1)
    )
    if cached_run:
        cached_results = db.scalars(
            select(ComplianceClientMatchResult).where(
                ComplianceClientMatchResult.tenant_id == tenant_id,
                ComplianceClientMatchResult.run_id == cached_run.id,
            )
        ).all()
        if cached_results:
            return cached_run, cached_results

    run = ComplianceClientMatchRun(
        tenant_id=tenant_id,
        client_set_version_id=version.id,
        run_type=run_type,
        status="running",
        model_info_json={"prompt_version": "v1"},
        input_hash=input_hash,
        started_at=datetime.utcnow(),
    )
    db.add(run)
    db.flush()

    results: list[ComplianceClientMatchResult] = []
    try:
        valid_keys = {control.control_key for control in controls}
        for req in requirements:
            matches = _call_match_llm(req.text, controls)
            results.extend(_build_results(tenant_id, run.id, req, matches, valid_keys))
    except Exception:
        run.status = "failed"
        run.finished_at = datetime.utcnow()
        db.flush()
        raise

    if results:
        db.add_all(results)
    run.status = "success"
    run.finished_at = datetime.utcnow()
    db.flush()
    return run, results


def _call_match_llm(requirement_text: str, controls: list[ComplianceTenantControl]) -> list[dict[str, Any]]:
    instructions = (
        "You map client requirements to compliance controls. Return 0-5 best matches with confidence and rationale. "
        "Only use control_key values from the provided list. If nothing matches, return an empty list."
    )
    control_lines = [
        f"{c.control_key} | {c.title} | {c.domain_code} | {c.criticality} | {c.evidence_expected}"
        for c in controls
    ]
    input_text = "\n".join(
        [
            "Client requirement:",
            requirement_text,
            "",
            "Controls:",
            *control_lines,
        ]
    )
    response = call_openai_responses_json(
        instructions=instructions,
        input_text=input_text,
        schema_name="client_match_v1",
        schema=CLIENT_MATCH_SCHEMA,
        temperature=0.2,
    )
    matches = response.get("matches") if isinstance(response, dict) else []
    if not isinstance(matches, list):
        return []
    return matches[:5]


def _build_results(
    tenant_id: UUID,
    run_id: UUID,
    requirement: ComplianceClientRequirement,
    matches: list[dict[str, Any]],
    valid_keys: set[str],
) -> list[ComplianceClientMatchResult]:
    results: list[ComplianceClientMatchResult] = []
    for match in matches:
        control_key = str(match.get("control_key") or "").strip()
        if not control_key or control_key not in valid_keys:
            continue
        results.append(
            ComplianceClientMatchResult(
                tenant_id=tenant_id,
                run_id=run_id,
                client_requirement_id=requirement.id,
                control_key=control_key,
                confidence=float(match.get("confidence") or 0.0),
                coverage_score=float(match.get("coverage_score") or 0.0),
                rationale=str(match.get("rationale") or ""),
                suggested_evidence_json={"items": match.get("suggested_evidence") or []},
            )
        )
    return results


def _input_hash(requirements: list[ComplianceClientRequirement], batch_id: UUID | None) -> str:
    payload = json.dumps(
        {
            "requirements": [req.text for req in requirements],
            "batch_id": str(batch_id) if batch_id else None,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
