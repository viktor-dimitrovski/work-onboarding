#!/usr/bin/env python3
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / 'backend'
FRONTEND_DIR = ROOT / 'frontend'


def spawn_processes() -> list[subprocess.Popen]:
    backend_env = os.environ.copy()
    frontend_env = os.environ.copy()

    backend_cmd = [
        sys.executable,
        '-m',
        'uvicorn',
        'app.main:app',
        '--host',
        '0.0.0.0',
        '--port',
        '8001',
        '--reload',
    ]
    frontend_cmd = ['npm', 'run', 'dev']

    backend = subprocess.Popen(backend_cmd, cwd=str(BACKEND_DIR), env=backend_env)
    frontend = subprocess.Popen(frontend_cmd, cwd=str(FRONTEND_DIR), env=frontend_env)
    return [backend, frontend]


def terminate_processes(processes: list[subprocess.Popen]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()

    time.sleep(1)
    for process in processes:
        if process.poll() is None:
            process.kill()


def main() -> int:
    processes = spawn_processes()

    def handle_signal(_sig: int, _frame: object) -> None:
        terminate_processes(processes)
        raise SystemExit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    while True:
        for process in processes:
            if process.poll() is not None:
                terminate_processes(processes)
                return process.returncode or 0
        time.sleep(0.5)


if __name__ == '__main__':
    raise SystemExit(main())
