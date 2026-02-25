#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
DROP_SCRIPT = ROOT / 'database' / 'sql' / '910_drop_dev_only.sql'


def main() -> int:
    parser = argparse.ArgumentParser(description='Reset development database using SQL drop script.')
    parser.add_argument('--yes', action='store_true', help='Required to execute destructive reset.')
    args = parser.parse_args()

    if not args.yes:
        raise SystemExit('Refusing to reset database. Re-run with --yes to confirm destructive action.')

    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        raise SystemExit('DATABASE_URL is required.')

    sql_text = DROP_SCRIPT.read_text(encoding='utf-8')

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql_text)
        connection.commit()

    print('Development database reset completed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
