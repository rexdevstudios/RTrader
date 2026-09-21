@echo off
title Omnichain Deployer - Pengaturan & Validasi Bankr API Key
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

:menu
cls
echo ===============================================================================
echo   [+] PENGATURAN & VALIDASI BANKR API KEY INTERAKTIF [+]
echo ===============================================================================
echo.
echo   PILIH AKSI:
echo   [1] Audit Status & Cek Saldo Kunci Saat Ini (Real-Time Preflight)
echo   [2] Masukkan / Ganti Kunci Utama (BANKR_API_KEY di .env)
echo   [3] Daftarkan Akun Bankr Baru (Akun 2, Akun 3, dst.)
echo   [4] Beralih Akun Aktif (Switch Active Account)
echo   [5] Tampilkan Semua Akun Terdaftar di Database Vault
echo   [6] Kembali
echo.
echo ===============================================================================
set /p k_choice="Masukkan pilihan [1-6]: "

if "%k_choice%"=="1" (
    cls
    call bun run scripts/manage-bankr-key.ts check
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%k_choice%"=="2" (
    cls
    call bun run scripts/manage-bankr-key.ts set
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%k_choice%"=="3" (
    cls
    call bun run scripts/manage-bankr-key.ts add
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%k_choice%"=="4" (
    cls
    call bun run scripts/manage-bankr-key.ts switch
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%k_choice%"=="5" (
    cls
    call bun run scripts/manage-bankr-key.ts list
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

exit /b 0
