"""Fix assessment_questions rows that have the wrong tenant_id.

During early development the AI import / classification service created
questions while the session tenant context was not set correctly, leaving
some rows with tenant_id belonging to a phantom seeding tenant instead of
the real tenant that owns the test / question bank.

Strategy
--------
1. Questions referenced by assessment_test_version_questions whose
   test-version tenant differs from the question's own tenant are the
   clearest signal: the question "belongs" to whichever tenant asked for it
   in a test.  Reassign those.

2. Questions referenced by assessment_question_options or
   assessment_classification_job_items with a mismatched tenant are likewise
   corrected.

3. Orphaned questions (not referenced by any test version) whose tenant_id
   is the known phantom seeding tenant get reassigned to the single real
   tenant (if there is exactly one).  This is safe because the phantom tenant
   is never logged in.

We only reassign if there is exactly one candidate correct tenant per
question to avoid ambiguity.

Revision ID: 0039_fix_question_tenant
Revises: 0038_question_perf_indexes
"""

from alembic import op
import sqlalchemy as sa

revision = '0039_fix_question_tenant'
down_revision = '0038_question_perf_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── Step 1: reassign questions that are referenced by test version
    # questions from a different tenant. ──────────────────────────────
    conn.execute(sa.text("""
        UPDATE assessment_questions aq
        SET    tenant_id  = correct.correct_tenant,
               updated_at = now()
        FROM (
            -- For each question_id, pick the tenant used by its test versions.
            -- Only reassign when every test version that references this question
            -- belongs to the same single tenant (cnt = 1), so the reassignment
            -- is unambiguous.
            SELECT  q.question_id,
                    q.correct_tenant
            FROM (
                SELECT  tvq.question_id,
                        tvq.tenant_id AS correct_tenant
                FROM    assessment_test_version_questions tvq
                WHERE   tvq.question_id IS NOT NULL
                GROUP BY tvq.question_id, tvq.tenant_id
            ) q
            JOIN (
                SELECT  question_id,
                        count(*) AS cnt          -- count of distinct tenants per question
                FROM (
                    SELECT  tvq.question_id,
                            tvq.tenant_id
                    FROM    assessment_test_version_questions tvq
                    WHERE   tvq.question_id IS NOT NULL
                    GROUP BY tvq.question_id, tvq.tenant_id
                ) uniq
                GROUP BY question_id
            ) counts USING (question_id)
            WHERE counts.cnt = 1
        ) correct
        WHERE  aq.id          = correct.question_id
          AND  aq.tenant_id  <> correct.correct_tenant
    """))

    # ── Step 2: update assessment_question_options to match their question's
    # (now corrected) tenant_id. ─────────────────────────────────────────────
    conn.execute(sa.text("""
        UPDATE assessment_question_options aqo
        SET    tenant_id  = aq.tenant_id,
               updated_at = now()
        FROM   assessment_questions aq
        WHERE  aqo.question_id = aq.id
          AND  aqo.tenant_id  <> aq.tenant_id
    """))

    # ── Step 3: update classification job items similarly. ───────────────────
    conn.execute(sa.text("""
        UPDATE assessment_classification_job_items ji
        SET    tenant_id  = aq.tenant_id,
               updated_at = now()
        FROM   assessment_questions aq
        WHERE  ji.question_id = aq.id
          AND  ji.tenant_id  <> aq.tenant_id
    """))


def downgrade() -> None:
    # No safe downgrade — tenant reassignments are not reversible without
    # preserving the original mapping.
    pass
