from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.compliance import ComplianceControlEmbedding, ComplianceTenantControl
from app.services.openai_embeddings_service import get_embedding


@dataclass
class VectorSearchResult:
    control: ComplianceTenantControl
    score: float


def get_top_k_controls(
    db: Session,
    *,
    tenant_id: UUID,
    text: str,
    k: int = 30,
) -> list[ComplianceTenantControl] | None:
    if not settings.COMPLIANCE_VECTOR_SEARCH_ENABLED:
        return None
    controls = db.scalars(
        select(ComplianceTenantControl)
        .where(ComplianceTenantControl.tenant_id == tenant_id, ComplianceTenantControl.is_active.is_(True))
        .order_by(ComplianceTenantControl.code.asc())
    ).all()
    if not controls:
        return []

    model = settings.OPENAI_EMBEDDING_MODEL
    embeddings = db.scalars(
        select(ComplianceControlEmbedding).where(
            ComplianceControlEmbedding.tenant_id == tenant_id,
            ComplianceControlEmbedding.model == model,
        )
    ).all()
    embed_map = {row.control_key: row.embedding_json for row in embeddings}

    missing_controls = [c for c in controls if c.control_key not in embed_map]
    if missing_controls:
        for control in missing_controls:
            embed = get_embedding(_control_text(control))
            stmt = insert(ComplianceControlEmbedding).values(
                tenant_id=tenant_id,
                control_key=control.control_key,
                model=model,
                embedding_json=embed,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["tenant_id", "control_key", "model"],
                set_={"embedding_json": embed},
            )
            db.execute(stmt)
            embed_map[control.control_key] = embed
        db.flush()

    query_embedding = get_embedding(text)
    ranked = sorted(
        [
            VectorSearchResult(control=control, score=_cosine_similarity(query_embedding, embed_map[control.control_key]))
            for control in controls
            if control.control_key in embed_map
        ],
        key=lambda item: item.score,
        reverse=True,
    )
    return [item.control for item in ranked[:k]]


def _control_text(control: ComplianceTenantControl) -> str:
    return " | ".join(
        [
            control.control_key,
            control.title,
            control.description,
            control.evidence_expected,
        ]
    )


def _cosine_similarity(a: Iterable[float], b: Iterable[float]) -> float:
    a_list = list(a)
    b_list = list(b)
    if not a_list or not b_list:
        return 0.0
    dot = sum(x * y for x, y in zip(a_list, b_list))
    norm_a = sum(x * x for x in a_list) ** 0.5
    norm_b = sum(y * y for y in b_list) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
