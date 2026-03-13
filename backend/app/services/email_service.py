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


def _role_display(role: str) -> str:
    return role.replace('_', ' ').title()


# Groups mirror tenantRoleGroups in frontend/lib/constants.ts
_ROLE_GROUPS: list[tuple[str, list[str]]] = [
    ('Administration',        ['tenant_admin']),
    ('Assignments',           ['assignments_viewer', 'assignments_editor', 'assignments_reviewer']),
    ('Tracks',                ['tracks_editor']),
    ('Assessments',           ['assessments_editor']),
    ('Reports',               ['reports_viewer']),
    ('Compliance',            ['compliance_viewer', 'compliance_editor', 'compliance_admin']),
    ('Integration Registry',  ['ir_viewer', 'ir_editor', 'ir_approver', 'ir_admin']),
    ('Releases',              ['release_viewer', 'release_editor']),
    ('Billing',               ['billing_viewer', 'billing_manager']),
    ('Settings',              ['settings_manager']),
]

# Short label shown inside each group row (strips the repeated module prefix)
_ROLE_SHORT_LABEL: dict[str, str] = {
    'tenant_admin':           'Tenant Admin',
    'assignments_viewer':     'Viewer',
    'assignments_editor':     'Editor',
    'assignments_reviewer':   'Reviewer',
    'tracks_editor':          'Editor',
    'assessments_editor':     'Editor',
    'reports_viewer':         'Viewer',
    'compliance_viewer':      'Viewer',
    'compliance_editor':      'Editor',
    'compliance_admin':       'Administrator',
    'ir_viewer':              'Viewer',
    'ir_editor':              'Editor',
    'ir_approver':            'Approver',
    'ir_admin':               'Administrator',
    'release_viewer':         'Viewer',
    'release_editor':         'Editor',
    'billing_viewer':         'Viewer',
    'billing_manager':        'Manager',
    'settings_manager':       'Manager',
}


def _roles_grouped(roles: list[str]) -> str:
    """
    Render roles grouped by module as a compact two-column table.
    Groups with no matching roles are skipped.
    Example:
        Administration    Tenant Admin
        Assignments       Viewer · Editor · Reviewer
        Compliance        Viewer · Editor
    """
    role_set = set(roles)
    rows_html = ''

    for group_name, group_roles in _ROLE_GROUPS:
        matched = [r for r in group_roles if r in role_set]
        if not matched:
            continue
        short_labels = ' <span style="color:#94a3b8;font-size:11px;">·</span> '.join(
            f'<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;'
            f'border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">'
            f'{_ROLE_SHORT_LABEL.get(r, _role_display(r))}</span>'
            for r in matched
        )
        rows_html += (
            f'<tr>'
            f'<td style="padding:5px 14px 5px 0;font-size:12px;font-weight:700;'
            f'color:#374151;white-space:nowrap;vertical-align:middle;">{group_name}</td>'
            f'<td style="padding:5px 0;vertical-align:middle;">{short_labels}</td>'
            f'</tr>'
        )

    if not rows_html:
        return ''

    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" '
        f'style="margin:12px 0 4px;border-collapse:separate;border-spacing:0;">'
        f'{rows_html}'
        f'</table>'
    )


