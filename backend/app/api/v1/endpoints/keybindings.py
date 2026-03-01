from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.schemas.keybindings import KeybindingsPayload

router = APIRouter(prefix='/me/keybindings', tags=['keybindings'])


def _normalize_payload(raw: Any) -> KeybindingsPayload:
    if not isinstance(raw, dict):
        return KeybindingsPayload()
    updated_at = raw.get('updated_at') if isinstance(raw.get('updated_at'), (int, float, str)) else 0
    try:
        updated_at_int = int(updated_at)
    except (TypeError, ValueError):
        updated_at_int = 0
    bindings_raw = raw.get('bindings')
    bindings: dict[str, list[str]] = {}
    if isinstance(bindings_raw, dict):
        for action, combos in bindings_raw.items():
            if not isinstance(action, str):
                continue
            if isinstance(combos, list):
                cleaned = [str(c) for c in combos if isinstance(c, (str, int, float))]
                if cleaned:
                    bindings[action] = cleaned
    return KeybindingsPayload(updated_at=updated_at_int, bindings=bindings)


@router.get('', response_model=KeybindingsPayload)
def get_keybindings(
    current_user: User = Depends(get_current_active_user),
) -> KeybindingsPayload:
    prefs = current_user.preferences_json or {}
    return _normalize_payload(prefs.get('keybindings'))


@router.put('', response_model=KeybindingsPayload)
def update_keybindings(
    payload: KeybindingsPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> KeybindingsPayload:
    prefs = dict(current_user.preferences_json or {})
    prefs['keybindings'] = payload.model_dump()
    current_user.preferences_json = prefs
    db.add(current_user)
    db.commit()
    return _normalize_payload(prefs.get('keybindings'))
