#!/usr/bin/env python3
"""
One-off helper to repair legacy demo users created with reserved/special-use domains
that strict EmailStr validation rejects (e.g. *.local, *.test).

This script is intentionally conservative:
- It prints what it would change by default.
- It only applies changes when --apply is provided.
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass

import psycopg


RESERVED_DOMAINS = ("internal.local", "local.test")
EMAIL_SHAPE_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@dataclass(frozen=True)
class UserRow:
    id: str
    email: str


def _normalize_domain(domain: str) -> str:
    value = domain.strip().lower()
    if not value or "." not in value or value.startswith(".") or value.endswith("."):
        raise ValueError("Invalid --to-domain value")
    if value in RESERVED_DOMAINS or value.split(".")[-1] in {"local", "test"}:
        raise ValueError("Refusing to rewrite to a reserved/special-use domain")
    return value


def _build_new_email(old_email: str, *, to_domain: str) -> str:
    local_part = old_email.split("@", 1)[0].strip()
    candidate = f"{local_part}@{to_domain}"
    if not EMAIL_SHAPE_RE.match(candidate):
        raise ValueError(f"Refusing to write invalid email: {candidate}")
    return candidate.lower()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fix legacy users with reserved email domains (e.g. internal.local) by rewriting to a real domain."
    )
    parser.add_argument(
        "--to-domain",
        default="example.com",
        help="Target domain to rewrite to (default: example.com). Use your real company domain for production.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes (default is dry-run).",
    )
    args = parser.parse_args()

    to_domain = _normalize_domain(args.to_domain)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    with psycopg.connect(database_url) as conn:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, email
                FROM users
                WHERE lower(split_part(email, '@', 2)) = ANY(%s)
                ORDER BY created_at DESC
                """,
                (list(RESERVED_DOMAINS),),
            )
            rows = [UserRow(id=row[0], email=row[1]) for row in cur.fetchall()]

            if not rows:
                print("No users found with reserved domains.")
                return 0

            print("Users with reserved domains:")
            for row in rows:
                print(f"- {row.id}  {row.email}")

            planned: list[tuple[UserRow, str]] = []
            for row in rows:
                planned.append((row, _build_new_email(row.email, to_domain=to_domain)))

            print("\nPlanned rewrites:")
            for row, new_email in planned:
                print(f"- {row.email} -> {new_email}")

            if not args.apply:
                print("\nDry-run only. Re-run with --apply to write changes.")
                return 0

            updated = 0
            skipped = 0
            for row, new_email in planned:
                cur.execute(
                    "SELECT 1 FROM users WHERE email = %s AND id::text <> %s LIMIT 1",
                    (new_email, row.id),
                )
                if cur.fetchone():
                    print(f"[SKIP] {row.email} -> {new_email} (target email already exists)")
                    skipped += 1
                    continue

                cur.execute(
                    "UPDATE users SET email = %s, updated_at = NOW() WHERE id::text = %s",
                    (new_email, row.id),
                )
                updated += int(cur.rowcount or 0)

            conn.commit()

            print(f"\nDone. Updated: {updated}. Skipped: {skipped}.")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())

