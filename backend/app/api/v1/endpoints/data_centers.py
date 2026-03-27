from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.permissions import require_access
from app.schemas.data_centers import DataCenterCreate, DataCenterListResponse, DataCenterOut, DataCenterUpdate
from app.services import data_center_service


router = APIRouter(prefix="/data-centers", tags=["data-centers"])


@router.get("", response_model=DataCenterListResponse)
def list_data_centers(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> DataCenterListResponse:
    items = data_center_service.list_data_centers(db)
    return DataCenterListResponse(items=[DataCenterOut.model_validate(dc) for dc in items], total=len(items))


@router.post("", response_model=DataCenterOut, status_code=status.HTTP_201_CREATED)
def create_data_center(
    payload: DataCenterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> DataCenterOut:
    dc = data_center_service.create_data_center(db, payload, current_user.id)
    return DataCenterOut.model_validate(dc)


@router.get("/{dc_id}", response_model=DataCenterOut)
def get_data_center(
    dc_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:read")),
) -> DataCenterOut:
    dc = data_center_service.get_data_center(db, dc_id)
    return DataCenterOut.model_validate(dc)


@router.patch("/{dc_id}", response_model=DataCenterOut)
def update_data_center(
    dc_id: uuid.UUID,
    payload: DataCenterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> DataCenterOut:
    dc = data_center_service.update_data_center(db, dc_id, payload, current_user.id)
    return DataCenterOut.model_validate(dc)


@router.delete("/{dc_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_data_center(
    dc_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access("releases", "releases:write")),
) -> None:
    data_center_service.delete_data_center(db, dc_id)
