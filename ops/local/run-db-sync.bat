@echo off
setlocal
REM DB sync: local pg_dump -> upload to VPS -> remote restore.
REM Paths (VPS app dir, backup dir) are in ops/ops.env: OPS_REMOTE_APP_DIR, OPS_REMOTE_BACKUP_DIR.
REM Example: OPS_REMOTE_APP_DIR=/opt/apps/solvebox-hub, OPS_REMOTE_BACKUP_DIR=/var/backups/solvebox-hub/db

set "GITBASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo [ERR] Git Bash not found at "%GITBASH%".
  echo       Install Git for Windows, or edit ops\local\run-db-sync.bat to point to bash.exe
  exit /b 1
)

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "REPO_ROOT=%REPO_ROOT:\=/%"

"%GITBASH%" -lc "cd \"%REPO_ROOT%\" && bash ops/local/db-sync.sh --env ops/ops.env %*"

pause