def _base_email(
    *,
    preheader: str,
    headline: str,
    body_lines: list[str],
    cta_text: str | None = None,
    cta_url: str | None = None,
    secondary_note: str | None = None,
    footer_note: str | None = None,
) -> str:
    """
    Render a full HTML email using a table-based layout compatible with all
    major email clients (Gmail, Outlook, Apple Mail, mobile).
    """
    cta_block = ''
    if cta_text and cta_url:
        cta_block = f"""
        <tr>
          <td align="center" style="padding:28px 0 8px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
              href="{cta_url}"
              style="height:44px;v-text-anchor:middle;width:220px;"
              arcsize="12%"
              stroke="f"
              fillcolor="#1e40af">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:700;">
                {cta_text}
              </center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="{cta_url}"
               style="display:inline-block;padding:13px 32px;background:#1e40af;
                      color:#ffffff;text-decoration:none;border-radius:6px;
                      font-family:Arial,sans-serif;font-size:15px;font-weight:700;
                      letter-spacing:0.01em;mso-hide:all;">
              {cta_text}
            </a>
            <!--<![endif]-->
          </td>
        </tr>"""

    secondary_block = ''
    if secondary_note:
        secondary_block = f"""
        <tr>
          <td style="padding:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;
                     font-family:Arial,sans-serif;line-height:1.6;">
            {secondary_note}
          </td>
        </tr>"""

    body_html = ''.join(
        f'<tr><td style="padding:4px 0 12px;font-size:15px;color:#334155;'
        f'font-family:Arial,sans-serif;line-height:1.7;">{line}</td></tr>'
        for line in body_lines
    )

    footer_html = ''
    if footer_note:
        footer_html = f"""
        <tr>
          <td style="padding:8px 0 0;font-size:12px;color:#94a3b8;
                     font-family:Arial,sans-serif;line-height:1.6;
                     border-top:1px solid #f1f5f9;">
            {footer_note}
          </td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>SolveBox</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;
              font-size:1px;color:#f1f5f9;line-height:1px;">
    {preheader}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;
    &#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Outer card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:580px;">

          <!-- Brand header -->
          <tr>
            <td align="center"
                style="background:#0f172a;border-radius:8px 8px 0 0;padding:24px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-family:Arial,sans-serif;font-size:22px;
                                 font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                      Solve<span style="color:#60a5fa;">Box</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content card -->
          <tr>
            <td style="background:#ffffff;padding:40px 40px 32px;
                       border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                <!-- Headline -->
                <tr>
                  <td style="padding:0 0 20px;font-family:Arial,sans-serif;
                             font-size:22px;font-weight:700;color:#0f172a;
                             line-height:1.3;border-bottom:1px solid #f1f5f9;">
                    {headline}
                  </td>
                </tr>

                <!-- Spacer -->
                <tr><td style="height:20px;"></td></tr>

                <!-- Body rows -->
                {body_html}

                <!-- CTA button -->
                {cta_block}

                <!-- Secondary note -->
                {secondary_block}

                <!-- Footer note -->
                {footer_html}

              </table>
            </td>
          </tr>

          <!-- Footer bar -->
          <tr>
            <td align="center"
                style="background:#f8fafc;border:1px solid #e2e8f0;
                       border-top:none;border-radius:0 0 8px 8px;
                       padding:20px 40px;">
              <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;
                        color:#94a3b8;line-height:1.6;">
                This email was sent by <strong style="color:#64748b;">SolveBox</strong>.
                If you have questions, contact your workspace administrator.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>"""


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
    display_name = to_name or to_email
    roles_html = _roles_grouped(roles) if roles else ''
    html = _base_email(
        preheader=f"You've been invited to join {tenant_name} on SolveBox. Set your password to get started.",
        headline=f'Welcome to {tenant_name}',
        body_lines=[
            f'Hi <strong>{display_name}</strong>,',
            f"You've been invited to join <strong>{tenant_name}</strong> on SolveBox. "
            f'Click the button below to set your password and activate your account.',
            f'<strong style="font-size:13px;color:#64748b;">Your assigned roles</strong>{roles_html}' if roles_html else '',
            '<strong style="color:#dc2626;">This link expires in 72 hours.</strong> '
            'If you did not expect this invitation, you can safely ignore this email.',
        ],
        cta_text='Set password &amp; get started',
        cta_url=set_password_url,
        footer_note='If you did not expect this invitation, no action is required. '
                    'This link will expire automatically.',
    )
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': f"You've been invited to {tenant_name} on SolveBox",
        'HtmlBody': html,
        'TextBody': (
            f"Hi {display_name},\n\n"
            f"You've been invited to join {tenant_name} on SolveBox.\n\n"
            f"Set your password here (valid 72 hours):\n{set_password_url}\n\n"
            f"Your roles: {', '.join(_role_display(r) for r in roles)}\n\n"
            "If you didn't expect this, you can ignore this email."
        ),
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
    display_name = to_name or to_email
    roles_html = _roles_grouped(roles) if roles else ''
    html = _base_email(
        preheader=f"You now have access to {tenant_name} on SolveBox.",
        headline=f'Access granted — {tenant_name}',
        body_lines=[
            f'Hi <strong>{display_name}</strong>,',
            f"You've been added to <strong>{tenant_name}</strong> on SolveBox. "
            f'Your account is ready — no additional setup is required.',
            f'<strong style="font-size:13px;color:#64748b;">Your roles in this workspace</strong>{roles_html}' if roles_html else '',
            'Open the link below to go directly to your workspace.',
        ],
        cta_text='Open workspace',
        cta_url=tenant_url,
    )
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': f"You've been added to {tenant_name} on SolveBox",
        'HtmlBody': html,
        'TextBody': (
            f"Hi {display_name},\n\n"
            f"You've been added to {tenant_name} on SolveBox.\n\n"
            f"Your roles: {', '.join(_role_display(r) for r in roles)}\n\n"
            f"Open your workspace: {tenant_url}"
        ),
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
    display_name = to_name or to_email
    roles_html = _roles_grouped(roles) if roles else ''
    html = _base_email(
        preheader=f"Your access permissions in {tenant_name} have been updated.",
        headline='Your permissions have been updated',
        body_lines=[
            f'Hi <strong>{display_name}</strong>,',
            f'Your role assignments in <strong>{tenant_name}</strong> on SolveBox '
            f'have been updated by an administrator.',
            f'<strong style="font-size:13px;color:#64748b;">Your current roles</strong>{roles_html}' if roles_html else '',
            'These changes are effective immediately. If you believe this was made in error, '
            'contact your workspace administrator.',
        ],
        cta_text='Open workspace',
        cta_url=tenant_url,
        footer_note='This is an automated notification. Your access has already been updated.',
    )
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': f'Your access in {tenant_name} has been updated',
        'HtmlBody': html,
        'TextBody': (
            f"Hi {display_name},\n\n"
            f"Your role assignments in {tenant_name} on SolveBox have been updated.\n\n"
            f"Current roles: {', '.join(_role_display(r) for r in roles)}\n\n"
            f"Open your workspace: {tenant_url}\n\n"
            "If this was unexpected, contact your workspace administrator."
        ),
        'MessageStream': 'outbound',
    })


