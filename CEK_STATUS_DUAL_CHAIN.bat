@echo off
title Omnichain Deployer - Dual-Chain Readiness Preflight Audit
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
echo   MEMERIKSA KESIAPAN LAUNCHPAD DUAL-CHAIN (BASE + SOLANA)...
echo ===============================================================================
echo.
call bun run scripts/verify-dual-chain.ts
echo.
echo -------------------------------------------------------------------------------
echo   Audit selesai. Tekan tombol apa saja untuk menutup...
pause >nul
exit /b 0
