@echo off
title DexScreener Trending Booster - Multi-Wallet Micro-Makers
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
echo     [+] OMNICHAIN MEME DEPLOYER - DEXSCREENER TRENDING BOOSTER [+]
echo ===============================================================================
echo.
echo   Skrip ini akan melakukan rotasi pembelian mikro (0.0001 ETH)
echo   secara otomatis menggunakan multi-wallet untuk memicu algoritma:
echo   - Unique Makers DexScreener / Photon
echo   - Kerapatan lilin hijau (Green Candle Frequency)
echo   - Volume velocity di Base L2
echo.
echo   PILIH MODE EKSEKUSI:
echo   [1] Mode Simulasi Aman (Rp 0 Gas / Uji Coba Multi-Wallet Safe)
echo   [2] Mode Live Broadcast (Menggunakan dompet operator & BasedBot)
echo.
set /p m_choice="Pilih mode [1/2, default=1]: "
if "%m_choice%"=="" set m_choice=1

set /p custom_ca="Masukkan Contract Address (Tekan ENTER untuk pakai token Base terbaru): "

echo.
if "%m_choice%"=="2" (
    echo [PERINGATAN] Anda memilih MODE LIVE BROADCAST.
    echo Proteksi Gas: Saldo operator dijaga selalu di atas 0.0003 ETH.
    echo Rekomendasi: 3 putaran mikro (~0.00005 ETH per swap = ~$0.36 total) untuk memicu 3 Unique Makers.
    echo.
    set /p rounds="Masukkan jumlah putaran [Default: 3]: "
    if "%rounds%"=="" set rounds=3
    set /p confirm="Apakah Anda yakin ingin broadcast order nyata on-chain? (Y/N): "
    if /i not "%confirm%"=="Y" (
        echo [INFO] Operasi dibatalkan.
        pause
        exit /b 0
    )
    echo [INFO] Memulai DexScreener Trending Booster LIVE (%rounds% putaran)...
    if "%custom_ca%"=="" (
        call bun run trending:boost "" %rounds% --live
    ) else (
        call bun run trending:boost %custom_ca% %rounds% --live
    )
) else (
    set /p rounds="Masukkan jumlah putaran [Default: 10]: "
    if "%rounds%"=="" set rounds=10
    echo [INFO] Memulai DexScreener Trending Booster SIMULASI (%rounds% putaran, Rp 0 Gas)...
    if "%custom_ca%"=="" (
        call bun run trending:boost "" %rounds% --simulated
    ) else (
        call bun run trending:boost %custom_ca% %rounds% --simulated
    )
)
echo.
echo ===============================================================================
echo   Proses selesai. Tekan tombol apa saja untuk menutup...
echo ===============================================================================
pause >nul
