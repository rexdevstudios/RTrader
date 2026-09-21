@echo off
title Omnichain Deployer - 1-Click Custom Domain Setup
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
echo     [+] OMNICHAIN MEME DEPLOYER - 1-CLICK CUSTOM DOMAIN SETUP [+]
echo ===============================================================================
echo.
echo Panduan Cepat:
echo   Skrip ini secara otomatis mengonfigurasi DNS CNAME di Cloudflare dan
echo   mem-bind domain ke Cloudflare Pages atau Vercel via API resmi.
echo.
echo Penggunaan CLI opsional:
echo   SETUP_CUSTOM_DOMAIN.bat [TICKER] [DOMAIN] [--target=pages^|vercel]
echo   Contoh: SETUP_CUSTOM_DOMAIN.bat PUMPRUN dex.pumprun.xyz --target=pages
echo.
echo -------------------------------------------------------------------------------
echo.

call bun run scripts/setup-custom-domain.ts %*
echo.
echo -------------------------------------------------------------------------------
echo   Proses setup custom domain selesai. Tekan tombol apa saja untuk keluar...
pause >nul
exit /b 0
