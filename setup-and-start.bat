@echo off
setlocal

cd /d "%~dp0"

echo [INFO] Starting local setup for onboarding platform...

echo [STEP] Checking required tools...
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found in PATH.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [STEP] Creating Python virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment.
    exit /b 1
  )
)

echo [STEP] Installing backend dependencies...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
if errorlevel 1 (
  echo [ERROR] Failed to upgrade pip.
  exit /b 1
)

pip install -r backend\requirements.txt
if errorlevel 1 (
  echo [ERROR] Failed to install backend requirements.
  exit /b 1
)

echo [STEP] Installing frontend dependencies...
if not exist "frontend\node_modules" (
  pushd frontend
  npm install
  if errorlevel 1 (
    popd
    echo [ERROR] Failed to install frontend dependencies.
    exit /b 1
  )
  popd
)

if not exist "backend\.env" (
  echo [STEP] Creating backend\.env from example...
  copy /Y "backend\.env.example" "backend\.env" >nul
)

if not exist "frontend\.env.local" (
  echo [STEP] Creating frontend\.env.local from example...
  copy /Y "frontend\.env.example" "frontend\.env.local" >nul
)

echo [STEP] Running migrations...
pushd backend
alembic upgrade head
if errorlevel 1 (
  popd
  echo [ERROR] Alembic migration failed.
  echo Ensure backend\.env has a valid PostgreSQL DATABASE_URL.
  exit /b 1
)
popd

echo.
echo [INFO] Launching backend and frontend in separate windows...
start "Onboarding Backend" cmd /k "cd /d %CD%\backend && call ..\.venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
start "Onboarding Frontend" cmd /k "cd /d %CD%\frontend && npm run dev"

echo.
echo [OK] Startup commands launched.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:8000
echo API docs: http://localhost:8000/api/v1/docs

exit /b 0
