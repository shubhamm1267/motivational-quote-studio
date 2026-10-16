@echo off
setlocal
cd /d "%~dp0"
echo.
echo ======================================
echo  Motivational Quote Studio v5.4 Setup
 echo ======================================
echo.
echo Setup will use Corepack/pnpm first to avoid npm edgesOut dependency errors.
echo.
call npm run setup
if errorlevel 1 (
  echo.
  echo Setup failed. Copy the last 30-40 terminal lines and share them for diagnosis.
  echo Try: corepack --version
  echo Try: node -v
  pause
  exit /b 1
)
echo.
echo Setup completed successfully.
echo Next: npm run dev
echo.
pause
