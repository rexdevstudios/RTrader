@echo off
title Omnichain Deployer - Telegram Token Agent Bot Launcher
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
echo   [+] OMNICHAIN TELEGRAM AGENT BOT LAUNCHER (GRAMMY) [+]
echo ===============================================================================
echo.
echo   PILIH MODE OPERASIONAL BOT:
echo.
echo   [1] [MULTI-BOT SUPERVISOR] (Rekomendasi Utama Multi-Koin)
echo       Jalankan SEMUA bot dedicated koin yang sudah didaftarkan sekaligus!
echo       Setiap CA berjalan dengan bot Telegramnya masing-masing secara bersamaan.
echo.
echo   [2] [SINGLE DEDICATED BOT] (Khusus 1 Koin Tertentu)
echo       Jalankan bot dengan persona spesifik untuk 1 token yang Anda pilih.
echo       Anda dapat memasukkan / memperbarui Token Bot @BotFather koin tersebut.
echo.
echo   [3] [MASTER FLEET BOT] (1 Bot Portofolio / Launchpad)
echo       1 Bot agregator untuk melayani seluruh koin armada (/fleet, /ca, dll).
echo.
echo   [4] [BOT POOL MANAGER] (Cadangan Token Bot Pre-Provisioned)
echo       Kelola antrean token bot @BotFather untuk alokasi otomatis tanpa prompt.
echo.
echo   [5] [WEBHOOK FAST-PATH] (Mode Server VPS / Cloud Latensi Rendah <100ms)
echo       Jalankan Master Fleet Bot dalam mode Native Bun Webhook Server.
echo.
echo   [6] Kembali
echo.
echo ===============================================================================
set /p bot_mode="Pilihan Anda [1-6]: "

if "%bot_mode%"=="1" (
    cls
    echo ===============================================================================
    echo   [+] MENJALANKAN MULTI-BOT DEDICATED SUPERVISOR [+]
    echo ===============================================================================
    echo.
    echo   Memulai Multi-Bot Supervisor... (Membaca seluruh bot koin aktif di vault)
    echo -------------------------------------------------------------------------------
    echo.
    call bun run src/modules/telegram/token-agent-bot.ts --supervisor
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%bot_mode%"=="2" (
    cls
    echo ===============================================================================
    echo   [+] DEDICATED TOKEN BOT - PILIH KOIN TARGET [+]
    echo ===============================================================================
    echo.
    call bun run scripts/execute-catalyst-trading.ts list
    echo.
    set /p targetToken="Masukkan nomor indeks token atau CA (Tekan Enter untuk token terbaru): "
    echo.
    set /p customKey="Masukkan Token Bot @BotFather (Tekan Enter jika sudah pernah disetel): "
    echo.
    echo [INFO] Menyiapkan bot untuk token target...
    echo -------------------------------------------------------------------------------
    echo.
    if not "%customKey%"=="" (
        call bun run src/modules/telegram/token-agent-bot.ts "%targetToken%" "%customKey%"
    ) else (
        call bun run src/modules/telegram/token-agent-bot.ts "%targetToken%"
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%bot_mode%"=="3" (
    cls
    echo ===============================================================================
    echo   [+] MENJALANKAN MASTER FLEET TELEGRAM BOT [+]
    echo ===============================================================================
    echo.
    echo   Memulai Master Fleet Bot... (Pastikan TELEGRAM_BOT_TOKEN terisi di .env)
    echo -------------------------------------------------------------------------------
    echo.
    call bun run src/modules/telegram/token-agent-bot.ts --fleet
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%bot_mode%"=="4" (
    cls
    echo ===============================================================================
    echo   [+] PENGELOLA CADANGAN BOT TELEGRAM (BOT POOL) [+]
    echo ===============================================================================
    echo.
    call bun run scripts/manage-telegram-pool.ts
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%bot_mode%"=="5" (
    cls
    echo ===============================================================================
    echo   [+] MENJALANKAN BOT TELEGRAM FAST-PATH WEBHOOK (NATIVE BUN HTTP) [+]
    echo ===============================================================================
    echo.
    echo   Memulai Fast-Path Webhook Server di port 8443 / TELEGRAM_WEBHOOK_PORT...
    echo -------------------------------------------------------------------------------
    echo.
    call bun run src/modules/telegram/token-agent-bot.ts --fleet --webhook
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

exit /b 0
