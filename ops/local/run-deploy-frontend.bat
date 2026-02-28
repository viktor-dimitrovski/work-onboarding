@echo off
setlocal

set "GITBASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo [ERR] Git Bash not found at "%GITBASH%".
  echo       Install Git for Windows, or edit ops\local\run-deploy-frontend.bat to point to bash.exe
  exit /b 1
)

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"
set "REPO_ROOT=%REPO_ROOT:\=/%"

"%GITBASH%" -lc "cd \"%REPO_ROOT%\" && bash ops/local/deploy-frontend.sh --env ops/ops.env %*"

pause
