from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.release_mgmt import DataCenter
from app.schemas.data_centers import DataCenterCreate, DataCenterUpdate


def list_data_centers(db: Session) -> list[DataCenter]:
    return list(db.scalars(select(DataCenter).order_by(DataCenter.is_primary.desc(), DataCenter.name)).all())


def get_data_center(db: Session, dc_id: uuid.UUID) -> DataCenter:
    dc = db.scalar(select(DataCenter).where(DataCenter.id == dc_id))
    if not dc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data center not found.")
    return dc


def create_data_center(db: Session, payload: DataCenterCreate, actor_id: uuid.UUID) -> DataCenter:
    existing = db.scalar(select(DataCenter).where(DataCenter.slug == payload.slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Slug '{payload.slug}' is already in use.")

    dc = DataCenter(
        name=payload.name,
        slug=payload.slug,
        location=payload.location,
        cluster_url=payload.cluster_url,
        k8s_context=payload.k8s_context,
        environment=payload.environment,
        is_primary=payload.is_primary,
        is_dr=payload.is_dr,
        is_active=payload.is_active,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(dc)
    db.commit()
    db.refresh(dc)
    return dc


def update_data_center(db: Session, dc_id: uuid.UUID, payload: DataCenterUpdate, actor_id: uuid.UUID) -> DataCenter:
    dc = get_data_center(db, dc_id)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(dc, field, value)
    dc.updated_by = actor_id
    db.commit()
    db.refresh(dc)
    return dc


def delete_data_center(db: Session, dc_id: uuid.UUID) -> None:
    dc = get_data_center(db, dc_id)
    db.delete(dc)
    db.commit()
