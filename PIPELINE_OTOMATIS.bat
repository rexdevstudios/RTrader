@echo off
title Pipeline Otomatis Terpadu — Deploy To Profit
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
echo.
echo ===============================================================================
echo   [+] PIPELINE OTOMATIS TERPADU — HULU KE HILIR [+]
echo   Deploy - Beli Katalyst (~$1) - Monitor - Auto Take-Profit
echo ===============================================================================
echo.
echo   ── PIPELINE UTAMA ───────────────────────────────────────────────────────
echo.
echo   [1]  [PIPELINE INTERAKTIF] Deploy Baru -> Beli Katalyst ~$1 -> Monitor
echo                              (Dengan konfirmasi/opsi manual)
echo.
echo   [2]  [100%% FULL OTONOM]    Zero-Prompt Unattended Mode (Rekomendasi)
echo                              Deploy -> Auto Bot Pool -> Sync -> Buy -> Monitor
echo.
echo   [3]  [BELI + MONITOR]      Token Sudah Live? Langsung Beli ~$1 + Auto-TP
echo                              (Pilih dari armada token yang sudah deploy)
echo.
echo   [4]  [MONITOR SAJA]        Posisi Sudah Dibeli? Pantau + Auto Take-Profit
echo                              (Cocok untuk resume setelah restart)
echo.
echo   ── STATUS ^& KONTROL ─────────────────────────────────────────────────────
echo.
echo   [5]  [STATUS]              Dashboard Armada ^& Status Token Multi-Chain
echo   [6]  [KELOLA BOT POOL]     Cadangan Token Bot Telegram (@BotFather)
echo   [7]  [MENU LANJUTAN]       Semua Fitur (Wallet, Flywheel, Booster, dll)
echo   [8]  [KELUAR]              Keluar
echo.
echo ===============================================================================
set /p pilihan="Masukkan pilihan [1-8]: "

if "%pilihan%"=="1" goto pipeline_penuh
if "%pilihan%"=="2" goto pipeline_otonom
if "%pilihan%"=="3" goto beli_monitor
if "%pilihan%"=="4" goto monitor_saja
if "%pilihan%"=="5" goto status
if "%pilihan%"=="6" goto bot_pool
if "%pilihan%"=="7" goto menu_lanjutan
if "%pilihan%"=="8" goto keluar

echo.
echo [!] Pilihan tidak valid. Silakan coba lagi.
ping -n 2 127.0.0.1 >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:pipeline_penuh
cls
echo ===============================================================================
echo   [PIPELINE PENUH] Deploy Baru -> Beli Katalyst ~$1 -> Monitor -> Auto-TP
echo ===============================================================================
echo.
echo   Alur yang akan dijalankan secara otomatis:
echo.
echo   [Langkah 0/5]  Pilih / Validasi Akun Bankr (Multi-Account Aware)
echo   [Langkah 1/5]  Deploy token baru ke Base Mainnet (gas 100%% disponsori relayer)
echo   [Langkah 2/5]  Daftarkan Proyek ke Bankr API lengkap dengan Tim Inti ^& Produk Nyata
echo   [Langkah 3/5]  Siapkan Karakter Agen ^& Bot Telegram Interaktif (GrammY)
echo   [Langkah 4/5]  Beli katalyst ~$1.00 (aktifkan candle chart DexScreener)
echo   [Langkah 5/5]  Monitor live harga + auto take-profit saat 1.5x (+50%%)
echo.
echo   Modal yang dibutuhkan: ~$1.50 - $2.00 ETH di wallet operator (untuk buy)
echo   Biaya gas deploy    : $0.00 (100%% disponsori Bankr relayer)
echo.
set /p confirm="Lanjutkan Pipeline Penuh? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo.
    echo [INFO] Pipeline dibatalkan.
    ping -n 2 127.0.0.1 >nul
    goto menu
)

