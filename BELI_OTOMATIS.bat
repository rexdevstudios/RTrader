@echo off
TITLE EKSEKUSI AUTO-BUY TOKEN ON-CHAIN
COLOR 0B
cls

echo ===================================================================
echo    OMNICHAIN BOT - EKSEKUSI PEMBELIAN OTOMATIS ON-CHAIN (BASE)
echo ===================================================================
echo.
echo Dompet Pengirim : 0x946657D17C7e83052D50634D9dA6FF3Fc46b418a
echo Jaringan        : Base Mainnet (Chain ID: 8453)
echo.
echo Transaksi ini akan:
echo  1. Membeli token secara on-chain langsung di Base.
echo  2. Menyalakan grafik candlestick perdana di DexScreener.
echo  3. Menambah token holders di Basescan.
echo  4. Mengisi data volume dan transaksi di website Anda.
echo.

set /p target_ca="Masukkan Alamat Kontrak CA (Tekan ENTER untuk $PUMPRUN): "
if "%target_ca%"=="" set "target_ca=0x7CE19E4F978009EB644c27946B47221b824C0bA3"

set /p swap_amount="Masukkan Jumlah ETH [Default: 0.0002]: "
if "%swap_amount%"=="" set "swap_amount=0.0002"

echo.
echo Target Kontrak  : %target_ca%
echo Nilai Swap      : %swap_amount% ETH
echo.

set /p confirm="Apakah Anda yakin ingin mengeksekusi pembelian sekarang? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo [!] Pembelian dibatalkan oleh pengguna.
    pause
    exit /b 0
)

echo.
bun run scripts/execute-direct-swap.ts %swap_amount% %target_ca%

echo.
echo ===================================================================
echo Tekan sembarang tombol untuk keluar...
echo ===================================================================
pause >nul
exit /b 0
