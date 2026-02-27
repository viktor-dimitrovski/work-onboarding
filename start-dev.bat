@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
  echo [ERROR] Virtual environment not found.
  echo Run setup-and-start.bat first.
  exit /b 1
)

if not exist "backend\.env" (
  echo [ERROR] backend\.env not found.
  echo Run setup-and-start.bat first.
  exit /b 1
)

echo [INFO] Running migrations...
call .venv\Scripts\activate.bat
pushd backend
alembic upgrade head
if errorlevel 1 (
  popd
  echo [ERROR] Migration failed.
  exit /b 1
)
popd

echo [INFO] Starting backend and frontend...
start "Onboarding Backend" cmd /k "cd /d %CD%\backend && call ..\.venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"
start "Onboarding Frontend" cmd /k "cd /d %CD%\frontend && npm run dev"

echo [OK] Started.
exit /b 0
