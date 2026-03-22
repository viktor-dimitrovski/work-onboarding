"""Fix questions still owned by phantom tenant, using test-version ownership.

Migration 0039 used assessment_test_version_questions.tenant_id to identify
the 'correct' tenant.  That didn't work for questions whose TVQ rows also had
the phantom tenant_id (set before the service was patched).

This migration uses assessment_test_versions.tenant_id (the parent version
record, set correctly from the HTTP request context) to identify the real
tenant for each mismatched question.

RLS is active on all assessment_* tables.  We handle it by temporarily
setting app.tenant_id to the phantom tenant's ID for each UPDATE block,
then restoring it.  Foreign-key constraint checks bypass RLS internally,
so updating the parent table (assessment_questions) first is sufficient for
subsequent FK checks on child tables to pass.

Revision ID: 0040_fix_question_tenant_via_testversion
Revises: 0039_fix_question_tenant
"""

from alembic import op
import sqlalchemy as sa

revision = '0040_fix_question_tenant_via_testversion'
down_revision = '0039_fix_question_tenant'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # Discover phantom tenants: tenants that have NO tenant_memberships.
    # We iterate over them so we can set app.tenant_id for RLS visibility.
    # ------------------------------------------------------------------
    phantom_rows = conn.execute(sa.text("""
        SELECT t.id AS tenant_id
        FROM   tenants t
        WHERE  NOT EXISTS (
                   SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id = t.id
               )
    """)).fetchall()

    phantom_tenant_ids = [str(r[0]) for r in phantom_rows]

    if not phantom_tenant_ids:
        print("0040: no phantom tenants found – nothing to do")
        return

    print(f"0040: found {len(phantom_tenant_ids)} phantom tenant(s): {phantom_tenant_ids}")

    total_fixed = 0

    for phantom_tid in phantom_tenant_ids:
        # Adopt this phantom's RLS context so we can query its rows
        conn.execute(sa.text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": phantom_tid})

        # Find which questions (owned by this phantom) are referenced by
        # test versions belonging to real tenants
        pairs = conn.execute(sa.text("""
            SELECT DISTINCT ON (aq.id)
                   aq.id            AS question_id,
                   atv.tenant_id    AS correct_tenant
            FROM   assessment_questions              aq
            JOIN   assessment_test_version_questions tvq ON tvq.question_id = aq.id
            JOIN   assessment_test_versions          atv ON atv.id          = tvq.test_version_id
            WHERE  aq.tenant_id  = :phantom
              AND  atv.tenant_id != :phantom
              AND  EXISTS (
                       SELECT 1 FROM tenant_memberships tm
                       WHERE  tm.tenant_id = atv.tenant_id
                   )
            ORDER BY aq.id, atv.updated_at DESC NULLS LAST
        """), {"phantom": phantom_tid}).fetchall()

        if not pairs:
            print(f"0040: phantom {phantom_tid} – no mismatched questions")
            continue

        print(f"0040: phantom {phantom_tid} – reassigning {len(pairs)} question(s)")

        for row in pairs:
            qid = str(row[0])
            real_tid = str(row[1])

            # Update parent first: FK checks on child tables verify the new
            # (real_tid, qid) pair against assessment_questions; this write
            # satisfies that check (FK enforcement bypasses RLS).
            conn.execute(
                sa.text("UPDATE assessment_questions SET tenant_id = :tid, updated_at = now() WHERE id = :qid"),
                {"tid": real_tid, "qid": qid},
            )
            conn.execute(
                sa.text(
                    "UPDATE assessment_question_options "
                    "SET tenant_id = :tid "
                    "WHERE question_id = :qid AND tenant_id = :old"
                ),
                {"tid": real_tid, "qid": qid, "old": phantom_tid},
            )
            conn.execute(
                sa.text(
                    "UPDATE assessment_classification_job_items "
                    "SET tenant_id = :tid "
                    "WHERE question_id = :qid AND tenant_id = :old"
                ),
                {"tid": real_tid, "qid": qid, "old": phantom_tid},
            )
            total_fixed += 1

    # Clear the RLS context when done
    conn.execute(sa.text("SELECT set_config('app.tenant_id', '', true)"))

    print(f"0040: done – fixed {total_fixed} question(s) total")


def downgrade() -> None:
    # Data migration – not safely reversible
    pass
