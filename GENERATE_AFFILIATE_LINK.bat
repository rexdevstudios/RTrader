@echo off
title On-Chain Affiliate ^& Referral Bounty Generator (5% WETH)
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
echo     [+] OMNICHAIN MEME DEPLOYER - GENERATOR LINK REFERRAL (5%% WETH) [+]
echo ===============================================================================
echo.
echo   Setiap pembelian yang melalui link referral Anda akan membagikan 5%% WETH
echo   dari akumulasi swap fee langsung ke dompet Anda!
echo.
echo ===============================================================================
set /p aff_addr="Masukkan Alamat Dompet Anda (Contoh: 0x1234...): "
if "%aff_addr%"=="" (
    echo.
    echo [ERROR] Alamat dompet promotor tidak boleh kosong.
    echo.
    pause
    exit /b 1
)

set /p custom_ca_ref="Masukkan CA Token (Tekan ENTER untuk pakai token Base terbaru): "
echo.
echo [INFO] Menghasilkan Link Referral ^& Template Promosi...
echo.

if "%custom_ca_ref%"=="" (
    call bun run scripts/generate-affiliate-link.ts %aff_addr%
) else (
    call bun run scripts/generate-affiliate-link.ts %aff_addr% %custom_ca_ref%
)

echo.
echo ===============================================================================
echo   Proses selesai. Tekan tombol apa saja untuk menutup...
echo ===============================================================================
pause >nul
