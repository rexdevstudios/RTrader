@echo off
title Omnichain Deployer - Deploy 1 Token ke Solana Pump.fun
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
echo     [+] OMNICHAIN MEME DEPLOYER - DEPLOY 1 TOKEN KE SOLANA PUMP.FUN [+]
echo ===============================================================================
echo.
echo   Skrip ini akan mengeksekusi 1 peluncuran token meme ke Solana via Pump.fun.
echo.
echo   PILIH MODE EKSEKUSI:
echo   [1] Mode Simulasi Aman (Gratis Rp 0 / Tanpa Mengurangi Saldo SOL)
echo   [2] Mode Sesuai Konfigurasi .env (Jika mainnet, membutuhkan ~0.025 SOL)
echo.
set /p s_choice="Masukkan pilihan Anda [1/2]: "

set "SOL_SIM_FLAG="
if "%s_choice%"=="1" (
    set "SOL_SIM_FLAG=--simulate"
) else if "%s_choice%"=="2" (
    echo.
    set /p confirm="Apakah Anda yakin ingin melanjutkan peluncuran LIVE? (Y/N): "
    if /i not "!confirm!"=="Y" (
        echo [INFO] Peluncuran dibatalkan.
        pause
        exit /b 0
    )
    set "SOL_SIM_FLAG="
) else (
    echo [ERROR] Pilihan tidak valid.
    pause
    exit /b 1
)

echo.
echo   PILIH WALLET FEE-PAYER SOLANA:
echo   -----------------------------------------------------------------------------
echo   [1] Default Master Wallet (4znm13... - Terpusat)
echo   [2] Sub-Wallet #1 (Bebas Cluster 0%% / Rekomendasi)
echo   [3] Sub-Wallet #2 (Bebas Cluster 0%%)
echo   [4] Masukkan ID Wallet / Pubkey Kustom
echo   -----------------------------------------------------------------------------
set /p sw_choice="Pilihan [1-4, default=1]: "
if "%sw_choice%"=="" set "sw_choice=1"

set "SOL_WALLET_FLAG="
if "%sw_choice%"=="1" (
    set "SOL_WALLET_FLAG="
) else if "%sw_choice%"=="2" (
    set "SOL_WALLET_FLAG=--wallet=1"
) else if "%sw_choice%"=="3" (
    set "SOL_WALLET_FLAG=--wallet=2"
) else if "%sw_choice%"=="4" (
    set /p custom_sw="Masukkan ID / Pubkey Wallet: "
    set "SOL_WALLET_FLAG=--wallet=!custom_sw!"
)

echo.
echo [INFO] Menjalankan peluncuran Solana...
call bun run scripts/execute-single-solana-deployment.ts %SOL_SIM_FLAG% %SOL_WALLET_FLAG%

echo.
echo ===============================================================================
echo   Apakah Anda ingin langsung membuat Website Web3 untuk token ini?
echo   [1] Ya, Terbitkan Website Web3 (Pilih Kategori: AI / DeFi / Gaming / Meme)
echo   [2] Selesai / Keluar
echo ===============================================================================
set /p gen_web="Pilihan [1-2, default=2]: "
if "%gen_web%"=="1" (
    call GENERATE_WEBSITE.bat
)
exit /b 0
