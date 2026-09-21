@echo off
title Omnichain Deployer - Hub Eksekusi Rekomendasi Base L2
chcp 65001 >nul
cd /d "%~dp0"

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%LOCALAPPDATA%\Programs\bun;%PATH%"

:menu_rekomendasi
cls
echo ===============================================================================
echo     [+] HUB AKSI REKOMENDASI TERPADU (EKOSISTEM BASE L2) [+]
echo ===============================================================================
echo.
echo   Fokus Aktif: Jaringan Base L2 (EVM) — Volume Aktif & Biaya Gas Terjangkau
echo   Status Solana: DITAHAN (ON HOLD) demi efisiensi modal ($0 SOL keluar)
echo.
echo   PILIH AKSI REKOMENDASI UNTUK DIEKSEKUSI:
echo   -----------------------------------------------------------------------------
echo   [1] 🚀 Selesaikan Profil GeckoTerminal $PUMPRUN (Buka Form + Teks Otomatis)
echo          -> Menghapus penalti "Info: 0" & mendongkrak skor kepercayaan (Rp 0)
echo.
echo   [2] 🪙 Deploy Token #2 ($CLANKAI via Clanker v4 di Base)
echo          -> Pilihan Simulasi Rp 0 / Live Broadcast (~0.000042 ETH)
echo          -> Royalti 100%% mengalir ke Sub-Wallet #1 (Bebas Cluster Dev)
echo.
echo   [3] 🔄 Pantau Kas & Jalankan Flywheel Harvester 95%% WETH
echo          -> Memanen royalti dari pool Doppler Uniswap v4 & buyback/burn
echo.
echo   [4] 🔍 Audit Pendanaan Bersih Sub-Wallet & Panduan CEX
echo          -> Memeriksa saldo on-chain & panduan transfer bebas cluster
echo.
echo   [5] ↩  Buka Menu Utama BOT
echo   [0] ❌ Keluar
echo   -----------------------------------------------------------------------------
set /p r_choice="Masukkan pilihan Anda [0-5, default=1]: "
if "%r_choice%"=="" set "r_choice=1"

if "%r_choice%"=="1" (
    cls
    echo [INFO] Membuka formulir pengajuan GeckoTerminal ^& Basescan...
    call bun run scripts/submit-geckoterminal-ticket.ts
    echo.
    pause
    goto menu_rekomendasi
)

if "%r_choice%"=="2" (
    call DEPLOY_1_TOKEN_CLANKER.bat
    goto menu_rekomendasi
)

if "%r_choice%"=="3" (
    call START_FLYWHEEL_WORKER.bat
    goto menu_rekomendasi
)

if "%r_choice%"=="4" (
    cls
    echo [INFO] Menjalankan audit pendanaan bersih sub-wallet...
    call bun run scripts/audit-clean-funding.ts
    echo.
    pause
    goto menu_rekomendasi
)

if "%r_choice%"=="5" (
    call MENU_UTAMA.bat
    exit /b 0
)

if "%r_choice%"=="0" (
    echo [INFO] Selesai. Menutup launcher.
    exit /b 0
)

echo [ERROR] Pilihan tidak valid.
pause
goto menu_rekomendasi
