@echo off
title Omnichain Deployer - Pencadangan Database Vault
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
echo     [+] OMNICHAIN MEME DEPLOYER - PENCADANGAN & SYNC DATABASE VAULT [+]
echo ===============================================================================
echo.
echo   PILIH MODE OPERASI DATABASE:
echo   [1] Snapshot Backup SQLite Lokal (.eliza/backups/)
echo   [2] Sinkronisasi Armada ke Cloud Neon PostgreSQL (Multi-Tenant per Token)
echo   [3] Periksa Status & Query Database Token di Cloud Neon
echo   [4] Kembali ke Menu Utama
echo.
set /p dbchoice="Pilihan [1-4, default=1]: "
if "%dbchoice%"=="" set dbchoice=1

if "%dbchoice%"=="1" (
    echo.
    call bun run scripts/backup-vault.ts
    echo.
    echo -------------------------------------------------------------------------------
    echo   Pencadangan SQLite lokal selesai. Tekan tombol apa saja...
    pause >nul
    exit /b 0
)

if "%dbchoice%"=="2" (
    cls
    call bun run scripts/manage-neon-db.ts sync
    echo.
    echo -------------------------------------------------------------------------------
    echo   Sinkronisasi Neon Cloud selesai. Tekan tombol apa saja...
    pause >nul
    exit /b 0
)

if "%dbchoice%"=="3" (
    cls
    call bun run scripts/manage-neon-db.ts
    echo.
    set /p tkquery="Masukkan ticker koin yang ingin diperiksa (Enter untuk lewati): "
    if not "%tkquery%"=="" (
        echo.
        call bun run scripts/manage-neon-db.ts query %tkquery%
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk keluar...
    pause >nul
    exit /b 0
)

exit /b 0
