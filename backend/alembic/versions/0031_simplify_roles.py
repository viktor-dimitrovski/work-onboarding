"""simplify role model: remove legacy bundle roles, add supervisor

Revision ID: 0031_simplify_roles
Revises: 0030_password_set_tokens
Create Date: 2026-03-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0031_simplify_roles'
down_revision: str | Sequence[str] | None = '0030_password_set_tokens'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Rename 'manager' memberships → 'supervisor' in the primary role column.
    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET role = 'supervisor'
            WHERE role = 'manager'
            """
        )
    )

    # 2. Replace 'manager' inside the roles JSONB array with 'supervisor'.
    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET roles = (
                SELECT jsonb_agg(
                    CASE WHEN elem #>> '{}' = 'manager' THEN to_jsonb('supervisor'::text) ELSE elem END
                )
                FROM jsonb_array_elements(roles) AS elem
            )
            WHERE roles IS NOT NULL AND roles @> '["manager"]'::jsonb
            """
        )
    )

    # 3. Remove legacy identity-only roles from JSONB arrays
    #    (member, mentor, parent) that carry no permissions.
    for legacy_role in ('member', 'mentor', 'parent'):
        conn.execute(
            sa.text(
                f"""
                UPDATE tenant_memberships
                SET roles = COALESCE(
                    (
                        SELECT jsonb_agg(elem)
                        FROM jsonb_array_elements(roles) AS elem
                        WHERE elem <> to_jsonb('{legacy_role}'::text)
                    ),
                    '[]'::jsonb
                )
                WHERE roles @> '["{legacy_role}"]'::jsonb
                """
            )
        )

    # 4. Rows whose roles array became empty or NULL get 'supervisor' as the
    #    primary role and a minimal array so there is always at least one role.
    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET
                role   = 'supervisor',
                roles  = '["supervisor"]'::jsonb
            WHERE roles IS NULL OR jsonb_array_length(roles) = 0
            """
        )
    )

    # 5. Also set role column to match first element of the roles array for
    #    rows where the primary role column still has a legacy value.
    for legacy_role in ('member', 'mentor', 'parent'):
        conn.execute(
            sa.text(
                f"""
                UPDATE tenant_memberships
                SET role = roles ->> 0
                WHERE role = '{legacy_role}'
                """
            )
        )

    # 6. Drop legacy global roles from the roles table (if it exists and has them).
    for dead_role in ('admin', 'employee', 'hr_viewer', 'reviewer', 'mentor', 'manager', 'member', 'parent'):
        conn.execute(
            sa.text(
                f"DELETE FROM roles WHERE name = '{dead_role}'"
            )
        )

    # 7. Update the check constraint on the roles table to only allow super_admin.
    #    op.drop_constraint is safe even if the constraint doesn't exist when
    #    IF EXISTS is used via raw SQL.
    try:
        op.drop_constraint('role_name_values', 'roles', type_='check')
    except Exception:
        pass
    op.create_check_constraint(
        'role_name_values',
        'roles',
        "name in ('super_admin')",
    )


def downgrade() -> None:
    # Restore the broader check constraint so the old app can run.
    try:
        op.drop_constraint('role_name_values', 'roles', type_='check')
    except Exception:
        pass
    op.create_check_constraint(
        'role_name_values',
        'roles',
        "name in ('super_admin', 'admin', 'mentor', 'employee', 'hr_viewer', 'reviewer')",
    )
    # Note: data changes (role renames) are intentionally NOT reversed as
    # re-creating the legacy 'member'/'manager'/'mentor' semantics would
    # require more context than is safe to automate in a downgrade.
