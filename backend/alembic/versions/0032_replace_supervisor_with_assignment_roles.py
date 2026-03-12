"""replace supervisor with granular assignment roles

Revision ID: 0032_replace_supervisor
Revises: 0031_simplify_roles
Create Date: 2026-03-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0032_replace_supervisor'
down_revision: str | Sequence[str] | None = '0031_simplify_roles'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Replace 'supervisor' in the primary role column with 'assignments_reviewer'
    #    (assignments_reviewer is the closest equivalent — it retains the
    #    assignments:read / write / review capabilities that were unique to supervisor).
    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET role = 'assignments_reviewer'
            WHERE role = 'supervisor'
            """
        )
    )

    # 2. Replace 'supervisor' inside the roles JSONB array with 'assignments_reviewer'.
    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET roles = (
                SELECT jsonb_agg(
                    CASE WHEN elem #>> '{}' = 'supervisor'
                         THEN to_jsonb('assignments_reviewer'::text)
                         ELSE elem
                    END
                )
                FROM jsonb_array_elements(roles) AS elem
            )
            WHERE roles IS NOT NULL AND roles @> '["supervisor"]'::jsonb
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET role = 'supervisor'
            WHERE role = 'assignments_reviewer'
            """
        )
    )

    conn.execute(
        sa.text(
            """
            UPDATE tenant_memberships
            SET roles = (
                SELECT jsonb_agg(
                    CASE WHEN elem #>> '{}' = 'assignments_reviewer'
                         THEN to_jsonb('supervisor'::text)
                         ELSE elem
                    END
                )
                FROM jsonb_array_elements(roles) AS elem
            )
            WHERE roles IS NOT NULL AND roles @> '["assignments_reviewer"]'::jsonb
            """
        )
    )
