"""Reassign all phantom-tenant questions directly to the real tenant.

Previous migrations (0040, 0041) tried to discover the correct tenant via a
JOIN to assessment_test_versions, but that JOIN is also blocked by RLS when
app.tenant_id is set to the phantom tenant (real-tenant versions become
invisible).

Simpler approach that avoids any cross-tenant join:
  1. Identify phantom tenants (no tenant_memberships rows).
  2. Identify the single real tenant (has memberships).
  3. Set app.tenant_id = phantom_tid so the phantom's rows are RLS-visible.
  4. UPDATE assessment_questions / options / job_items to the real tenant.

This is safe when there is exactly one real tenant (the common dev/staging
scenario where phantom data was created by seeding scripts).

Revision ID: 0042_fix_phantom_questions_direct
Revises: 0041_fix_question_tenant_rls_aware
"""

from alembic import op
import sqlalchemy as sa

revision = '0042_fix_phantom_questions_direct'
down_revision = '0041_fix_question_tenant_rls_aware'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Superseded by 0043 (FK-safe + category remap). Keep as no-op so existing
    # environments can migrate forward linearly without risking FK violations.
    print("0042: no-op (superseded by 0043_fix_assessment_phantom_questions_fk_safe)")
    return

    # ── 1. Find real tenants (have at least one membership) ──────────────────
    real_rows = conn.execute(sa.text("""
        SELECT DISTINCT tm.tenant_id::text
        FROM   tenant_memberships tm
    """)).fetchall()
    real_tenant_ids = [r[0] for r in real_rows]

    if not real_tenant_ids:
        print("0042: no real tenants found – nothing to do")
        return

    if len(real_tenant_ids) > 1:
        print(f"0042: multiple real tenants found ({real_tenant_ids}), skipping – manual intervention needed")
        return

    real_tid = real_tenant_ids[0]
    print(f"0042: real tenant = {real_tid}")

    # ── 2. Find phantom tenants (no memberships) ─────────────────────────────
    phantom_rows = conn.execute(sa.text("""
        SELECT t.id::text
        FROM   tenants t
        WHERE  NOT EXISTS (
                   SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id = t.id
               )
    """)).fetchall()
    phantom_ids = [r[0] for r in phantom_rows]

    if not phantom_ids:
        print("0042: no phantom tenants found – nothing to do")
        return

    print(f"0042: phantom tenants = {phantom_ids}")

    total_fixed = 0

    for phantom_tid in phantom_ids:
        if phantom_tid == real_tid:
            continue

        # Adopt phantom's RLS context so its question rows are visible
        conn.execute(sa.text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": phantom_tid})

        # Count questions to be moved
        count_row = conn.execute(sa.text(
            "SELECT COUNT(*) FROM assessment_questions WHERE tenant_id = :tid::uuid"
        ), {"tid": phantom_tid}).fetchone()
        count = count_row[0] if count_row else 0

        if count == 0:
            print(f"0042: phantom {phantom_tid} – 0 questions, skipping")
            continue

        print(f"0042: phantom {phantom_tid} – moving {count} question(s) to {real_tid}")

        # Update parent first (FK checks on children bypass RLS)
        conn.execute(sa.text(
            "UPDATE assessment_questions "
            "SET    tenant_id = :real::uuid, updated_at = now() "
            "WHERE  tenant_id = :phantom::uuid"
        ), {"real": real_tid, "phantom": phantom_tid})

        # Cascade to options
        conn.execute(sa.text(
            "UPDATE assessment_question_options "
            "SET    tenant_id = :real::uuid "
            "WHERE  tenant_id = :phantom::uuid"
        ), {"real": real_tid, "phantom": phantom_tid})

        # Cascade to classification job items
        conn.execute(sa.text(
            "UPDATE assessment_classification_job_items "
            "SET    tenant_id = :real::uuid "
            "WHERE  tenant_id = :phantom::uuid"
        ), {"real": real_tid, "phantom": phantom_tid})

        total_fixed += count

    # Clear the RLS context
    conn.execute(sa.text("SELECT set_config('app.tenant_id', '', true)"))
    print(f"0042: done – moved {total_fixed} question(s) total")


def downgrade() -> None:
    pass
