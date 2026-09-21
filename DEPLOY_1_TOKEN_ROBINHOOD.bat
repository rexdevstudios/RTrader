@echo off
setlocal enabledelayedexpansion
title Omnichain Deployer - Deploy 1 Token ke Robinhood Chain L2

cls
echo ===============================================================================
echo   [+] DEPLOY 1 TOKEN KE ROBINHOOD CHAIN L2 (Bankr API) [+]
echo ===============================================================================
echo.
echo   Skrip ini akan:
echo   1. Membuat identitas token viral via AI (Gemini / ByteDance)
echo   2. Generate logo AI dan upload ke IPFS
echo   3. Deploy token ke Robinhood Chain L2 via Bankr API
echo   4. Verifikasi transaksi on-chain di explorer
echo   5. Mencatat semua hasil ke database vault lokal
echo.
echo   Chain   : Robinhood Chain L2 (Chain ID: 4663)
echo   Provider: Bankr Token Launch API
echo   Gas     : Advisory (tidak ada gas sponsorship seperti Base)
echo.
echo ===============================================================================
echo.

:: Check .env
if not exist ".env" (
    echo [ERROR] File .env tidak ditemukan!
    echo         Jalankan SET_BANKR_KEY.bat terlebih dahulu.
    pause
    exit /b 1
)

:: Check BANKR_API_KEY
findstr /i "BANKR_API_KEY" .env | findstr /v "^#" | findstr /v "=$" >nul 2>&1
if errorlevel 1 (
    echo [WARN] BANKR_API_KEY kosong di .env.
    echo        Pastikan kunci Bankr sudah dikonfigurasi via SET_BANKR_KEY.bat
    echo.
    pause
)

echo [INFO] Memulai deployment ke Robinhood Chain L2...
echo.

:: Optional: --skip-simulation-probe flag
set "EXTRA_FLAGS="
if "%1"=="--skip-simulation-probe" set "EXTRA_FLAGS=--skip-simulation-probe"
if "%1"=="-ssp" set "EXTRA_FLAGS=--skip-simulation-probe"

bun run scripts/execute-single-robinhood-deployment.ts %EXTRA_FLAGS%

echo.
if errorlevel 1 (
    echo ===============================================================================
    echo   [GAGAL] Deployment ke Robinhood Chain L2 gagal.
    echo   Periksa log di atas untuk detail error.
    echo ===============================================================================
) else (
    echo ===============================================================================
    echo   [SELESAI] Deployment ke Robinhood Chain L2 berhasil!
    echo   Buka GeckoTerminal Robinhood untuk memantau pool.
    echo   Gunakan CATALYST_SWAP.bat untuk manajemen posisi.
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
