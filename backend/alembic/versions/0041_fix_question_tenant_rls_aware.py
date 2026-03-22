"""Fix questions owned by phantom tenant – RLS-aware version.

Migration 0040 completed but found 0 rows because the SELECT was executed
without setting app.tenant_id, so PostgreSQL RLS blocked all assessment_*
rows.

This migration explicitly sets app.tenant_id to each phantom tenant's ID
before querying/updating its rows, then restores the context afterward.
Foreign-key constraint checks bypass RLS internally, so updating the parent
table (assessment_questions) first is sufficient for subsequent FK checks on
child tables to pass.

A phantom tenant is one that exists in the tenants table but has no rows in
tenant_memberships (i.e. a seeding / development tenant with no real users).

Revision ID: 0041_fix_question_tenant_rls_aware
Revises: 0040_fix_question_tenant_via_testversion
"""

from alembic import op
import sqlalchemy as sa

revision = '0041_fix_question_tenant_rls_aware'
down_revision = '0040_fix_question_tenant_via_testversion'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Superseded by 0043 (FK-safe + category remap). Keep as no-op so existing
    # environments with 0040 applied can still migrate forward linearly.
    print("0041: no-op (superseded by 0043_fix_assessment_phantom_questions_fk_safe)")
    return

    # Find phantom tenants (no memberships = no real users)
    # tenant_memberships is not protected by assessment RLS, so this works.
    phantom_rows = conn.execute(sa.text("""
        SELECT t.id::text AS tenant_id
        FROM   tenants t
        WHERE  NOT EXISTS (
                   SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id = t.id
               )
    """)).fetchall()

    phantom_tenant_ids = [r[0] for r in phantom_rows]

    if not phantom_tenant_ids:
        print("0041: no phantom tenants found – nothing to do")
        return

    print(f"0041: found {len(phantom_tenant_ids)} phantom tenant(s): {phantom_tenant_ids}")

    total_fixed = 0

    for phantom_tid in phantom_tenant_ids:
        # Adopt the phantom tenant's RLS context so its rows are visible
        conn.execute(sa.text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": phantom_tid})

        # Find all questions owned by this phantom that are referenced by
        # test versions belonging to real tenants
        pairs = conn.execute(sa.text("""
            SELECT DISTINCT ON (aq.id)
                   aq.id::text         AS question_id,
                   atv.tenant_id::text AS correct_tenant
            FROM   assessment_questions              aq
            JOIN   assessment_test_version_questions tvq ON tvq.question_id = aq.id
            JOIN   assessment_test_versions          atv ON atv.id          = tvq.test_version_id
            WHERE  aq.tenant_id  = :phantom::uuid
              AND  atv.tenant_id != :phantom::uuid
              AND  EXISTS (
                       SELECT 1 FROM tenant_memberships tm
                       WHERE  tm.tenant_id = atv.tenant_id
                   )
            ORDER BY aq.id, atv.updated_at DESC NULLS LAST
        """), {"phantom": phantom_tid}).fetchall()

        if not pairs:
            print(f"0041: phantom {phantom_tid} – no mismatched questions found")
            continue

        print(f"0041: phantom {phantom_tid} – reassigning {len(pairs)} question(s)")

        for row in pairs:
            qid = str(row[0])
            real_tid = str(row[1])

            # Update parent first: assessment_questions
            # (FK checks on child tables verify the new (real_tid, qid) pair
            # exists here; FK enforcement bypasses RLS so this passes)
            conn.execute(
                sa.text(
                    "UPDATE assessment_questions "
                    "SET tenant_id = :real, updated_at = now() "
                    "WHERE id = :qid"
                ),
                {"real": real_tid, "qid": qid},
            )
            # Cascade to options
            conn.execute(
                sa.text(
                    "UPDATE assessment_question_options "
                    "SET tenant_id = :real "
                    "WHERE question_id = :qid AND tenant_id = :old"
                ),
                {"real": real_tid, "qid": qid, "old": phantom_tid},
            )
            # Cascade to classification job items
            conn.execute(
                sa.text(
                    "UPDATE assessment_classification_job_items "
                    "SET tenant_id = :real "
                    "WHERE question_id = :qid AND tenant_id = :old"
                ),
                {"real": real_tid, "qid": qid, "old": phantom_tid},
            )
            total_fixed += 1

    # Clear the RLS context when done
    conn.execute(sa.text("SELECT set_config('app.tenant_id', '', true)"))
    print(f"0041: done – fixed {total_fixed} question(s) total")


def downgrade() -> None:
    # Data migration – not safely reversible
    pass
