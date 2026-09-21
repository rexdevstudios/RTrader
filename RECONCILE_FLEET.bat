@echo off
title Omnichain Deployer - Background Fleet Reconciler
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
echo     [+] OMNICHAIN MEME DEPLOYER - REKONSILIASI ARMADA TOKEN [+]
echo ===============================================================================
echo.
echo   Worker ini melakukan audit read-only terhadap blockchain Base dan Solana
echo   untuk memverifikasi bytecode kontrak on-chain, memperbarui pool ID DEX,
echo   dan mencatat metrik likuiditas tanpa biaya gas (Rp 0 Gas Mutasi).
echo.
echo ===============================================================================
echo   PILIH MODE OPERASI REKONSILIASI:
echo ===============================================================================
echo.
echo   [1] Jalankan 1 Kali Scan Audit (Single-Pass)
echo   [2] Jalankan Sebagai Background Daemon (Loop Tiap 5 Menit)
echo   [3] Keluar
echo.
echo ===============================================================================

set /p choice="Pilih opsi [1-3]: "

if "%choice%"=="1" goto single_pass
if "%choice%"=="2" goto daemon_mode
if "%choice%"=="3" goto exit_worker

echo.
echo [!] Pilihan tidak valid. Silakan masukkan angka 1 sampai 3.
timeout /t 2 >nul
goto menu

:single_pass
cls
echo ===============================================================================
echo   MENJALANKAN REKONSILIASI ARMADA (SINGLE-PASS SCAN)...
echo ===============================================================================
echo.
call bun run fleet:reconcile
echo.
echo -------------------------------------------------------------------------------
echo   Eksekusi selesai. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:daemon_mode
cls
echo ===============================================================================
echo   MENJALANKAN REKONSILIASI ARMADA DAEMON (LOOP TIAP 5 MENIT)...
echo   Tekan CTRL+C untuk menghentikan daemon kapan saja secara aman.
echo ===============================================================================
echo.
call bun run fleet:reconcile --daemon
echo.
echo -------------------------------------------------------------------------------
echo   Daemon telah dihentikan. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:exit_worker
cls
exit /b 0
