@echo off
title Omnichain Auto Viral Meme Deployer - Deploy Token ke ArcPad (Arc Chain 5042)
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

:menu_arc
cls
echo ===============================================================================
echo   [+] ARCPAD LAUNCHPAD WIZARD — ARC MAINNET (CHAIN ID: 5042) [+]
echo ===============================================================================
echo.
echo   Jaringan: Arc Mainnet (Circle Layer-1, Native Gas: USDC)
echo   Target:   ArcPad (arcpad.meme) ^& Uniswap V3 Locked Liquidity Pool
echo.
echo   [1] 🧪 Simulasi Deployment ArcPad (Zero-Gas Dry-Run)
echo   [2] 🚀 Deploy Token Langsung ke ArcPad (Live On-Chain)
echo   [3] 🔍 Periksa Koneksi RPC ^& Saldo Native USDC
echo   [4] 📊 Tampilkan Daftar Token Terbaru di ArcPad API
echo   [5] ↩ Kembali ke Menu Utama
echo.
echo ===============================================================================
set /p arc_choice="Pilih opsi [1-5]: "

if "%arc_choice%"=="1" goto sim_deploy
if "%arc_choice%"=="2" goto live_deploy
if "%arc_choice%"=="3" goto check_balance
if "%arc_choice%"=="4" goto list_tokens
if "%arc_choice%"=="5" goto exit_arc
goto menu_arc

:sim_deploy
echo.
echo [INFO] Menjalankan simulasi dry-run peluncuran ArcPad...
call bun run scripts/deploy-arcpad-token.ts --simulate
echo.
pause
goto menu_arc

:live_deploy
echo.
echo ===============================================================================
echo   PERINGATAN: ANDA AKAN MELUNCURKAN TOKEN LIVE DI ARC MAINNET (5042)
echo   Pastikan dompet Anda memiliki saldo Native USDC untuk gas transaksi.
echo ===============================================================================
echo.
set /p t_name="Masukkan Nama Token (misal: Cyber Arc Doge): "
if "%t_name%"=="" set "t_name=Cyber Arc Doge"

set /p t_symbol="Masukkan Simbol Token (misal: CAD): "
if "%t_symbol%"=="" set "t_symbol=CAD"

set /p t_buy="Masukkan Jumlah Dev Buy USDC [0 untuk tanpa buy]: "
if "%t_buy%"=="" set "t_buy=0"

echo.
echo Menjalankan deployment on-chain ke ArcPad...
call bun run scripts/deploy-arcpad-token.ts --name="%t_name%" --symbol="%t_symbol%" --dev-buy=%t_buy%
echo.
pause
goto menu_arc

:check_balance
echo.
echo [INFO] Memeriksa status RPC dan saldo operator di Arc Chain...
call bun -e "import { getArcPublicClient, getArcNativeBalance, getArcWalletClient } from './src/modules/arc/index.ts'; const pc = getArcPublicClient(); const wc = getArcWalletClient((process.env.ARC_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY) as any); console.log('Chain ID:', await pc.getChainId()); console.log('Head Block:', await pc.getBlockNumber()); const b = await getArcNativeBalance(pc, wc.account.address); console.log('Operator Address:', wc.account.address); console.log('Saldo Native USDC:', b.numeric, 'USDC');"
echo.
pause
goto menu_arc

:list_tokens
echo.
echo [INFO] Mengambil 5 token terbaru yang diluncurkan di ArcPad...
call bun -e "import { ArcPadAdapter } from './src/modules/arc/index.ts'; const res = await ArcPadAdapter.fetchLaunchedTokens(5); console.log('Total Fetched:', res.creations.length); res.creations.forEach((t, i) => console.log(`[${i+1}] ${t.name} ($${t.symbol}) - Token: ${t.token} - Pool: ${t.pool}`));"
echo.
pause
goto menu_arc

:exit_arc
exit /b 0
