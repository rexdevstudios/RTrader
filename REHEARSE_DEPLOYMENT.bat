@echo off
title Omnichain Deployer - Preflight Flight Rehearsal
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
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - PREFLIGHT FLIGHT REHEARSAL [+]
echo ===============================================================================
echo.
echo   Simulasi menyeluruh seluruh siklus peluncuran token secara terpadu:
echo   - Pengujian AI Generator Identitas Meme
echo   - Prediksi Deterministik CA dan Pool ID (Biaya Rp 0 Gas)
echo   - Audit Saldo On-Chain Real-Time (ETH / SOL)
echo   - Validasi Menyeluruh Production Safety Gate
echo   - Pengujian Mutex Lock Concurrency
echo   - Pembuatan Kartu Penawaran Investor Otomatis
echo.
echo   KEAMANAN: 100%% SIMULASI / TANPA GAS / TANPA TRANSAKSI ON-CHAIN
echo.
echo ===============================================================================
echo   PILIH RANTAI TARGET UNTUK REHEARSAL:
echo ===============================================================================
echo.
echo   [1] Uji Kesiapan Kedua Rantai (Base DAN Solana)
echo   [2] Uji Kesiapan Base Saja
echo   [3] Uji Kesiapan Solana Saja
echo   [4] Keluar
echo.
echo ===============================================================================

set /p choice="Pilih opsi [1-4]: "

if "%choice%"=="1" goto rehearse_all
if "%choice%"=="2" goto rehearse_base
if "%choice%"=="3" goto rehearse_solana
if "%choice%"=="4" goto exit_rehearsal

echo.
echo [!] Pilihan tidak valid. Silakan masukkan angka 1 sampai 4.
timeout /t 2 >nul
goto menu

:rehearse_all
cls
echo ===============================================================================
echo   MENJALANKAN FLIGHT REHEARSAL (BASE ^& SOLANA)...
echo ===============================================================================
echo.
call bun run scripts/rehearse-deployment.ts --chain all
echo.
echo -------------------------------------------------------------------------------
echo   Rehearsal selesai. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:rehearse_base
cls
echo ===============================================================================
echo   MENJALANKAN FLIGHT REHEARSAL (BASE ONLY)...
echo ===============================================================================
echo.
call bun run scripts/rehearse-deployment.ts --chain base
echo.
echo -------------------------------------------------------------------------------
echo   Rehearsal selesai. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:rehearse_solana
cls
echo ===============================================================================
echo   MENJALANKAN FLIGHT REHEARSAL (SOLANA ONLY)...
echo ===============================================================================
echo.
call bun run scripts/rehearse-deployment.ts --chain solana
echo.
echo -------------------------------------------------------------------------------
echo   Rehearsal selesai. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:exit_rehearsal
cls
exit /b 0
