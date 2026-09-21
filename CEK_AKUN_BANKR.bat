@echo off
TITLE CEK AKUN DAN SALDO BANKR API
COLOR 0B
cls

echo ===================================================================
echo    OMNICHAIN BOT - CEK AKUN DAN SALDO RESMI BANKR API
echo ===================================================================
echo.
echo Memeriksa status akun, saldo $7.75 USD, dan fee reward on-chain...
echo.

where bun >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] ERROR: Bun runtime tidak ditemukan di sistem!
    echo     Silakan install Bun terlebih dahulu dari https://bun.sh
    echo.
    pause
    exit /b 1
)

bun run scripts/check-bankr-account.ts

echo.
echo ===================================================================
echo Pengecekan selesai. Tekan sembarang tombol untuk kembali...
echo ===================================================================
pause >nul
exit /b 0
