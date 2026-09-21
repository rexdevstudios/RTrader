@echo off
title Omnichain Deployer - Cloudflare Pages Lifecycle & LRU Garbage Collector
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

:menu_cleaner
cls
echo ===============================================================================
echo   [+] CLOUDFLARE PAGES LIFECYCLE & PROJECT GARBAGE COLLECTOR [+]
echo ===============================================================================
echo.
echo   Fungsi:
echo   1. Mengaudit total project Cloudflare Pages di akun Anda (Limit: 100).
echo   2. Memproteksi secara permanen seluruh token live on-chain.
echo   3. Membersihkan project sisa simulasi/test lama agar akun tidak mentok di 100.
echo.
echo   [1] 🔍 Audit Status Project Cloudflare Pages (Simulasi Aman / Dry-Run)
echo   [2] 🧹 Bersihkan Project Simulasi Usang (Live Deletion jika >= 85)
echo   [3] ↩ Kembali / Keluar
echo.
echo ===============================================================================
set /p opt_clean="Pilihan [1-3, default=1]: "
if "%opt_clean%"=="" set "opt_clean=1"

if "%opt_clean%"=="1" (
    echo.
    echo [INFO] Menjalankan audit simulasi Cloudflare Pages...
    call bun run scripts/clean-cloudflare-pages.ts --dry-run
    echo.
    pause
    goto menu_cleaner
)
if "%opt_clean%"=="2" (
    echo.
    echo [PERINGATAN] Anda akan membersihkan project simulasi lama yang melebihi ambang batas.
    echo Token live di mainnet tetap AMAN dan TIDAK AKAN DIHAPUS.
    set /p confirm_clean="Ketik Y untuk melanjutkan pembersihan [Y/N]: "
    if /i "!confirm_clean!"=="Y" (
        call bun run scripts/clean-cloudflare-pages.ts
    ) else (
        echo [INFO] Pembersihan dibatalkan.
    )
    echo.
    pause
    goto menu_cleaner
)
if "%opt_clean%"=="3" (
    exit /b 0
)

echo [Peringatan] Pilihan tidak valid.
pause
goto menu_cleaner
