"""backfill default tenant memberships for legacy users

Revision ID: 0010_backfill_default_tenant_memberships
Revises: 0009_merge_heads
Create Date: 2026-02-28

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import uuid


revision: str = "0010_backfill_default_tenant_memberships"
down_revision: str | tuple[str, ...] | None = "0009_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _resolve_default_tenant_id(conn) -> str | None:
    tenant_id = conn.execute(sa.text("select id::text from tenants where slug = 'default' limit 1")).scalar()
    if tenant_id:
        return str(tenant_id)
    tenant_id = conn.execute(sa.text("select id::text from tenants order by created_at asc limit 1")).scalar()
    return str(tenant_id) if tenant_id else None


def upgrade() -> None:
    conn = op.get_bind()
    tenant_id = _resolve_default_tenant_id(conn)
    if not tenant_id:
        return

    # RLS policies require tenant_id = current_setting('app.tenant_id')::uuid for inserts/reads.
    conn.execute(sa.text("select set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})

    # Backfill: users that existed before multitenancy may have no tenant_memberships row,
    # so they won't appear in the tenant-scoped directory (/api/v1/users).
    #
    # Map global roles to tenant roles (permissions are tenant-role based):
    # - super_admin/admin -> tenant_admin
    # - mentor -> mentor
    # - everything else -> member
    # NOTE: tenant_memberships.id is generated in application code (no DB default),
    # so we must provide it here.
    missing = conn.execute(
        sa.text(
            """
            select
              u.id::text as user_id,
              case
                when exists (
                  select 1
                  from user_roles ur
                  join roles r on r.id = ur.role_id
                  where ur.user_id = u.id and r.name in ('super_admin', 'admin')
                ) then 'tenant_admin'
                when exists (
                  select 1
                  from user_roles ur
                  join roles r on r.id = ur.role_id
                  where ur.user_id = u.id and r.name = 'mentor'
                ) then 'mentor'
                else 'member'
              end as role
            from users u
            where not exists (
              select 1 from tenant_memberships tm
              where tm.tenant_id = cast(:tenant_id as uuid) and tm.user_id = u.id
            )
            """
        ),
        {"tenant_id": tenant_id},
    ).all()

    if not missing:
        return

    insert_stmt = sa.text(
        """
        insert into tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at)
        values (cast(:id as uuid), cast(:tenant_id as uuid), cast(:user_id as uuid), :role, 'active', now(), now())
        """
    )
    for row in missing:
        conn.execute(
            insert_stmt,
            {"id": str(uuid.uuid4()), "tenant_id": tenant_id, "user_id": row.user_id, "role": row.role},
        )


def downgrade() -> None:
    # Non-destructive downgrade: we don't delete memberships created for existing users.
    pass

