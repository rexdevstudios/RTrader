@echo off
setlocal enabledelayedexpansion
title Omnichain Deployer - Deploy 1 Token via Clanker v4 (Base Mainnet)

cls
echo ===============================================================================
echo   [+] DEPLOY 1 TOKEN VIA CLANKER v4 (BASE MAINNET - ON-CHAIN) [+]
echo ===============================================================================
echo.
echo   Skrip ini akan:
echo   1. Membuat identitas token viral via AI (Gemini / ByteDance)
echo   2. Generate logo AI dan upload ke IPFS
echo   3. Deploy token via Clanker v4 Factory (Base Mainnet, on-chain)
echo   4. Verifikasi transaksi di Basescan
echo   5. Mencatat semua hasil ke database vault lokal
echo.
echo   Chain    : Base Mainnet (Chain ID: 8453)
echo   Provider : Clanker v4 Factory (0xE85A59c628F7d27878ACeB4bf3b35733630083a9)
echo   Gas      : OPERATOR BAYAR SENDIRI (~0.00003-0.00005 ETH, ~$0.10)
echo   API Key  : TIDAK DIPERLUKAN (Interaksi On-Chain Langsung)
echo.
echo   [!] Pastikan wallet EVM_PRIVATE_KEY memiliki >= 0.0004 ETH di Base Mainnet.
echo       Gunakan CATALYST_SWAP.bat [7] untuk Wrap ETH ke WETH jika diperlukan.
echo.
echo ===============================================================================
echo.

:: Check .env
if not exist ".env" (
    echo [ERROR] File .env tidak ditemukan!
    echo         Salin .env.example ke .env dan isi konfigurasi minimal.
    pause
    exit /b 1
)

:: Check EVM_PRIVATE_KEY
findstr /i "EVM_PRIVATE_KEY" .env | findstr /v "^#" | findstr /v "=$" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] EVM_PRIVATE_KEY belum diisi di .env!
    echo         Isi private key EVM wallet yang memiliki saldo >= 0.0004 ETH di Base.
    echo.
    pause
    exit /b 1
)

:: Check if command line flag was provided
if not "%1"=="" (
    set "EXTRA_FLAGS="
    if "%1"=="--dry-run" set "EXTRA_FLAGS=--dry-run"
    if "%1"=="-d" set "EXTRA_FLAGS=--dry-run"
    if "%1"=="--skip-balance-check" set "EXTRA_FLAGS=--skip-balance-check"
    goto execute_deploy
)

:menu_select
echo   PILIH MODE EKSEKUSI CLANKER v4:
echo   -----------------------------------------------------------------------------
echo   [1] Mode Simulasi Aman (Dry-Run / Tanpa Broadcast On-Chain)
echo   [2] Mode Live Broadcast ke Base Mainnet (Estimasi gas ~0.000042 ETH)
echo   [3] Periksa Status Kesiapan Saldo Base ^& Solana
echo   [4] Batal / Kembali
echo   -----------------------------------------------------------------------------
set /p c_choice="Pilihan [1-4, default=1]: "
if "%c_choice%"=="" set "c_choice=1"

if "%c_choice%"=="1" (
    set "EXTRA_FLAGS=--dry-run"
    goto select_wallet
)
if "%c_choice%"=="2" (
    echo.
    echo   PERINGATAN: ANDA AKAN MELUNCURKAN TOKEN SECARA LIVE KE BASE MAINNET!
    echo   Transaksi on-chain akan disiarkan ke Clanker v4 Factory.
    echo   Estimasi biaya gas: ~0.000042 ETH (Saldo operator Base minimal 0.0004 ETH).
    echo.
    set /p confirm_live="Ketik Y untuk konfirmasi broadcast live [Y/N]: "
    if /i not "!confirm_live!"=="Y" (
        echo [INFO] Peluncuran live dibatalkan.
        goto menu_select
    )
    set "EXTRA_FLAGS="
    goto select_wallet
)
if "%c_choice%"=="3" (
    echo.
    echo [INFO] Memeriksa saldo operator...
    call bun run scripts/verify-dual-chain.ts
    echo.
    pause
    cls
    goto menu_select
)
if "%c_choice%"=="4" (
    echo [INFO] Dibatalkan oleh pengguna.
    exit /b 0
)
echo [Peringatan] Pilihan tidak valid.
goto menu_select

:select_wallet
echo.
echo   PILIH WALLET DEPLOYER CLANKER v4:
echo   -----------------------------------------------------------------------------
echo   [1] Sub-Wallet #1 (0xf39d... - Bebas Cluster 0%% / REKOMENDASI ANTI-CLUSTER)
echo   [2] Sub-Wallet #2 (0x5b59... - Bebas Cluster 0%%)
echo   [3] Default Operator Wallet (0x9466... - Terpusat)
echo   [4] Masukkan ID Wallet / Alamat Kustom
echo   -----------------------------------------------------------------------------
set /p w_choice="Pilihan Deployer [1-4, default=1]: "
if "%w_choice%"=="" set "w_choice=1"

set "WALLET_FLAG="
if "%w_choice%"=="1" (
    set "WALLET_FLAG=--wallet=1"
) else if "%w_choice%"=="2" (
    set "WALLET_FLAG=--wallet=2"
) else if "%w_choice%"=="3" (
    set "WALLET_FLAG="
) else if "%w_choice%"=="4" (
    set /p custom_w="Masukkan ID / Alamat Wallet: "
    set "WALLET_FLAG=--wallet=!custom_w!"
) else (
    set "WALLET_FLAG=--wallet=1"
)

:execute_deploy
echo.
echo [INFO] Memulai deployment via Clanker v4...
echo.

bun run scripts/execute-single-clanker-deployment.ts %EXTRA_FLAGS% %WALLET_FLAG%

echo.
if errorlevel 1 (
    echo ===============================================================================
    echo   [GAGAL] Deployment via Clanker v4 gagal.
    echo   Periksa log di atas untuk detail error.
    echo   Tips: Pastikan saldo ETH >= 0.0004 ETH di Base Mainnet.
    echo ===============================================================================
) else (
    echo ===============================================================================
    echo   [SELESAI] Deployment via Clanker v4 berhasil!
    echo   Buka https://www.clanker.world untuk melihat token Anda.
    echo   Gunakan CATALYST_SWAP.bat untuk manajemen posisi dan trading.
    echo ===============================================================================
    echo.
    echo   Apakah Anda ingin langsung membuat Website Web3 untuk token ini?
    echo   [1] Ya, Terbitkan Website Web3 (Pilih Kategori: AI / DeFi / Gaming / Meme)
    echo   [2] Selesai / Tutup
    echo ===============================================================================
    set /p gen_web="Pilihan [1-2, default=2]: "
    if "!gen_web!"=="1" (
        call GENERATE_WEBSITE.bat
    )
)

echo.
pause
