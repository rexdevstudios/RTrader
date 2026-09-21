@echo off
title Omnichain Deployer - Simulasi Testnet (Gratis Rp 0)
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
echo     [+] OMNICHAIN MEME DEPLOYER - SIMULASI TESTNET (GRATIS RP 0) [+]
echo ===============================================================================
echo.

call bun run scripts/simulate-option-a.ts

echo.
echo ===============================================================================
echo   Simulasi selesai. Tekan tombol apa saja untuk menutup jendela ini...
echo ===============================================================================
pause >nul
