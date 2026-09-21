@echo off
title Omnichain Deployer - Generator Akun Multi-Wallet (EVM ^& Solana)
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
echo     [+] OMNICHAIN MEME DEPLOYER - GENERATOR AKUN MULTI-WALLET [+]
echo ===============================================================================
echo.
echo   Alat ini akan menghasilkan dompet non-kustodial mandiri (EVM Base ^& Solana)
echo   lengkap dengan Private Key dan Public Address untuk disimpan aman:
echo   - Disimpan otomatis ke SQLite Vault lokal (.eliza/vault.db)
echo   - Diekspor ke format JSON dan Excel/CSV di folder wallets\
echo.
echo ===============================================================================
echo   PILIH JENIS RANTAI DOMPET:
echo   [1] EVM Multi-Wallet (Base L2, Ethereum, Arbitrum, BSC) - Format 0x...
echo   [2] Solana Multi-Wallet (Pump.fun, Raydium, Solscan) - Format Base58
echo   [3] Dual-Chain Pair (Setiap akun mendapat 1 EVM + 1 Solana sekaligus!)
echo   [4] Keluar
echo ===============================================================================
set /p c_type="Pilihan rantai Anda [1-4, default=1]: "
if "%c_type%"=="" set c_type=1

if "%c_type%"=="4" exit /b 0

set /p w_count="Berapa banyak wallet yang ingin di-generate? [Default: 5]: "
if "%w_count%"=="" set w_count=5

echo.
echo [INFO] Menghasilkan %w_count% akun dompet baru secara aman...
echo.

if "%c_type%"=="2" (
    call bun run scripts/generate-multi-wallets.ts --chain=solana --count=%w_count%
) else if "%c_type%"=="3" (
    call bun run scripts/generate-multi-wallets.ts --chain=dual --count=%w_count%
) else (
    call bun run scripts/generate-multi-wallets.ts --chain=evm --count=%w_count%
)

echo.
echo ===============================================================================
echo   Proses selesai! Berkas CSV dan JSON tersimpan di folder wallets\
echo   Tekan tombol apa saja untuk menutup...
echo ===============================================================================
pause >nul
