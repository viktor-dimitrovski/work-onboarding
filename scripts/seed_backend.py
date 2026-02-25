#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = ROOT / 'database' / 'sql'


SQL_SEQUENCE = [
    '000_extensions.sql',
    '010_schema.sql',
    '020_seed_reference.sql',
    '030_seed_demo.sql',
    '040_views.sql',
    '050_functions.sql',
]


def run_script(connection: psycopg.Connection, script_name: str) -> None:
    script_path = SQL_DIR / script_name
    sql_text = script_path.read_text(encoding='utf-8')
    with connection.cursor() as cursor:
        cursor.execute(sql_text)



def main() -> int:
    parser = argparse.ArgumentParser(description='Apply SQL schema and seed scripts.')
    parser.add_argument('--skip-demo', action='store_true', help='Skip demo seed data script (030_seed_demo.sql).')
    args = parser.parse_args()

    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        raise SystemExit('DATABASE_URL is required to run seed scripts.')

    scripts = [script for script in SQL_SEQUENCE if not (args.skip_demo and script == '030_seed_demo.sql')]

    with psycopg.connect(database_url) as connection:
        connection.autocommit = False
        for script in scripts:
            print(f'Applying {script}...')
            run_script(connection, script)
        connection.commit()

    print('Schema/seed scripts applied successfully.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
