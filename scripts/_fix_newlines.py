#!/usr/bin/env python3
"""Normalize selected text files to UTF-8 with LF endings.

Usage:
  python scripts/_fix_newlines.py <file1> <file2> ...
"""

from __future__ import annotations

from pathlib import Path
import sys


def normalize_file(path: Path) -> None:
    text = path.read_text(encoding='utf-8')
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    if not text.endswith('\n'):
        text += '\n'
    path.write_text(text, encoding='utf-8', newline='\n')


def main() -> int:
    if len(sys.argv) < 2:
        print('Provide at least one file path.')
        return 1

    for raw in sys.argv[1:]:
        file_path = Path(raw)
        if not file_path.exists():
            print(f'Skipping missing file: {file_path}')
            continue
        normalize_file(file_path)
        print(f'Normalized: {file_path}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
