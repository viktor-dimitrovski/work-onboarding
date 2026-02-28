from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.rbac import User
from app.multitenancy.deps import TenantContext, require_tenant_membership
from app.multitenancy.permissions import require_access
from app.schemas.settings import TenantSettingsOut, TenantSettingsUpdate, TrackPurposeLabel

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
}


def _normalize_track_purposes(items: list[TrackPurposeLabel] | None) -> list[dict[str, str]]:
    if not items:
        return DEFAULT_TRACK_PURPOSE_LABELS
    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for item in items:
        value = (item.value or '').strip()
        label = (item.label or '').strip()
        if not value or not label:
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append({'value': value, 'label': label})
    return normalized or DEFAULT_TRACK_PURPOSE_LABELS


def _settings_response(raw: dict[str, Any]) -> TenantSettingsOut:
    default_target = raw.get('default_onboarding_target_days') or DEFAULT_SETTINGS['default_onboarding_target_days']
    return TenantSettingsOut(
        default_onboarding_target_days=int(default_target),
        escalation_email=raw.get('escalation_email') or DEFAULT_SETTINGS['escalation_email'],
        notification_policy_notes=raw.get('notification_policy_notes')
        or DEFAULT_SETTINGS['notification_policy_notes'],
        track_purpose_labels=_normalize_track_purposes(raw.get('track_purpose_labels')),
    )


@router.get('', response_model=TenantSettingsOut)
def get_settings(
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
) -> TenantSettingsOut:
    raw = ctx.tenant.settings_json or {}
    return _settings_response(raw)


@router.put('', response_model=TenantSettingsOut)
def update_settings(
    payload: TenantSettingsUpdate,
    db: Session = Depends(get_db),
    ctx: TenantContext = Depends(require_tenant_membership),
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_access('settings', 'settings:manage')),
) -> TenantSettingsOut:
    raw = dict(ctx.tenant.settings_json or {})
    if payload.default_onboarding_target_days is not None:
        raw['default_onboarding_target_days'] = payload.default_onboarding_target_days
    if payload.escalation_email is not None:
        raw['escalation_email'] = payload.escalation_email
    if payload.notification_policy_notes is not None:
        raw['notification_policy_notes'] = payload.notification_policy_notes
    if payload.track_purpose_labels is not None:
        raw['track_purpose_labels'] = _normalize_track_purposes(payload.track_purpose_labels)

    ctx.tenant.settings_json = raw
    db.add(ctx.tenant)
    db.commit()
    return _settings_response(raw)
