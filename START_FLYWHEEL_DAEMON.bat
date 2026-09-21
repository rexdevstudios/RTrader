@echo off
title RTrader - 24/7 Perpetual Flywheel Revenue Recycler Daemon
color 0A

echo =================================================================
echo   [+] RTrader SocialFi - 24/7 Perpetual Flywheel Daemon [+]
echo =================================================================
echo   Monitoring Token : $PUMPRUN (0x0a99f4251A461e8abC693a56BB837fD815D51BA3)
echo   Network          : Base Mainnet L2 (Uniswap v4 Doppler Hook)
echo   Creator Fee      : 95%% WETH Allocation
echo   Recycle Pillars  : 35%% Treasury, 30%% Burn, 20%% Dividends, 15%% Jackpot
echo   Scan Interval    : Every 5 Minutes
echo =================================================================
echo.

:loop
echo [%date% %time%] Memulai siklus worker flywheel...
bun run scripts/run-flywheel-worker.ts --daemon --interval=5
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Worker berhenti dengan error level %ERRORLEVEL%.
    echo Mencoba restart dalam 10 detik...
    timeout /t 10 /nobreak >nul
    goto loop
)

pause
