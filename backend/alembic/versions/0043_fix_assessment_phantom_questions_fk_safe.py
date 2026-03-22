"""Fix assessment questions created under a phantom tenant (FK-safe).

Problem
-------
Some assessment questions were created while the DB session tenant context
was pointing at a seeding/phantom tenant. Those questions (and their related
rows) have tenant_id = phantom, but they are being used by a real tenant.

Because the assessment schema uses composite foreign keys
(tenant_id, question_id) → (tenant_id, id), we cannot update tenant_id in-place
while FK constraints are enforced (no ON UPDATE CASCADE and not DEFERRABLE).

Fix
---
1. Temporarily drop the FK constraints that involve (tenant_id, question_id)
   so we can update tenant_id consistently across parent + children.
2. Reassign questions from phantom tenants to the correct real tenant:
   - Prefer the created_by user's *unique* active tenant membership.
   - Otherwise, if there is exactly one real tenant in the DB, use it.
   - Otherwise, skip (ambiguous) and leave the row untouched.
3. Remap category_id by slug: map phantom category slug → target tenant category
   (creating the category if missing).
4. Update dependent rows (options + classification items). For phantom
   test-version question rows, null out question_id (phantom tenant is not used).
5. Recreate the dropped FK constraints.

RLS
---
This is an administrative data migration. We attempt to disable RLS for the
transaction with `SET LOCAL row_security = off` (works for table owners /
admin roles). If the DB role cannot bypass RLS, the migration will likely be
unable to see or update rows across tenants.

Revision ID: 0043_fix_assessment_phantom_questions_fk_safe
Revises: 0042_fix_phantom_questions_direct
"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa


revision = "0043_fix_assessment_phantom_questions_fk_safe"
down_revision = "0042_fix_phantom_questions_direct"
branch_labels = None
depends_on = None


def _drop_fk_if_exists(conn, table: str, constraint_name: str) -> None:
    conn.execute(sa.text(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS "{constraint_name}"'))


def _drop_all_fks_between(conn, table: str, referenced_table: str) -> None:
    """Drop all FK constraints on `table` that reference `referenced_table`."""
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
        print("0043: row_security=off")
    except Exception as e:  # noqa: BLE001
        print(f"0043: WARNING: could not SET LOCAL row_security=off ({e!r}); continuing")

    # ------------------------------------------------------------------
    # Identify phantom tenants (no active memberships) and real tenants.
    # ------------------------------------------------------------------
    real_rows = conn.execute(
        sa.text(
            """
            SELECT DISTINCT tm.tenant_id::text
            FROM tenant_memberships tm
            WHERE tm.status = 'active'
            """
        )
    ).fetchall()
    real_tenant_ids = [r[0] for r in real_rows]

    phantom_rows = conn.execute(
        sa.text(
            """
            SELECT t.id::text
            FROM tenants t
            WHERE NOT EXISTS (
                SELECT 1
                FROM tenant_memberships tm
                WHERE tm.tenant_id = t.id AND tm.status = 'active'
            )
            """
        )
    ).fetchall()
    phantom_tenant_ids = [r[0] for r in phantom_rows]

    if not phantom_tenant_ids:
        print("0043: no phantom tenants found – nothing to do")
        return

    # Only consider phantom tenants that actually own questions.
    phantom_with_questions: list[str] = []
    for tid in phantom_tenant_ids:
        cnt = conn.execute(
            sa.text("SELECT count(*) FROM assessment_questions WHERE tenant_id = :tid::uuid"),
            {"tid": tid},
        ).scalar()
        if int(cnt or 0) > 0:
            phantom_with_questions.append(tid)

    if not phantom_with_questions:
        print("0043: phantom tenants found, but none own assessment_questions – nothing to do")
        return

    print(f"0043: phantom tenant(s) with questions: {phantom_with_questions}")

    # Map user_id -> list of active tenant_ids (as text)
    user_tenants_rows = conn.execute(
        sa.text(
            """
            SELECT tm.user_id::text,
                   array_agg(DISTINCT tm.tenant_id::text) AS tenant_ids
            FROM tenant_memberships tm
            WHERE tm.status = 'active'
            GROUP BY tm.user_id
            """
        )
    ).fetchall()
    user_to_tenants: dict[str, list[str]] = {str(r[0]): list(r[1] or []) for r in user_tenants_rows}

    single_real_tenant: str | None = real_tenant_ids[0] if len(real_tenant_ids) == 1 else None
    if single_real_tenant:
        print(f"0043: single real tenant detected: {single_real_tenant}")
    else:
        print(f"0043: multiple real tenants detected: {real_tenant_ids} (will use created_by mapping)")

    # ------------------------------------------------------------------
    # Drop FK constraints that prevent (tenant_id, question_id) reassignment.
    # ------------------------------------------------------------------
    _drop_all_fks_between(conn, "assessment_questions", "assessment_categories")
    _drop_all_fks_between(conn, "assessment_question_options", "assessment_questions")
    _drop_all_fks_between(conn, "assessment_test_version_questions", "assessment_questions")
    _drop_all_fks_between(conn, "assessment_classification_job_items", "assessment_questions")

    moved = 0
    skipped = 0

    # Cache category maps per (phantom_tid, target_tid)
    phantom_cat_cache: dict[str, dict[str, tuple[str, str | None]]] = {}
    target_slug_to_cat_id: dict[str, dict[str, str]] = {}

    def _phantom_cat_map(phantom_tid: str) -> dict[str, tuple[str, str | None]]:
        # cat_id -> (slug, name)
        if phantom_tid in phantom_cat_cache:
            return phantom_cat_cache[phantom_tid]
        rows = conn.execute(
            sa.text(
                """
                SELECT id::text, slug::text, name::text
                FROM assessment_categories
                WHERE tenant_id = :tid::uuid
                """
            ),
            {"tid": phantom_tid},
        ).fetchall()
        m = {str(r[0]): (str(r[1]), (str(r[2]) if r[2] is not None else None)) for r in rows}
        phantom_cat_cache[phantom_tid] = m
        return m

    def _target_slug_map(target_tid: str) -> dict[str, str]:
        if target_tid in target_slug_to_cat_id:
            return target_slug_to_cat_id[target_tid]
        rows = conn.execute(
            sa.text(
                """
                SELECT id::text, slug::text
                FROM assessment_categories
                WHERE tenant_id = :tid::uuid
                """
            ),
            {"tid": target_tid},
        ).fetchall()
        m = {str(r[1]): str(r[0]) for r in rows if r[1] is not None and r[0] is not None}
        target_slug_to_cat_id[target_tid] = m
        return m

    # ------------------------------------------------------------------
    # Reassign questions tenant_id + remap category_id, then cascade children.
    # ------------------------------------------------------------------
    for phantom_tid in phantom_with_questions:
        q_rows = conn.execute(
            sa.text(
                """
                SELECT id::text,
                       created_by::text,
                       updated_by::text,
                       category_id::text
                FROM assessment_questions
                WHERE tenant_id = :tid::uuid
                """
            ),
            {"tid": phantom_tid},
        ).fetchall()

        if not q_rows:
            continue

        phantom_cats = _phantom_cat_map(phantom_tid)

        for qid, created_by, updated_by, old_cat_id in q_rows:
            target_tid: str | None = None

            if created_by and str(created_by) in user_to_tenants:
                tenants = user_to_tenants[str(created_by)]
                if len(tenants) == 1:
                    target_tid = tenants[0]
            if not target_tid and updated_by and str(updated_by) in user_to_tenants:
                tenants = user_to_tenants[str(updated_by)]
                if len(tenants) == 1:
                    target_tid = tenants[0]
            if not target_tid and single_real_tenant:
                target_tid = single_real_tenant

            if not target_tid or target_tid == phantom_tid:
                skipped += 1
                continue

            # Remap category_id by slug
            new_cat_id: str | None = None
            if old_cat_id:
                cat_info = phantom_cats.get(str(old_cat_id))
                if cat_info:
                    slug, name = cat_info
                    slug_map = _target_slug_map(target_tid)
                    if slug in slug_map:
                        new_cat_id = slug_map[slug]
                    else:
                        # Create category in target tenant (top-level)
                        new_id = str(uuid.uuid4())
                        conn.execute(
                            sa.text(
                                """
                                INSERT INTO assessment_categories (id, tenant_id, name, slug, parent_id)
                                VALUES (:id::uuid, :tenant_id::uuid, :name, :slug, NULL)
                                """
                            ),
                            {
                                "id": new_id,
                                "tenant_id": target_tid,
                                "name": name or slug.replace("-", " ").title(),
                                "slug": slug,
                            },
                        )
                        slug_map[slug] = new_id
                        new_cat_id = new_id

            # Move question
            conn.execute(
                sa.text(
                    """
                    UPDATE assessment_questions
                    SET tenant_id  = :new_tid::uuid,
                        category_id = :new_cat::uuid,
                        updated_at = now()
                    WHERE id = :qid::uuid
                      AND tenant_id = :old_tid::uuid
                    """
                ),
                {
                    "new_tid": target_tid,
                    "new_cat": new_cat_id,
                    "qid": str(qid),
                    "old_tid": phantom_tid,
                },
            )

            # Cascade child tables that use composite FK
            conn.execute(
                sa.text(
                    """
                    UPDATE assessment_question_options
                    SET tenant_id = :new_tid::uuid,
                        updated_at = now()
                    WHERE question_id = :qid::uuid
                      AND tenant_id = :old_tid::uuid
                    """
                ),
                {"new_tid": target_tid, "qid": str(qid), "old_tid": phantom_tid},
            )
            conn.execute(
                sa.text(
                    """
                    UPDATE assessment_classification_job_items
                    SET tenant_id = :new_tid::uuid,
                        updated_at = now()
                    WHERE question_id = :qid::uuid
                      AND tenant_id = :old_tid::uuid
                    """
                ),
                {"new_tid": target_tid, "qid": str(qid), "old_tid": phantom_tid},
            )

            # Phantom TVQ rows are not used; make them safe by nulling question_id
            conn.execute(
                sa.text(
                    """
                    UPDATE assessment_test_version_questions
                    SET question_id = NULL,
                        updated_at = now()
                    WHERE tenant_id = :old_tid::uuid
                      AND question_id = :qid::uuid
                    """
                ),
                {"old_tid": phantom_tid, "qid": str(qid)},
            )

            moved += 1

    print(f"0043: moved {moved} question(s); skipped {skipped} (ambiguous)")

    # ------------------------------------------------------------------
    # Recreate FK constraints.
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

