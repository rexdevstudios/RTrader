@echo off
title Deploy Token - Mode Flywheel Growth Engine
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
echo     [+] OMNICHAIN MEME DEPLOYER - DEPLOY TOKEN MODE FLYWHEEL [+]
echo ===============================================================================
echo.
echo   Mode ini akan meluncurkan 1 token baru ke Base Mainnet dengan fitur:
echo   - 100%% Gas Sponsored (0.0 ETH Operator Cost)
echo   - 0%% Token Tax (Skor 100/100 Safe di DexScreener/Photon)
echo   - 30%% Auto Buyback ^& Burn Floor Protection
echo   - 20%% Passive WETH Dividends untuk Top Holders
echo   - 15%% 10-Minute FOMO Jackpot Pool
echo   - Kartu Promosi Komunitas Alpha Otomatis
echo.
echo   PILIH MODE PELUNCURAN:
echo   [1] Mode Simulasi Testnet (Gratis Rp 0 / Aman Tanpa Gas)
echo   [2] Mode Base Mainnet Langsung (100%% Gas Sponsored via Bankr)
echo   [3] Batal / Keluar
echo.
echo ===============================================================================
set /p fw_choice="Masukkan angka pilihan Anda [1-3]: "

if "%fw_choice%"=="1" (
    echo.
    echo [INFO] Menjalankan Simulasi Deployment Flywheel di Testnet...
    echo.
    call bun run flywheel:simulate
) else if "%fw_choice%"=="2" (
    echo.
    echo [INFO] Menjalankan Deployment Flywheel ke Base Mainnet...
    echo.
    call bun run flywheel:deploy
) else (
    echo.
    echo [INFO] Operasi dibatalkan.
    ping -n 2 127.0.0.1 >nul
    exit /b 0
)
echo.
echo ===============================================================================
echo   Proses selesai. Tekan tombol apa saja untuk keluar...
echo ===============================================================================
pause >nul
