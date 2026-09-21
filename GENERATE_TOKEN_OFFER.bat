@echo off
title Omnichain Deployer - Generator Penawaran ^& Promosi Viral
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
echo     [+] OMNICHAIN MEME DEPLOYER - VALUE PROPOSITION ^& PROMO DECK [+]
echo ===============================================================================
echo.
call bun run scripts/generate-token-offer.ts %* --save
echo.
echo -------------------------------------------------------------------------------
echo   Materi promosi telah disimpan ke folder promotions/.
echo   Tekan tombol apa saja untuk keluar...
pause >nul
exit /b 0
