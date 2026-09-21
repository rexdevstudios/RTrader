@echo off
title Omnichain Deployer - Autopilot Engine
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
cls
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - BOT AUTOPILOT ENGINE (CRON) [+]
echo ===============================================================================
echo.
echo   Bot akan memantau tren dan mengeksekusi siklus secara otomatis.
echo   Tekan CTRL + C kapan saja di jendela ini untuk menghentikan bot.
echo.

call bun run bot:start

echo.
echo ===============================================================================
echo   Bot terhenti. Tekan tombol apa saja untuk menutup...
echo ===============================================================================
pause >nul
