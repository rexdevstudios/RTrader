@echo off
title DexScreener Fast-Track Payment Webhook Daemon Service
chcp 65001 >nul
cd /d "%~dp0"

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\bun;%PATH%"

where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo ===============================================================================
    echo [ERROR] Runtime Bun tidak ditemukan di PATH!
    echo Silakan pastikan Bun sudah terpasang dari https://bun.sh
    echo ===============================================================================
    pause
    exit /b 1
)

echo ===============================================================================
echo     [+] DEXSCREENER FAST-TRACK WEBHOOK DAEMON SERVICE (PORT 3001) [+]
echo ===============================================================================
echo.
call bun run scripts/run-webhook-daemon.ts %*
echo.
echo -------------------------------------------------------------------------------
echo   Daemon berhenti. Tekan tombol apa saja untuk keluar...
pause >nul
exit /b 0
