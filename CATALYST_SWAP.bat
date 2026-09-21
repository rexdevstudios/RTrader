@echo off
title Omnichain Deployer - Catalyst Trading & Aktivasi Grafik DexScreener
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

set "TARGET_TOKEN=%~1"
if "%TARGET_TOKEN%"=="" set "TARGET_TOKEN=1"

:menu
cls
echo ===============================================================================
echo   [+] CATALYST TRADING - AKTIVASI GRAFIK DEXSCREENER ^& AUTO TAKE-PROFIT [+]
echo ===============================================================================
echo.
echo   Target Koin Saat Ini : %TARGET_TOKEN%
echo   Modal Bersih         : ~$1.00 USD (0.00041 ETH + gas)
echo   Strategi             : Laddered Take-Profit (Jual 50%% Amankan Modal, 50%% Moonbag)
echo.
echo   PILIH AKSI:
echo.
echo   [0] Lihat Daftar Semua Token Live ^& Pilih Target Koin
echo   [1] Cek Status Saldo Wallet ^& Pool GeckoTerminal/DexScreener
echo   [2] Buka Link Terminal Pembelian (DexScreener / Bankr / Uniswap)
echo   [3] Catat Pembelian Manual ke Database (Input TxHash dari Browser/Wallet)
echo   [4] Eksekusi Auto-Buy On-Chain via Bot (Perlu Saldo >= 0.00045 ETH)
echo   [5] Jalankan Monitor Harga Live ^& Auto Take-Profit (Laddered 50%% Exit)
echo   [6] Trending Booster (Mencetak Candle Hijau ^& Unique Makers On-Chain)
echo   [7] Panen Royalti Kas Creator 95%% WETH (Treasury Harvester)
echo   [8] Wrap ETH ke WETH
echo   [9] Keluar
echo.
echo ===============================================================================
set /p c_choice="Masukkan angka pilihan Anda [0-9]: "

if "%c_choice%"=="0" goto action_list
if "%c_choice%"=="1" goto action_check
if "%c_choice%"=="2" goto action_link
if "%c_choice%"=="3" goto action_register
if "%c_choice%"=="4" goto action_autobuy
if "%c_choice%"=="5" goto action_monitor
if "%c_choice%"=="6" goto action_trending
if "%c_choice%"=="7" goto action_harvest
if "%c_choice%"=="8" goto action_wrapeth
if "%c_choice%"=="9" goto action_exit

echo.
echo [!] Pilihan tidak valid. Silakan masukkan angka antara 0 sampai 9.
timeout /t 2 >nul
goto menu

:action_list
cls
call bun run scripts/execute-catalyst-trading.ts list
echo.
echo Masukkan nomor urut token [1, 2, ...] ATAU Alamat Kontrak CA (0x...):
set /p new_target="Pilihan Token Target: "
if not "%new_target%"=="" set "TARGET_TOKEN=%new_target%"
goto menu

:action_check
cls
call bun run scripts/execute-catalyst-trading.ts check %TARGET_TOKEN%
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_link
cls
echo ===============================================================================
echo   [+] PILIH LINK TERMINAL PEMBELIAN DI BROWSER [+]
echo ===============================================================================
echo.
echo   Target Koin: %TARGET_TOKEN%
echo.
echo   Pilih terminal yang ingin dibuka di browser:
echo   [1] DexScreener - Grafik Live dan Swap Terintegrasi
echo   [2] GeckoTerminal - Pool Live (Doppler v4)
echo   [3] Bankr Terminal (masukan ETH) - Terminal Resmi Launchpad
echo   [4] Bankr Terminal (masukan WETH) - Direkomendasikan jika ETH Quote Gagal
echo   [5] Uniswap Web App - Routing Base
echo   [6] Kembali ke Menu
echo.
set /p link_choice="Pilihan Terminal [1-6, default=4]: "
if "%link_choice%"=="" set "link_choice=4"

if "%link_choice%"=="6" goto menu

set "SWAP_URL="
if "%link_choice%"=="1" for /f "delims=" %%u in ('bun run scripts/execute-catalyst-trading.ts link %TARGET_TOKEN% dexscreener') do set "SWAP_URL=%%u"
if "%link_choice%"=="2" for /f "delims=" %%u in ('bun run scripts/execute-catalyst-trading.ts link %TARGET_TOKEN% gecko') do set "SWAP_URL=%%u"
if "%link_choice%"=="3" for /f "delims=" %%u in ('bun run scripts/execute-catalyst-trading.ts link %TARGET_TOKEN% bankr') do set "SWAP_URL=%%u"
if "%link_choice%"=="4" for /f "delims=" %%u in ('bun run scripts/execute-catalyst-trading.ts link %TARGET_TOKEN% weth') do set "SWAP_URL=%%u"
if "%link_choice%"=="5" for /f "delims=" %%u in ('bun run scripts/execute-catalyst-trading.ts link %TARGET_TOKEN% uniswap') do set "SWAP_URL=%%u"

