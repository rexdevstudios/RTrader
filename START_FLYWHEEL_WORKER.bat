@echo off
title Omnichain Deployer - Flywheel Fee Recycler Worker
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
echo     [+] OMNICHAIN MEME DEPLOYER - FLYWHEEL FEE RECYCLER WORKER [+]
echo ===============================================================================
echo.
echo   Worker akan memeriksa akumulasi creator fee pada seluruh armada token aktif,
echo   mengklaim fee secara otomatis, lalu mengeksekusi 4 pilar flywheel:
echo   - 35%% Kas Bersih Anda (ke Alamat Treasury / Dompet Operator)
echo   - 30%% Buyback DAN Burn Token (ke alamat 0xdead)
echo   - 20%% Dividen Pasif Top Holders
echo   - 15%% FOMO Jackpot Pool
echo.
echo ===============================================================================
echo   PILIH MODE OPERASI FLYWHEEL RECYCLER:
echo ===============================================================================
echo.
echo   [1] Jalankan 1 Kali Scan DAN Recycle (Single-Pass)
echo   [2] Jalankan Sebagai Background Harvester Daemon (Auto-Scan Tiap 5 Menit)
echo   [3] Uji Coba Simulasi Broadcast Alert Buyback & Burn ke Telegram
echo   [4] Keluar
echo.
echo ===============================================================================

set /p choice="Pilih opsi [1-4]: "

if "%choice%"=="1" goto single_pass
if "%choice%"=="2" goto daemon_mode
if "%choice%"=="3" goto test_broadcast
if "%choice%"=="4" goto exit_worker

echo.
echo [!] Pilihan tidak valid. Silakan masukkan angka 1 sampai 4.
timeout /t 2 >nul
goto menu

:single_pass
cls
echo ===============================================================================
echo   MENJALANKAN FLYWHEEL WORKER (SINGLE-PASS SCAN)...
echo ===============================================================================
echo.
call bun run flywheel:worker
echo.
echo -------------------------------------------------------------------------------
echo   Eksekusi worker selesai. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:daemon_mode
cls
echo ===============================================================================
echo   MENJALANKAN AUTONOMOUS FLYWHEEL HARVESTER DAEMON (LOOP TIAP 5 MENIT)...
echo   Tekan CTRL+C untuk menghentikan daemon kapan saja secara aman.
echo ===============================================================================
echo.
call bun run flywheel:worker --daemon
echo.
echo -------------------------------------------------------------------------------
echo   Daemon telah dihentikan. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:test_broadcast
cls
echo ===============================================================================
echo   SIMULASI BROADCAST ALERT BUYBACK & BURN KE TELEGRAM...
echo ===============================================================================
echo.
call bun run scripts/run-flywheel-worker.ts --test-broadcast
echo.
echo -------------------------------------------------------------------------------
echo   Simulasi selesai. Tekan tombol apa saja untuk kembali ke menu...
pause >nul
goto menu

:exit_worker
cls
echo Terima kasih telah menggunakan Omnichain Flywheel Engine.
exit /b 0
