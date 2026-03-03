from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.compliance import (
    CompliancePracticeItem,
    CompliancePracticeMatchResult,
    CompliancePracticeMatchRun,
    ComplianceTenantControl,
    ComplianceTenantLibraryImportBatch,
)
from app.services.openai_responses_service import call_openai_responses_json
from app.services.compliance_vector_search_service import get_top_k_controls


PRACTICE_MATCH_SCHEMA: dict[str, Any] = {
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


def run_practice_match(
    db: Session,
    *,
    tenant_id: UUID,
    practice_item: CompliancePracticeItem,
    run_type: str,
) -> tuple[CompliancePracticeMatchRun, list[CompliancePracticeMatchResult]]:
    controls = db.scalars(
        select(ComplianceTenantControl)
        .where(ComplianceTenantControl.tenant_id == tenant_id, ComplianceTenantControl.is_active.is_(True))
        .order_by(ComplianceTenantControl.code.asc())
    ).all()
    candidates = get_top_k_controls(
        db,
        tenant_id=tenant_id,
        text=f"{practice_item.title}\n{practice_item.description_text}",
        k=40,
    )
    if candidates is not None:
        controls = candidates

    batch_id = db.scalar(
        select(ComplianceTenantLibraryImportBatch.id)
        .where(ComplianceTenantLibraryImportBatch.tenant_id == tenant_id)
        .order_by(ComplianceTenantLibraryImportBatch.imported_at.desc())
        .limit(1)
    )
    input_hash = _input_hash(practice_item, batch_id)

    run = CompliancePracticeMatchRun(
        tenant_id=tenant_id,
        run_type=run_type,
        status="running",
        model_info_json={"prompt_version": "v1"},
        input_hash=input_hash,
        started_at=datetime.utcnow(),
    )
    db.add(run)
    db.flush()

    try:
        matches = _call_match_llm(practice_item, controls)
        valid_keys = {control.control_key for control in controls}
        results = _build_results(tenant_id, run.id, practice_item, matches, valid_keys)
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


def _call_match_llm(practice_item: CompliancePracticeItem, controls: list[ComplianceTenantControl]) -> list[dict[str, Any]]:
    instructions = (
        "You map internal practices to compliance controls. Return 0-5 best matches with confidence and rationale. "
        "Only use control_key values from the provided list. If nothing matches, return an empty list."
    )
    control_lines = [
        f"{c.control_key} | {c.title} | {c.domain_code} | {c.criticality} | {c.evidence_expected}"
        for c in controls
    ]
    input_text = "\n".join(
        [
            "Practice item:",
            f"Title: {practice_item.title}",
            f"Description: {practice_item.description_text}",
            "",
            "Controls:",
            *control_lines,
        ]
    )
    response = call_openai_responses_json(
        instructions=instructions,
        input_text=input_text,
        schema_name="practice_match_v1",
        schema=PRACTICE_MATCH_SCHEMA,
        temperature=0.2,
    )
    matches = response.get("matches") if isinstance(response, dict) else []
    if not isinstance(matches, list):
        return []
    return matches[:5]


def _build_results(
    tenant_id: UUID,
    run_id: UUID,
    practice_item: CompliancePracticeItem,
    matches: list[dict[str, Any]],
    valid_keys: set[str],
) -> list[CompliancePracticeMatchResult]:
    results: list[CompliancePracticeMatchResult] = []
    for match in matches:
        control_key = str(match.get("control_key") or "").strip()
        if not control_key or control_key not in valid_keys:
            continue
        results.append(
            CompliancePracticeMatchResult(
                tenant_id=tenant_id,
                run_id=run_id,
                practice_item_id=practice_item.id,
                control_key=control_key,
                confidence=float(match.get("confidence") or 0.0),
                coverage_score=float(match.get("coverage_score") or 0.0),
                rationale=str(match.get("rationale") or ""),
                suggested_evidence_json={"items": match.get("suggested_evidence") or []},
            )
        )
    return results


def _input_hash(practice_item: CompliancePracticeItem, batch_id: UUID | None) -> str:
    payload = json.dumps(
        {
            "title": practice_item.title,
            "description": practice_item.description_text,
            "category": practice_item.category,
            "status": practice_item.status,
            "frequency": practice_item.frequency,
            "evidence": practice_item.evidence,
            "frameworks": list(practice_item.frameworks or []),
            "batch_id": str(batch_id) if batch_id else None,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