def send_password_reset(
    *,
    to_email: str,
    to_name: str,
    reset_url: str,
) -> None:
    """Send a password-reset link to an existing user."""
    display_name = to_name or to_email
    html = _base_email(
        preheader='Reset your SolveBox password. This link is valid for 24 hours.',
        headline='Reset your password',
        body_lines=[
            f'Hi <strong>{display_name}</strong>,',
            'We received a request to reset the password for your SolveBox account. '
            'Click the button below to choose a new password.',
            '<strong style="color:#dc2626;">This link expires in 24 hours.</strong> '
            'After that, you will need to request a new reset link.',
        ],
        cta_text='Reset password',
        cta_url=reset_url,
        secondary_note='If the button above does not work, copy and paste this URL into your browser:<br/>'
                       f'<span style="color:#1e40af;word-break:break-all;">{reset_url}</span>',
        footer_note='If you did not request a password reset, you can safely ignore this email. '
                    'Your password will not change.',
    )
    _send({
        'From': _from_address(),
        'To': to_email,
        'Subject': 'Reset your SolveBox password',
        'HtmlBody': html,
        'TextBody': (
            f"Hi {display_name},\n\n"
            "We received a request to reset your SolveBox password.\n\n"
            f"Reset your password (valid 24 hours):\n{reset_url}\n\n"
            "If you did not request this, you can safely ignore this email."
        ),
        'MessageStream': 'outbound',
    })
