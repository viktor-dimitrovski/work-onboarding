import copy
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_current_active_user
from app.core.crypto import decrypt_secret, encrypt_secret, is_encrypted
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.settings import TenantSettingsOut, TenantSettingsUpdate, WorkOrdersGitHubSettings

router = APIRouter(prefix='/settings', tags=['settings'])

DEFAULT_TRACK_PURPOSE_LABELS: list[dict[str, str]] = [
    {'value': 'onboarding', 'label': 'Onboarding'},
    {'value': 'assessment', 'label': 'Assessment'},
    {'value': 'both', 'label': 'Onboarding + Assessment'},
]

DEFAULT_SETTINGS: dict[str, Any] = {
    'default_onboarding_target_days': 45,
    'escalation_email': 'onboarding-ops@example.com',
    'notification_policy_notes': (
        'MVP placeholder. TODO: Connect Slack/Jira/GitHub webhooks and SSO provisioning events.'
    ),
    'track_purpose_labels': DEFAULT_TRACK_PURPOSE_LABELS,
    'work_orders_github': {
        'enabled': False,
        'repo_full_name': None,
        'folder_path': 'work-orders',
        'release_manifests_folder_path': 'releases',
        'base_branch': None,
        'installation_id': None,
        'sync_on_save': True,
    },
}


def _normalize_track_purposes(items: Any) -> list[dict[str, str]]:
    if not items or not isinstance(items, list):
        return DEFAULT_TRACK_PURPOSE_LABELS
    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, dict):
            value = (item.get('value') or '').strip()
            label = (item.get('label') or '').strip()
        else:
            # Pydantic model instance (TrackPurposeLabel) or similar
            value = (getattr(item, 'value', '') or '').strip()
            label = (getattr(item, 'label', '') or '').strip()
        if not value or not label:
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append({'value': value, 'label': label})
    return normalized or DEFAULT_TRACK_PURPOSE_LABELS


def _settings_response(raw: dict[str, Any]) -> TenantSettingsOut:
    default_target = raw.get('default_onboarding_target_days') or DEFAULT_SETTINGS['default_onboarding_target_days']
    wo_git_raw = raw.get('work_orders_github') if isinstance(raw.get('work_orders_github'), dict) else {}
    merged = {**(DEFAULT_SETTINGS.get('work_orders_github') or {}), **(wo_git_raw or {})}
    # Never expose the encrypted PAT — replace with a boolean indicator
    stored_pat = merged.pop('github_pat', None)
    merged['pat_configured'] = bool(stored_pat)
    return TenantSettingsOut(
        default_onboarding_target_days=int(default_target),
        escalation_email=raw.get('escalation_email') or DEFAULT_SETTINGS['escalation_email'],
        notification_policy_notes=raw.get('notification_policy_notes')
        or DEFAULT_SETTINGS['notification_policy_notes'],
        track_purpose_labels=_normalize_track_purposes(raw.get('track_purpose_labels')),
        work_orders_github=WorkOrdersGitHubSettings(**merged),
    )


@router.get('', response_model=dict[str, Any])
def get_settings(
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
) -> dict[str, Any]:
    raw = ctx.tenant.settings_json or {}
    # Return typed response merged with the raw settings_json for extended fields
    structured = _settings_response(raw).model_dump()
    return {**raw, **structured, 'settings_json': raw}


@router.put('', response_model=TenantSettingsOut)
def update_settings(
    payload: TenantSettingsUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
) -> TenantSettingsOut:
    raw = copy.deepcopy(ctx.tenant.settings_json or {})
    if payload.default_onboarding_target_days is not None:
        raw['default_onboarding_target_days'] = payload.default_onboarding_target_days
    if payload.escalation_email is not None:
        raw['escalation_email'] = payload.escalation_email
    if payload.notification_policy_notes is not None:
        raw['notification_policy_notes'] = payload.notification_policy_notes
    if payload.track_purpose_labels is not None:
        raw['track_purpose_labels'] = _normalize_track_purposes(payload.track_purpose_labels)
    if payload.work_orders_github is not None:
        wo_dump = payload.work_orders_github.model_dump(exclude={'pat_configured'})
        # Preserve existing encrypted PAT — the PUT /settings path never touches it
        existing_wo = raw.get('work_orders_github') if isinstance(raw.get('work_orders_github'), dict) else {}
        if existing_wo.get('github_pat'):
            wo_dump['github_pat'] = existing_wo['github_pat']
        raw['work_orders_github'] = wo_dump

    ctx.tenant.settings_json = raw
    flag_modified(ctx.tenant, 'settings_json')
    db.add(ctx.tenant)
    db.commit()
    return _settings_response(raw)


class _GithubPatPayload(TenantSettingsUpdate.__base__):  # type: ignore[name-defined]
    github_pat: str  # the raw PAT — write-only, encrypted before storage


from pydantic import BaseModel as _PydanticBase


class _GithubPatIn(_PydanticBase):
    github_pat: str


class _GithubPatOut(_PydanticBase):
    pat_configured: bool


@router.put('/github-pat', response_model=_GithubPatOut)
def set_github_pat(
    payload: _GithubPatIn,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
) -> _GithubPatOut:
    """Store an encrypted GitHub PAT for the tenant. The raw token is never returned."""
    from fastapi import HTTPException

    raw = copy.deepcopy(ctx.tenant.settings_json or {})
    wo_git: dict = raw.get('work_orders_github') if isinstance(raw.get('work_orders_github'), dict) else {}
    pat = payload.github_pat.strip()
    if pat:
        try:
            wo_git['github_pat'] = encrypt_secret(pat)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    else:
        wo_git.pop('github_pat', None)
    raw['work_orders_github'] = wo_git
    ctx.tenant.settings_json = raw
    flag_modified(ctx.tenant, 'settings_json')
    db.add(ctx.tenant)
    db.commit()
    return _GithubPatOut(pat_configured=bool(pat))


@router.delete('/github-pat', response_model=_GithubPatOut, status_code=200)
def delete_github_pat(
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
) -> _GithubPatOut:
    """Remove the stored GitHub PAT for the tenant."""
    raw = copy.deepcopy(ctx.tenant.settings_json or {})
    wo_git: dict = raw.get('work_orders_github') if isinstance(raw.get('work_orders_github'), dict) else {}
    wo_git.pop('github_pat', None)
    raw['work_orders_github'] = wo_git
    ctx.tenant.settings_json = raw
    flag_modified(ctx.tenant, 'settings_json')
    db.add(ctx.tenant)
    db.commit()
    return _GithubPatOut(pat_configured=False)


@router.patch('', response_model=dict[str, Any])
def patch_settings(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Partial update of settings_json — merges top-level keys."""
    raw = copy.deepcopy(ctx.tenant.settings_json or {})
    for key, value in payload.items():
        raw[key] = value
    ctx.tenant.settings_json = raw
    flag_modified(ctx.tenant, 'settings_json')
    db.add(ctx.tenant)
    db.commit()
    return raw
