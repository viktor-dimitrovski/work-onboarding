@echo off
setlocal

cd /d "%~dp0"

set "PG_HOST=localhost"
set "PG_PORT=5432"
set "PG_SUPERUSER=postgres"

if not "%~1"=="" set "PG_SUPERUSER=%~1"
if not "%~2"=="" set "PG_HOST=%~2"
if not "%~3"=="" set "PG_PORT=%~3"

where psql >nul 2>nul
if errorlevel 1 (
  echo [ERROR] psql not found in PATH.
  echo Install PostgreSQL client tools and re-run.
  exit /b 1
)

echo.
echo [INFO] Running local Postgres bootstrap...
echo        superuser: %PG_SUPERUSER%
echo        host:      %PG_HOST%
echo        port:      %PG_PORT%

echo.
echo If prompted, enter password for superuser "%PG_SUPERUSER%".

psql -v ON_ERROR_STOP=1 -h "%PG_HOST%" -p "%PG_PORT%" -U "%PG_SUPERUSER%" -d postgres -f "scripts\create_local_postgres.sql"
if errorlevel 1 (
  echo.
  echo [ERROR] Database bootstrap failed.
  exit /b 1
)

echo.
echo [OK] Database bootstrap completed.
echo Use this DATABASE_URL in backend\.env:
echo DATABASE_URL=postgresql+psycopg://onboarding_app:onboarding_app_dev_password@localhost:5432/onboarding

echo.
echo Next step: run setup-and-start.bat

exit /b 0
