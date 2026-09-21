@echo off
TITLE KIRIM SALDO BOT KE DOMPET METAMASK / PRIBADI
COLOR 0A
cls

echo ===================================================================
echo    OMNICHAIN BOT - TRANSFER SALDO GAS KE DOMPET METAMASK
echo ===================================================================
echo.
echo Dompet Operator Bot: 0x946657D17C7e83052D50634D9dA6FF3Fc46b418a
echo Jaringan           : Base Mainnet (Chain ID 8453)
echo.
echo Script ini akan mengirimkan saldo ETH dari dompet bot ke dompet
echo MetaMask/Rabby pribadi Anda agar Anda dapat langsung melakukan swap.
echo.

set /p user_addr="Masukkan Alamat Dompet MetaMask Anda (0x...): "
if "%user_addr%"=="" (
    echo [!] Alamat tidak boleh kosong!
    pause
    exit /b 1
)

set /p user_amount="Masukkan Jumlah ETH [Default: 0.0006]: "
if "%user_amount%"=="" set "user_amount=0.0006"

echo.
bun run scripts/transfer-balance-to-user.ts %user_addr% %user_amount%

echo.
echo ===================================================================
echo Tekan sembarang tombol untuk keluar...
echo ===================================================================
pause >nul
exit /b 0
