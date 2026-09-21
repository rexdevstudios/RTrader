@echo off
title Omnichain Deployer - Local Web3 Website Live Previewer
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
echo     [+] OMNICHAIN MEME DEPLOYER - LOCAL WEB3 WEBSITE LIVE PREVIEWER [+]
echo ===============================================================================
echo.
call bun run scripts/preview-website.ts %*
echo.
echo -------------------------------------------------------------------------------
echo   Selesai. Tekan tombol apa saja untuk keluar...
pause >nul
exit /b 0
