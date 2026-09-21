@echo off
title Omnichain Deployer - Deploy 1 Token ke Base Mainnet
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
echo     [+] OMNICHAIN MEME DEPLOYER - DEPLOY 1 TOKEN KE BASE MAINNET [+]
echo ===============================================================================
echo.
echo   - Gas Deployment : 100%% Disponsori Relayer (Biaya Anda: 0.0 ETH)
echo   - Output         : Alamat Kontrak (CA) ^& Templat Telegram tercetak otomatis
echo.
set /p confirm="Ketik Y untuk melanjutkan atau N untuk membatalkan: "
if /i not "%confirm%"=="Y" (
    echo.
    echo [INFO] Deployment dibatalkan.
    pause
    exit /b 0
)

echo   Pilih Wallet Operator:
echo   - Tekan [ENTER] langsung untuk Auto Round-Robin / Default Operator
echo   - Atau ketik ID Wallet (contoh: sub-operator-1)
set /p opt_wallet="ID Wallet (opsional): "
set "WALLET_FLAG="
if not "%opt_wallet%"=="" (
    set "WALLET_FLAG=--wallet=%opt_wallet%"
)

set "EXTRA_FLAGS="
set /p skip_probe="Bypass dry simulation probe jika gateway AWS WAF 403? (Y/N, default=N): "
if /i "%skip_probe%"=="Y" (
    set "EXTRA_FLAGS=--skip-simulation-probe"
    echo [INFO] Flag --skip-simulation-probe aktif.
)

echo.
echo [INFO] Memulai proses deployment terarah ke Base Mainnet...
echo.

call bun run scripts/execute-single-base-deployment.ts %WALLET_FLAG% %EXTRA_FLAGS% %*

echo.
echo ===============================================================================
echo   [+] DEPLOYMENT BASE MAINNET SELESAI [+]
echo   Website DApp Edge & Profil DexScreener telah diterbitkan secara otomatis!
echo.
echo   Langkah Lanjutan Otomatis:
echo   [1] Nyalakan Volume Spark (3 Lilin Hijau & Unique Makers untuk Bot Sniper)
echo   [2] Mulai Live Monitor Harga & Auto Take-Profit (+50%)
echo   [3] Selesai / Tutup
echo ===============================================================================
set /p next_act="Pilihan [1-3, default=1]: "
if "%next_act%"=="" set "next_act=1"
if "%next_act%"=="1" (
    call START_TRENDING_BOOSTER.bat
)
if "%next_act%"=="2" (
    call bun run scripts/execute-catalyst-trading.ts monitor
)
exit /b 0
