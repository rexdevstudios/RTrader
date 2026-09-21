@echo off
title Omnichain Service Daemon Setup - Windows Task Scheduler
chcp 65001 >nul
cd /d "%~dp0"

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\bun;%PATH%"

echo ===============================================================================
echo     [+] REGISTRASI BACKGROUND SERVICE DAEMON (WINDOWS TASK SCHEDULER) [+]
echo ===============================================================================
echo.
echo   [1] Daftarkan Webhook Fast-Track Daemon (Auto-Start saat Login)
echo   [2] Copot Webhook Fast-Track Daemon
echo   [3] Daftarkan Flywheel Harvester Worker Daemon (Auto-Start saat Login)
echo   [4] Copot Flywheel Harvester Worker Daemon
echo   [5] Periksa Status Service
echo   [Q] Keluar
echo.
echo ===============================================================================
set /p opt="Pilih tindakan [1-5 / Q]: "

if "%opt%"=="1" (
    bun run scripts/setup-service-daemon.ts --service=webhook --action=install
    pause
    goto end
)
if "%opt%"=="2" (
    bun run scripts/setup-service-daemon.ts --service=webhook --action=uninstall
    pause
    goto end
)
if "%opt%"=="3" (
    bun run scripts/setup-service-daemon.ts --service=flywheel --action=install
    pause
    goto end
)
if "%opt%"=="4" (
    bun run scripts/setup-service-daemon.ts --service=flywheel --action=uninstall
    pause
    goto end
)
if "%opt%"=="5" (
    bun run scripts/setup-service-daemon.ts --service=webhook --action=status
    pause
    goto end
)

:end
exit /b 0
