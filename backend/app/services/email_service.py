"""Postmark email delivery service.

All sending is fire-and-forget via httpx.  Failures are logged but never
raised so that a broken email config never disrupts the main request flow.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_POSTMARK_API = 'https://api.postmarkapp.com/email'
_TIMEOUT = 10.0


def _is_configured() -> bool:
    return bool(settings.POSTMARK_SERVER_TOKEN)


def _send(payload: dict[str, Any]) -> None:
    """POST one message to Postmark.  Logs errors silently."""
    if not _is_configured():
        logger.warning('Email not sent — POSTMARK_SERVER_TOKEN is not configured. Subject: %s', payload.get('Subject'))
        return

    try:
        response = httpx.post(
            _POSTMARK_API,
            json=payload,
            headers={
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': settings.POSTMARK_SERVER_TOKEN,  # type: ignore[arg-type]
            },
            timeout=_TIMEOUT,
        )
        if response.status_code >= 400:
            logger.error(
                'Postmark rejected email to %s — HTTP %s: %s',
                payload.get('To'),
                response.status_code,
                response.text[:300],
            )
        else:
            logger.info('Email sent to %s — subject: %s', payload.get('To'), payload.get('Subject'))
    except Exception:
        logger.exception('Failed to send email to %s', payload.get('To'))


def _from_address() -> str:
    return settings.NOTIFICATIONS_FROM_EMAIL or 'notifications@solvebox.org'


# ── Public senders ─────────────────────────────────────────────────────────────

def send_invitation(
    *,
    to_email: str,
    to_name: str,
    tenant_name: str,
    set_password_url: str,
    roles: list[str],
) -> None:
    """Invite a brand-new user; they must click the link to set their password."""
    roles_html = ''.join(f'<li>{r.replace("_", " ").title()}</li>' for r in roles)
    html = f"""
<p>Hi {to_name or to_email},</p>
<p>You've been invited to join <strong>{tenant_name}</strong> on <strong>SolveBox</strong>.</p>
<p>Your assigned roles:</p>
<ul>{roles_html}</ul>
<p>Click the button below to set your password and activate your account.
   This link is valid for <strong>72 hours</strong>.</p>
<p>
  <a href="{set_password_url}"
     style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;
            text-decoration:none;border-radius:6px;font-weight:600;">
    Set password &amp; get started
  </a>
</p>
<p style="color:#6b7280;font-size:12px;">
  If you didn't expect this invitation, you can safely ignore this email.
</p>
"""
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': f'You\'ve been invited to {tenant_name} on SolveBox',
        'HtmlBody': html,
        'MessageStream': 'outbound',
    })


def send_tenant_welcome(
    *,
    to_email: str,
    to_name: str,
    tenant_name: str,
    tenant_url: str,
    roles: list[str],
) -> None:
    """Notify an existing user that they've been added to a new tenant."""
    roles_html = ''.join(f'<li>{r.replace("_", " ").title()}</li>' for r in roles)
    html = f"""
<p>Hi {to_name or to_email},</p>
<p>You've been added to <strong>{tenant_name}</strong> on <strong>SolveBox</strong>.</p>
<p>Your roles in this workspace:</p>
<ul>{roles_html}</ul>
<p>
  <a href="{tenant_url}"
     style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;
            text-decoration:none;border-radius:6px;font-weight:600;">
    Open workspace
  </a>
</p>
"""
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': f'You\'ve been added to {tenant_name}',
        'HtmlBody': html,
        'MessageStream': 'outbound',
    })


def send_roles_updated(
    *,
    to_email: str,
    to_name: str,
    tenant_name: str,
    tenant_url: str,
    roles: list[str],
) -> None:
    """Notify a user that their roles in a tenant have been changed."""
    roles_html = ''.join(f'<li>{r.replace("_", " ").title()}</li>' for r in roles)
    html = f"""
<p>Hi {to_name or to_email},</p>
<p>Your roles in <strong>{tenant_name}</strong> on <strong>SolveBox</strong> have been updated.</p>
<p>Your current roles:</p>
<ul>{roles_html}</ul>
<p>
  <a href="{tenant_url}"
     style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;
            text-decoration:none;border-radius:6px;font-weight:600;">
    Open workspace
  </a>
</p>
"""
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': f'Your roles in {tenant_name} have been updated',
        'HtmlBody': html,
        'MessageStream': 'outbound',
    })


def send_password_reset(
    *,
    to_email: str,
    to_name: str,
    reset_url: str,
) -> None:
    """Send a password-reset link to an existing user."""
    html = f"""
<p>Hi {to_name or to_email},</p>
<p>We received a request to reset your <strong>SolveBox</strong> password.</p>
<p>Click the button below.  This link is valid for <strong>24 hours</strong>.</p>
<p>
  <a href="{reset_url}"
     style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;
            text-decoration:none;border-radius:6px;font-weight:600;">
    Reset password
  </a>
</p>
<p style="color:#6b7280;font-size:12px;">
  If you did not request a password reset, you can safely ignore this email.
</p>
"""
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': 'Reset your SolveBox password',
        'HtmlBody': html,
        'MessageStream': 'outbound',
    })
