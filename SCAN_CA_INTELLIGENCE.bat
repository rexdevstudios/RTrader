@echo off
setlocal enabledelayedexpansion
title CA Intelligence Scanner - DexScreener Paid (/dp) & GoPlus Security Audit

cls
echo ===============================================================================
echo   [+] CA INTELLIGENCE & AUDIT SCANNER (WINDOWS FULL CLI) [+]
echo ===============================================================================
echo.
echo   Fitur Scanner:
echo   1. Verifikasi Status DexScreener Paid (/dp) & Jumlah Boosts Real-Time
echo   2. Audit Keamanan Kontrak via GoPlus (Honeypot, Pajak B/S, Mint, Renounced)
echo   3. Metrik Pasar Live (Harga USD, Likuiditas, FDV, Volume 24 Jam)
echo   4. Evaluasi Unified Safety Score (0-100 Rating) & Peringatan Risiko
echo   5. Tautan Instan 1-Click ke Bot Sniper (Maestro, Banana, Trojan, GMGN, Photon)
echo.
echo   Multi-Chain Didukung: Base Mainnet, Solana, Ethereum, BSC, Arbitrum.
echo   Biaya API          : 100%% GRATIS (Tidak butuh API key Arkham / berbayar).
echo.
echo ===============================================================================
echo.

set "TARGET_CA=%~1"

if "%TARGET_CA%"=="" (
    echo [INPUT] Masukkan Alamat Kontrak (CA) koin yang ingin di-scan:
    echo         (Contoh: 0x4Fd4F708427bd4e4934327C472de4718b90C5845 atau alamat Solana)
    set /p TARGET_CA="> Alamat Kontrak (CA): "
)

if "%TARGET_CA%"=="" (
    echo.
    echo [BATAL] Alamat kontrak kosong. Pemindaian dibatalkan.
    echo.
    pause
    exit /b 0
)

echo.
echo [INFO] Menjalankan pemindaian intelijen untuk: %TARGET_CA%
echo.

bun run scripts/scan-ca-intelligence.ts %TARGET_CA% %2 %3

echo.
echo ===============================================================================
echo   Pemindaian selesai. Tekan sembarang tombol untuk kembali...
echo ===============================================================================
pause >nul
