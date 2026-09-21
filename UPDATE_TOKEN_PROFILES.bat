@echo off
title Omnichain Auto Viral Meme Deployer - Update Profil DexScreener & GeckoTerminal
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

:menu_profile
cls
echo ===============================================================================
echo   [+] UPDATE PROFIL DEXSCREENER & GECKOTERMINAL (OMNICHAIN) [+]
echo ===============================================================================
echo.
echo   Solusi untuk:
echo   - Mengaktifkan ikon sosial (Website, Telegram, Twitter, Discord) di DexScreener
echo   - Memperbaiki penalti "Info: 0" dan mendongkrak GT Security Score di GeckoTerminal
echo   - Menghasilkan form pendaftaran resmi untuk Base, Solana, Robinhood, & Arc
echo.
echo   [1] 🎯 Update Profil Token Live Terbaru ($PUMPRUN)
echo   [2] 🚀 Fast-Track Pengajuan Tiket GeckoTerminal & Basescan (Buka Form + Teks Otomatis)
echo   [3] 🔍 Update Profil Berdasarkan Ticker Koin (Input Manual)
echo   [4] 📋 Update Profil Berdasarkan Contract Address (CA)
echo   [5] 🌐 Update Seluruh Armada Token Terkonfirmasi (--all)
echo   [6] ↩ Kembali ke Menu Utama
echo.
echo ===============================================================================
set /p prof_choice="Pilih opsi [1-6]: "

if "%prof_choice%"=="1" goto update_latest
if "%prof_choice%"=="2" goto fast_track
if "%prof_choice%"=="3" goto update_ticker
if "%prof_choice%"=="4" goto update_ca
if "%prof_choice%"=="5" goto update_all
if "%prof_choice%"=="6" goto exit_profile
goto menu_profile

:fast_track
cls
echo [Membuka Formulir Pengajuan Resmi GeckoTerminal & Basescan]...
call bun run scripts/submit-geckoterminal-ticket.ts
echo.
pause
goto menu_profile

:update_latest
cls
echo [Menjalankan Sinkronisasi Profil Token Live Terbaru]...
call bun run scripts/update-token-profiles.ts
echo.
pause
goto menu_profile

:update_ticker
cls
echo ===============================================================================
echo   MASUKKAN TICKER TOKEN (Contoh: PUMPRUN, SOLREAL, AQM)
echo ===============================================================================
set /p custom_ticker="Ticker: "
if "%custom_ticker%"=="" goto menu_profile
call bun run scripts/update-token-profiles.ts --ticker=%custom_ticker%
echo.
pause
goto menu_profile

:update_ca
cls
echo ===============================================================================
echo   MASUKKAN CONTRACT ADDRESS (CA)
echo ===============================================================================
set /p custom_ca="Contract Address: "
if "%custom_ca%"=="" goto menu_profile
call bun run scripts/update-token-profiles.ts --ca=%custom_ca%
echo.
pause
goto menu_profile

:update_all
cls
echo [Menjalankan Sinkronisasi Seluruh Armada Token]...
call bun run scripts/update-token-profiles.ts --all
echo.
pause
goto menu_profile

:exit_profile
exit /b 0
