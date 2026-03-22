"""Fix assessment questions incorrectly stored in the `default` tenant.

Why this exists
--------------
Early migrations added `tenant_id` to assessment tables with a server_default
pointing at a seeded `default` tenant. A follow-up migration (0010) also
backfilled tenant memberships for all legacy users into that same default
tenant.

Result: the default tenant is *not* "phantom" (it has memberships), but it can
still incorrectly own assessment questions that were created before proper host
tenant resolution was in place. Those questions then fail to be used in a real
tenant (e.g. test builder "Question not found").

This migration moves assessment questions out of the `default` tenant into the
correct real tenant, using these rules:
  - If there is exactly one non-default tenant with active memberships, move
    everything to that tenant (common dev/staging setup).
  - Otherwise, move per-question using created_by/updated_by user's unique
    active non-default tenant membership; ambiguous rows are skipped.

FK safety
---------
The assessment schema uses composite FKs (tenant_id, question_id). We temporarily
drop all FK constraints between the involved tables, perform the updates, then
recreate the composite FKs.

We also remap category_id by slug: default-tenant category slug → target-tenant
category with the same slug (created if missing).

RLS
---
This is an administrative data migration. We attempt to disable RLS for the
transaction with `SET LOCAL row_security = off` (works for table owners / roles
with BYPASSRLS).

Revision ID: 0044_fix_default_tenant_assessment_questions
Revises: 0043_fix_assessment_phantom_questions_fk_safe
"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa


revision = "0044_fix_default_tenant_assessment_questions"
down_revision = "0043_fix_assessment_phantom_questions_fk_safe"
branch_labels = None
depends_on = None


def _drop_fk_if_exists(conn, table: str, constraint_name: str) -> None:
    conn.execute(sa.text(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS "{constraint_name}"'))


def _drop_all_fks_between(conn, table: str, referenced_table: str) -> None:
    rows = conn.execute(
        sa.text(
            """
            SELECT c.conname::text
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_class rt ON rt.oid = c.confrelid
            WHERE c.contype = 'f'
              AND t.relname = :table
              AND rt.relname = :ref
            """
        ),
        {"table": table, "ref": referenced_table},
    ).fetchall()
    for (name,) in rows:
        _drop_fk_if_exists(conn, table, str(name))


def upgrade() -> None:
    conn = op.get_bind()

    try:
        conn.execute(sa.text("SET LOCAL row_security = off"))
        print("0044: row_security=off")
    except Exception as e:  # noqa: BLE001
        print(f"0044: WARNING: could not SET LOCAL row_security=off ({e!r}); continuing")

    default_tid = conn.execute(
        sa.text("select id::text from tenants where slug = 'default' limit 1")
    ).scalar()
    if not default_tid:
        print("0044: no 'default' tenant found – nothing to do")
        return

    default_q_count = conn.execute(
        sa.text("select count(*) from assessment_questions where tenant_id = cast(:tid as uuid)"),
        {"tid": str(default_tid)},
    ).scalar()
    default_q_count = int(default_q_count or 0)
    if default_q_count == 0:
        print(f"0044: default tenant {default_tid} owns 0 assessment_questions – nothing to do")
        return

    # Candidate target tenants = active membership tenants excluding default.
    target_rows = conn.execute(
        sa.text(
            """
            select distinct tm.tenant_id::text
            from tenant_memberships tm
            join tenants t on t.id = tm.tenant_id
            where tm.status = 'active'
              and t.is_active is true
              and t.slug <> 'default'
            """
        )
    ).fetchall()
    target_tenant_ids = [r[0] for r in target_rows]
    single_target = target_tenant_ids[0] if len(target_tenant_ids) == 1 else None

    print(f"0044: default tenant = {default_tid} (questions={default_q_count})")
    print(f"0044: non-default active tenants = {target_tenant_ids}")

    if not target_tenant_ids:
        print("0044: no non-default active tenants found – nothing to do")
        return

    # user_id -> list of active non-default tenant_ids
    user_rows = conn.execute(
        sa.text(
            """
            select tm.user_id::text,
                   array_agg(distinct tm.tenant_id::text) as tenant_ids
            from tenant_memberships tm
            join tenants t on t.id = tm.tenant_id
            where tm.status = 'active'
              and t.is_active is true
              and t.slug <> 'default'
            group by tm.user_id
            """
        )
    ).fetchall()
    user_to_tenants: dict[str, list[str]] = {str(r[0]): list(r[1] or []) for r in user_rows}

    # Cache: default category id -> (slug, name)
    cat_rows = conn.execute(
        sa.text(
            """
                select id::text, slug::text, name::text
                from assessment_categories
                where tenant_id = cast(:tid as uuid)
            """
        ),
        {"tid": str(default_tid)},
    ).fetchall()
    default_cat_by_id: dict[str, tuple[str, str]] = {str(r[0]): (str(r[1]), str(r[2])) for r in cat_rows}

    # Cache: per target tenant slug -> id
    target_slug_to_id: dict[str, dict[str, str]] = {}

    def _ensure_category(target_tid: str, slug: str, name: str) -> str:
        slug_map = target_slug_to_id.get(target_tid)
        if slug_map is None:
            rows = conn.execute(
                sa.text(
                    """
                    select id::text, slug::text
                    from assessment_categories
                    where tenant_id = cast(:tid as uuid)
                    """
                ),
                {"tid": target_tid},
            ).fetchall()
            slug_map = {str(r[1]): str(r[0]) for r in rows if r[0] and r[1]}
            target_slug_to_id[target_tid] = slug_map

        if slug in slug_map:
            return slug_map[slug]

        new_id = str(uuid.uuid4())
        conn.execute(
            sa.text(
                """
                insert into assessment_categories (id, tenant_id, name, slug, parent_id)
                values (cast(:id as uuid), cast(:tenant_id as uuid), :name, :slug, null)
                """
            ),
            {"id": new_id, "tenant_id": target_tid, "name": name, "slug": slug},
        )
        slug_map[slug] = new_id
        return new_id

    # ------------------------------------------------------------------
    # Drop FK constraints that prevent tenant_id reassignment.
    # ------------------------------------------------------------------
    _drop_all_fks_between(conn, "assessment_questions", "assessment_categories")
    _drop_all_fks_between(conn, "assessment_question_options", "assessment_questions")
    _drop_all_fks_between(conn, "assessment_test_version_questions", "assessment_questions")
    _drop_all_fks_between(conn, "assessment_classification_job_items", "assessment_questions")

    moved = 0
    skipped = 0

    q_rows = conn.execute(
        sa.text(
            """
            select id::text,
                   category_id::text,
                   created_by::text,
                   updated_by::text
            from assessment_questions
            where tenant_id = cast(:tid as uuid)
            """
        ),
        {"tid": str(default_tid)},
    ).fetchall()

    for qid, old_cat_id, created_by, updated_by in q_rows:
        target_tid: str | None = single_target

        if target_tid is None and created_by and str(created_by) in user_to_tenants:
            candidates = user_to_tenants[str(created_by)]
            if len(candidates) == 1:
                target_tid = candidates[0]
        if target_tid is None and updated_by and str(updated_by) in user_to_tenants:
            candidates = user_to_tenants[str(updated_by)]
            if len(candidates) == 1:
                target_tid = candidates[0]

        if target_tid is None:
            skipped += 1
            continue

        new_cat_id: str | None = None
        if old_cat_id:
            info = default_cat_by_id.get(str(old_cat_id))
            if info:
                slug, name = info
                new_cat_id = _ensure_category(target_tid, slug=slug, name=name or slug)

        # Move the question row
        conn.execute(
            sa.text(
                """
                update assessment_questions
                set tenant_id  = cast(:new_tid as uuid),
                    category_id = cast(:new_cat as uuid),
                    updated_at = now()
                where id = cast(:qid as uuid)
                  and tenant_id = cast(:old_tid as uuid)
                """
            ),
            {
                "new_tid": target_tid,
                "new_cat": new_cat_id,
                "qid": str(qid),
                "old_tid": str(default_tid),
            },
        )

        # Cascade tenant_id to child rows that participate in composite FKs
        conn.execute(
            sa.text(
                """
                update assessment_question_options
                set tenant_id = cast(:new_tid as uuid),
                    updated_at = now()
                where question_id = cast(:qid as uuid)
                  and tenant_id = cast(:old_tid as uuid)
                """
            ),
            {"new_tid": target_tid, "qid": str(qid), "old_tid": str(default_tid)},
        )
        conn.execute(
            sa.text(
                """
                update assessment_classification_job_items
                set tenant_id = cast(:new_tid as uuid),
                    updated_at = now()
                where question_id = cast(:qid as uuid)
                  and tenant_id = cast(:old_tid as uuid)
                """
            ),
            {"new_tid": target_tid, "qid": str(qid), "old_tid": str(default_tid)},
        )

        moved += 1

    # ------------------------------------------------------------------
    # Data hygiene: ensure composite relations are consistent before recreating FKs.
    # ------------------------------------------------------------------
    # 1) Questions with category_id that doesn't exist in the same tenant → set NULL.
    conn.execute(
        sa.text(
            """
            update assessment_questions q
            set category_id = null,
                updated_at = now()
            where q.category_id is not null
              and not exists (
                select 1
                from assessment_categories c
                where c.id = q.category_id
                  and c.tenant_id = q.tenant_id
              )
            """
        )
    )

    # 2) Align child rows tenant_id to their question tenant_id.
    conn.execute(
        sa.text(
            """
            update assessment_question_options o
            set tenant_id = q.tenant_id,
                updated_at = now()
            from assessment_questions q
            where o.question_id = q.id
              and o.tenant_id <> q.tenant_id
            """
        )
    )
    conn.execute(
        sa.text(
            """
            update assessment_classification_job_items ji
            set tenant_id = q.tenant_id,
                updated_at = now()
            from assessment_questions q
            where ji.question_id = q.id
              and ji.tenant_id <> q.tenant_id
            """
        )
    )

    # 3) Null out any test-version question references that don't match composite key.
    conn.execute(
        sa.text(
            """
            update assessment_test_version_questions tvq
            set question_id = null,
                updated_at = now()
            where tvq.question_id is not null
              and not exists (
                select 1
                from assessment_questions q
                where q.id = tvq.question_id
                  and q.tenant_id = tvq.tenant_id
              )
            """
        )
    )

    print(f"0044: moved {moved} question(s); skipped {skipped} (ambiguous mapping)")

    # ------------------------------------------------------------------
    # Recreate composite FK constraints.
    # ------------------------------------------------------------------
    op.create_foreign_key(
        "fk_assessment_questions_tenant_category",
        "assessment_questions",
        "assessment_categories",
        ["tenant_id", "category_id"],
        ["tenant_id", "id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_assessment_question_options_tenant_question",
        "assessment_question_options",
        "assessment_questions",
        ["tenant_id", "question_id"],
        ["tenant_id", "id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_assessment_test_version_questions_tenant_question",
        "assessment_test_version_questions",
        "assessment_questions",
        ["tenant_id", "question_id"],
        ["tenant_id", "id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_assessment_classification_job_items_tenant_question",
        "assessment_classification_job_items",
        "assessment_questions",
        ["tenant_id", "question_id"],
        ["tenant_id", "id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    # Data migration – not safely reversible
    pass