if "%SWAP_URL%"=="" (
    echo.
    echo [WARN] Tidak dapat mengambil URL terminal untuk target %TARGET_TOKEN%.
    echo.
    pause
    goto menu
)

echo.
echo [INFO] Membuka URL di browser...
start "" "%SWAP_URL%"
echo.
echo [INFO] Setelah transaksi swap berhasil dilakukan di browser,
echo        gunakan Menu [3] untuk mencatat TxHash ke database bot.
echo.
pause
goto menu

:action_register
cls
echo ===============================================================================
echo   [+] REGISTRASI PEMBELIAN MANUAL KE DATABASE VAULT [+]
echo ===============================================================================
echo.
echo   Target Koin: %TARGET_TOKEN%
echo.
echo   Panduan: Jika Anda baru saja membeli token melalui DexScreener,
echo   Bankr Terminal, atau Uniswap dari dompet pribadi (MetaMask/Rabby),
echo   salin Hash Transaksi (TxHash 0x...) dari dompet/explorer Anda ke bawah ini.
echo.
set /p tx_hash="Masukkan Hash Transaksi (TxHash): "
set /p eth_val="Masukkan Jumlah ETH yang dibeli (contoh: 0.00041 atau tekan ENTER): "
if "%eth_val%"=="" set "eth_val=0.00041"
echo.
call bun run scripts/execute-catalyst-trading.ts register %TARGET_TOKEN% %tx_hash% %eth_val%
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_autobuy
cls
echo ===============================================================================
echo   [+] EKSEKUSI AUTO-BUY ON-CHAIN VIA BOT [+]
echo ===============================================================================
echo.
call bun run scripts/execute-catalyst-trading.ts auto-buy %TARGET_TOKEN%
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_monitor
cls
echo ===============================================================================
echo   [+] MONITOR HARGA LIVE ^& AUTO TAKE-PROFIT [+]
echo ===============================================================================
echo.
call bun run scripts/execute-catalyst-trading.ts monitor %TARGET_TOKEN%
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_trending
cls
echo ===============================================================================
echo   [+] DEXSCREENER TRENDING BOOSTER (UNIQUE MAKERS ^& GREEN CANDLES) [+]
echo ===============================================================================
echo.
echo   Target Koin: %TARGET_TOKEN%
echo.
echo   [1] Mode Simulasi (0 Gas - Uji Coba Algoritma Rotasi)
echo   [2] Mode Live On-Chain (Micro-Buys Riil di Base Mainnet)
echo   [3] Kembali ke Menu
echo.
set /p tb_mode="Pilih Mode [1-3, default=1]: "
if "%tb_mode%"=="" set "tb_mode=1"
if "%tb_mode%"=="3" goto menu
if "%tb_mode%"=="2" (
    echo.
    set /p tb_rounds="Jumlah Ronde [default=1]: "
    if "%tb_rounds%"=="" set "tb_rounds=1"
    set /p tb_amt="Nominal ETH per trade [default=0.00010]: "
    if "%tb_amt%"=="" set "tb_amt=0.00010"
    call bun run scripts/run-trending-booster.ts %TARGET_TOKEN% %tb_rounds% --live --amount %tb_amt%
) else (
    echo.
    set /p tb_rounds="Jumlah Ronde Simulasi [default=3]: "
    if "%tb_rounds%"=="" set "tb_rounds=3"
    call bun run scripts/run-trending-booster.ts %TARGET_TOKEN% %tb_rounds% --simulated
)
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_harvest
cls
echo ===============================================================================
echo   [+] CREATOR FEE HARVESTER ^& TREASURY SWEEPER (95%% WETH) [+]
echo ===============================================================================
echo.
echo   [1] Scan Status Royalti (Read-Only)
echo   [2] Klaim / Panen Royalti ke Dompet Kas On-Chain
echo   [3] Kembali ke Menu
echo.
set /p h_mode="Pilih Aksi [1-3, default=1]: "
if "%h_mode%"=="" set "h_mode=1"
if "%h_mode%"=="3" goto menu
if "%h_mode%"=="2" (
    call bun run scripts/harvest-creator-fees.ts --claim
) else (
    call bun run scripts/harvest-creator-fees.ts
)
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_wrapeth
cls
echo ===============================================================================
echo   [+] WRAP ETH KE WETH (BASE L2) [+]
echo ===============================================================================
echo.
set /p wrap_amt="Jumlah ETH yang ingin di-wrap ke WETH (contoh: 0.0002): "
if not "%wrap_amt%"=="" (
    call bun run scripts/execute-catalyst-trading.ts wrap-eth %wrap_amt%
)
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali...
pause >nul
goto menu

:action_exit
exit /b 0