set "EXTRA_FLAGS="
set /p skip_probe="Bypass dry simulation probe jika gateway AWS WAF 403? (Y/N, default=N): "
if /i "%skip_probe%"=="Y" (
    set "EXTRA_FLAGS=--skip-simulation-probe"
    echo [INFO] Opsi --skip-simulation-probe diaktifkan.
)

echo.
echo [INFO] Memulai Pipeline Penuh...
echo -------------------------------------------------------------------------------
echo.
bun run scripts/launch-full-pipeline.ts full %EXTRA_FLAGS%
echo.
echo ===============================================================================
echo   Pipeline selesai atau monitor dihentikan.
echo ===============================================================================
echo.
echo   Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:pipeline_otonom
cls
echo ===============================================================================
echo   [100%% FULL OTONOM] Zero-Prompt Unattended Autonomous Pipeline
echo ===============================================================================
echo.
echo   Eksekusi 100%% OTONOM tanpa interupsi keyboard manusia:
echo.
echo   - Resolusi wallet otomatis (Multi-Account Bankr aware)
echo   - Deploy Base Mainnet (100%% gas disponsori relayer)
echo   - Alokasi bot Telegram otomatis dari pool cadangan (tanpa prompt manual)
echo   - Sinkronisasi profil proyek di Bankr API (Tim ^& Produk + Link Bot)
echo   - Beli katalyst ~$1.00 untuk menyalakan grafik DexScreener
echo   - Live monitor + Auto Take-Profit 1.5x (+50%%)
echo.
echo   Memulai eksekusi unattended...
echo -------------------------------------------------------------------------------
echo.
bun run scripts/launch-full-pipeline.ts full --unattended
echo.
echo ===============================================================================
echo   Pipeline otonom selesai atau dihentikan.
echo ===============================================================================
echo.
echo   Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:beli_monitor
cls
echo ===============================================================================
echo   [BELI + MONITOR] Pilih Token Live -> Beli Katalyst ~$1 -> Auto Take-Profit
echo ===============================================================================
echo.
echo   Gunakan ini jika token sudah deploy tapi belum ada posisi beli.
echo   Bot akan menampilkan daftar token live, meminta pilihan,
echo   lalu langsung beli ~$1 dan mulai monitor otomatis.
echo.
echo [INFO] Memulai mode Beli + Monitor...
echo -------------------------------------------------------------------------------
echo.
bun run scripts/launch-full-pipeline.ts catalyst
echo.
echo ===============================================================================
echo   Mode Beli + Monitor selesai atau dihentikan.
echo ===============================================================================
echo.
echo   Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:monitor_saja
cls
echo ===============================================================================
echo   [MONITOR SAJA] Resume Monitor Posisi Aktif -> Auto Take-Profit
echo ===============================================================================
echo.
echo   Gunakan ini untuk melanjutkan monitor setelah restart, atau jika
echo   posisi sudah terdaftar di vault tetapi monitor belum berjalan.
echo.
echo [INFO] Memulai mode Monitor Saja...
echo -------------------------------------------------------------------------------
echo.
bun run scripts/launch-full-pipeline.ts monitor
echo.
echo ===============================================================================
echo   Monitor dihentikan.
echo ===============================================================================
echo.
echo   Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:status
cls
echo ===============================================================================
echo   [STATUS] Dashboard Armada ^& Monitoring Multi-Chain
echo ===============================================================================
echo.
call bun run status
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:bot_pool
cls
echo ===============================================================================
echo   [KELOLA BOT POOL] Cadangan Token Bot Telegram (@BotFather)
echo ===============================================================================
echo.
call bun run scripts/manage-telegram-pool.ts
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:menu_lanjutan
cls
echo [INFO] Membuka Menu Lengkap...
call MENU_UTAMA.bat
goto menu

:: ─────────────────────────────────────────────────────────────────────────────
:keluar
cls
echo ===============================================================================
echo   Terima kasih! Untuk mode otomatis 24/7 gunakan: START_BOT_AUTOPILOT.bat
echo ===============================================================================
echo.
ping -n 2 127.0.0.1 >nul
exit /b 0
