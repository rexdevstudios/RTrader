@echo off
title Omnichain Auto Viral Meme Deployer - Menu Utama
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
echo     [+] RTRADER SOCIALFI PLATFORM - CONTROL PLANE (EXECUTIVE MENU) [+]
echo ===============================================================================
echo.
echo   [ALUR UTAMA REKOMENDASI (SEKALI KLIK)]
echo   [0]  [AUTO-PILOT]   Alur Kerja Terpadu Berurutan (Wizard Hulu ke Hilir Sekali Klik)
echo   [6]  [PIPELINE]     Pipeline Otomatis Terpadu (Fase 1 -^> 2 -^> 3 -^> 4 -^> 5 Sekali Klik)
echo.
echo   [MODUL OPERASIONAL UTAMA]
echo   [9]   [LAUNCHPAD]    Deploy Token (Base Mainnet, Solana [10], Clanker [9C], ArcPad [9A], Robinhood [9R])
echo   [18]  [TRADING]      Catalyst Trading ($1 Aktivasi Grafik DexScreener ^& Auto Take-Profit)
echo   [19]  [BOOSTER]      DexScreener Trending Booster (Multi-Wallet Unique Makers)
echo   [14]  [BRANDING]     Website 3D Parallax [14W], Investor Offer Deck, Referral [17]
echo   [13]  [TREASURY]     Audit ^& Panen Royalti Kas WETH 95%%, Multi-Wallet CLI [21]
echo   [1]   [MONITORING]   Dashboard Status Armada [1], Matriks Armada [2], Rekonsiliasi [23]
echo   [20]  [AUTOPILOT]    Worker Otomatis 24/7 (Cron Autopilot [20], Flywheel [16], Telegram [12])
echo.
echo   [PUSAT DIAGNOSTIK ^& SIMULASI (ZERO-GAS)]
echo   [8]   [SIMULASI]     Simulasi Testnet [8] ^& Preflight Flight Rehearsal [24] (Rp 0 Gas)
echo   [3]   [AUDIT-PRE]    Audit Kesiapan Saldo Dual-Chain [3], Akun Bankr [4], Multi-Key [5]
echo.
echo   [NAVIGASI ^& KELUAR]
echo   [C]   [CLASSIC]      Tampilkan Seluruh Daftar Menu Rinci Klasik (1-25)
echo   [25]  [KELUAR]       Keluar dari Program (atau ketik Q / X / EXIT)
echo.
echo   [TIPS WINDOWS: Jika konsol terhenti / muncul kata 'Select' di judul, tekan tombol ESC]
echo ===============================================================================
set /p pilihan="Masukkan angka atau kode pilihan Anda: "

if /i "%pilihan%"=="c" goto classic_menu
if /i "%pilihan%"=="classic" goto classic_menu
goto dispatch_choice

:classic_menu
cls
echo ===============================================================================
echo     [+] DAFTAR LENGKAP SEMUA MENU KLASIK (OPSI 0 - 25) [+]
echo ===============================================================================
echo.
echo   [ALUR KERJA TERPADU 5-FASE (HULU KE HILIR SEKALI KLIK)]
echo   [0]  [AUTO-PILOT]   Alur Kerja Terpadu Berurutan (Wizard 5-Fase Hulu ke Hilir / Sekali Klik)
echo.
echo   [FASE 1: PERSIAPAN ^& AUDIT KESIAPAN (PRE-LAUNCH)]
echo   [3]  [DUAL-CHAIN]   Audit Kesiapan Preflight On-Chain (Base Gas ^& Solana SOL)
echo   [4]  [BANKR]        Audit Akun ^& Saldo Resmi Bankr API (Quota ^& Multi-Account)
echo   [5]  [KEY-BANKR]    Pengaturan Multi-Akun Bankr (Akun 1, Akun 2, Switch, Audit Saldo)
echo   [8]  [SIMULASI]     Jalankan Simulasi / Preflight Flight Rehearsal (Gratis Rp 0)
echo   [24] [REHEARSAL]    Preflight Flight Rehearsal Zero-Gas Engine
echo.
echo   [FASE 2: PELUNCURAN TOKEN ON-CHAIN (LAUNCH)]
echo   [6]  [PIPELINE]     Pipeline Otomatis Terpadu (Fase 1 -^> 2 -^> 3 -^> 4 -^> 5 Sekali Klik)
echo   [9]  [BASE-1]       Deploy 1 Token ke Base Mainnet (100%% Gas Sponsored)
echo   [9R] [ROBINHOOD-1]  Deploy 1 Token ke Robinhood Chain L2 (Bankr API)
echo   [9C] [CLANKER-1]    Deploy 1 Token via Clanker v4 (Base, Gas Operator ~0.0001 ETH)
echo   [10] [SOLANA-1]     Deploy 1 Token ke Solana (Pump.fun Bonding Curve)
echo   [7]  [LAUNCHPAD]    Peluncur Dinamis Omnichain (Zero-Gas Base / Capital-Safe Solana)
echo   [15] [FLYWHEEL]     Deploy Token Mode Flywheel (Win-Win Buyback ^& Dividen WETH)
echo.
echo   [FASE 3: PENGAYAAN IDENTITAS, BRANDING ^& INVESTOR (ENRICHMENT)]
echo   [11] [PROYEK]       Sinkronisasi Proyek Bankr API (Tim Inti ^& Produk Nyata Terdaftar)
echo   [12] [TELEGRAM]     Jalankan Bot Telegram Komunitas (Master Fleet Bot / Dedicated)
echo   [14] [OFFER]        Generator Materi Promosi ^& Penawaran Investor Super Menarik
echo   [14W] [WEBSITE]     Generator Website Web3 3D Parallax (Cloudflare Pages / DNS)
echo   [14U] [PROFILES]    Update Profil DexScreener ^& GeckoTerminal (Atasi 'Info: 0')
echo   [14C] [CF-CLEAN]    Cloudflare Pages Cleaner (Cegah Limit 100 Project)
echo   [17] [REFERRAL]     Generator Link Referral ^& Bounties (Bagi Hasil WETH 5%%)
echo.
echo   [FASE 4: AKTIVASI PASAR ^& TRADING (CATALYST ^& GROWTH)]
echo   [18] [CATALYST]     Catalyst Trading ($1 Aktivasi Grafik DexScreener ^& Auto-Sell)
echo   [19] [BOOSTER]      DexScreener Trending Booster (Multi-Wallet Volume)
echo   [9S] [SCAN-CA]      Scan & Audit CA (DexScreener Paid /dp + GoPlus Security)
echo.
echo   [FASE 5: MESIN REVENUE PASIF ^& MONITORING (HARVEST ^& MONITOR)]
echo   [1]  [STATUS]       Dashboard Lengkap ^& Monitoring Status Armada Multi-Chain
echo   [2]  [FLEET]        Matriks Armada Token Multi-Chain ^& Rekonsiliasi On-Chain
echo   [13] [FEES]         Audit ^& Klaim Creator Fee WETH Terakumulasi
echo   [16] [WORKER]       Jalankan Tokenomics Harvester (Auto-Burn ^& Dividen WETH 24/7)
echo   [23] [RECONCILE]    Rekonsiliasi Armada On-Chain ^& DexScreener Sync
echo.
echo   [SISTEM ^& PENDUKUNG]
echo   [20] [AUTOPILOT]    Jalankan Bot Autopilot Penuh (Cron Scheduler Otomatis)
echo   [21] [WALLETS]      Buka CLI Manajemen Multi-Wallet ^& Proxy
echo   [22] [BACKUP]       Backup Database Vault (.eliza/vault.db)
echo   [25] [KELUAR]       Keluar dari Program
echo   [M]  [MENU]         Kembali ke Tampilan Ringkas (Executive View)
echo.
echo   [TIPS WINDOWS: Jika konsol terhenti / muncul kata 'Select' di judul, tekan tombol ESC]
echo ===============================================================================
set /p pilihan="Masukkan angka pilihan Anda [0-25]: "

if /i "%pilihan%"=="m" goto menu
if /i "%pilihan%"=="menu" goto menu

:dispatch_choice

if "%pilihan%"=="0" goto guided_journey
if "%pilihan%"=="1" goto status
if "%pilihan%"=="2" goto fleet_matrix
if "%pilihan%"=="3" goto dual_chain
if "%pilihan%"=="4" goto bankr_status
if "%pilihan%"=="5" goto bankr_key
if "%pilihan%"=="6" goto pipeline_terpadu
if "%pilihan%"=="7" goto dynamic_launchpad
if "%pilihan%"=="8" goto testnet
if "%pilihan%"=="9" goto single_deploy
if /i "%pilihan%"=="9R" goto robinhood_deploy
if /i "%pilihan%"=="9C" goto clanker_deploy
if /i "%pilihan%"=="9A" goto arc_deploy
if /i "%pilihan%"=="arc" goto arc_deploy
if /i "%pilihan%"=="9S" goto scan_ca
if /i "%pilihan%"=="scan" goto scan_ca
if /i "%pilihan%"=="dp" goto scan_ca
if "%pilihan%"=="10" goto solana_deploy
if "%pilihan%"=="11" goto project_sync
if "%pilihan%"=="12" goto telegram_bot
if "%pilihan%"=="13" goto creator_fees
if "%pilihan%"=="14" goto token_offer
if /i "%pilihan%"=="14W" goto website_deploy
if /i "%pilihan%"=="web" goto website_deploy
if /i "%pilihan%"=="website" goto website_deploy
if /i "%pilihan%"=="14U" goto update_profile
if /i "%pilihan%"=="profile" goto update_profile
if /i "%pilihan%"=="gt" goto update_profile
if /i "%pilihan%"=="dex" goto update_profile
if /i "%pilihan%"=="14C" goto cloudflare_cleaner
if /i "%pilihan%"=="cfclean" goto cloudflare_cleaner
if /i "%pilihan%"=="cleaner" goto cloudflare_cleaner
if /i "%pilihan%"=="14P" goto website_preview
if /i "%pilihan%"=="preview" goto website_preview
if "%pilihan%"=="15" goto flywheel_deploy
if "%pilihan%"=="16" goto flywheel_worker
if "%pilihan%"=="17" goto affiliate_link
if "%pilihan%"=="18" goto catalyst_swap
if "%pilihan%"=="19" goto trending_booster
if "%pilihan%"=="20" goto autopilot
if "%pilihan%"=="21" goto wallet_cli
if "%pilihan%"=="22" goto backup_vault
if "%pilihan%"=="23" goto reconcile_fleet
if "%pilihan%"=="24" goto rehearse_launch
if "%pilihan%"=="25" goto keluar
if /i "%pilihan%"=="q" goto keluar
if /i "%pilihan%"=="x" goto keluar
if /i "%pilihan%"=="exit" goto keluar
echo.
echo [!] Pilihan tidak valid. Silakan coba lagi.
ping -n 2 127.0.0.1 >nul
goto menu

:guided_journey
cls
call bun run scripts/guided-workflow-wizard.ts
goto menu

:status
cls
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - DASHBOARD MONITORING ^& STATUS [+]
echo ===============================================================================
echo.
call bun run status
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali ke Menu Utama...
pause >nul
goto menu

:fleet_matrix
cls
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - MATRIKS ARMADA ^& REKONSILIASI [+]
echo ===============================================================================
echo.
echo   PILIH MODE FLEET:
echo   [1] Tampilkan Matriks Armada Token (scripts/view-fleet-matrix.ts)
echo   [2] Eksekusi Rekonsiliasi On-Chain ^& DexScreener Sync (RECONCILE_FLEET.bat)
echo   [3] Kembali ke Menu Utama
echo.
set /p fchoice="Pilihan [1-3]: "
if "%fchoice%"=="1" (
    echo.
    call bun run scripts/view-fleet-matrix.ts
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali ke Menu Utama...
    pause >nul
    goto menu
)
if "%fchoice%"=="2" (
    cls
    call RECONCILE_FLEET.bat
    goto menu
)
goto menu

:dual_chain
cls
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - AUDIT KESIAPAN DUAL-CHAIN [+]
echo ===============================================================================
echo.
call bun run scripts/verify-dual-chain.ts
echo.
echo -------------------------------------------------------------------------------
echo   Audit selesai. Pilih langkah lanjutan:
echo   [1] Jalankan Preflight Flight Rehearsal Zero-Gas (Opsi 24)
echo   [2] Deploy Token ke Base Mainnet 0-Gas (Opsi 9)
echo   [3] Jalankan Guided Wizard 5-Fase (Opsi 0)
echo   [4] Kembali ke Menu Utama
echo -------------------------------------------------------------------------------
set /p next_dc="Pilihan [1-4, default=4]: "
if "%next_dc%"=="1" goto rehearse_launch
if "%next_dc%"=="2" goto single_deploy
if "%next_dc%"=="3" goto guided_journey
goto menu

:bankr_status
cls
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - AUDIT AKUN ^& SALDO RESMI BANKR API [+]
echo ===============================================================================
echo.
call bun run scripts/check-bankr-account.ts
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali ke Menu Utama...
pause >nul
goto menu

:bankr_key
cls
call SET_BANKR_KEY.bat
goto menu

:pipeline_terpadu
cls
call PIPELINE_OTOMATIS.bat
goto menu

:dynamic_launchpad
cls
call DEPLOY_DYNAMIC_TOKEN.bat
goto menu

:testnet
cls
echo ===============================================================================
echo     [+] OMNICHAIN MEME DEPLOYER - SIMULASI ^& PREFLIGHT REHEARSAL [+]
echo ===============================================================================
echo.
echo   PILIH MODE SIMULASI (GRATIS RP 0):
echo   [1] Preflight Flight Rehearsal Lengkap (Zero-Gas E2E Dry-Run)
echo   [2] Simulasi Testnet Klasik (scripts/simulate-option-a.ts)
echo   [3] Anti-Vamp ^& Clone Resolver Terminal (Inspeksi Ticker / Perang Klon)
echo   [4] Kembali ke Menu Utama
echo.
set /p tchoice="Pilihan [1-4]: "
if "%tchoice%"=="1" (
    cls
    call REHEARSE_DEPLOYMENT.bat
    goto menu
)
if "%tchoice%"=="2" (
    echo.
    call bun run scripts/simulate-option-a.ts
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali ke Menu Utama...
    pause >nul
    goto menu
)
if "%tchoice%"=="3" (
    cls
    call bun run scripts/inspect-clone-cluster.ts
    echo.
    echo -------------------------------------------------------------------------------
    echo   Pemeriksaan selesai. Lanjut deploy ke Base Mainnet?
    echo   [1] Ya, Deploy ke Base Mainnet (Opsi 9)
    echo   [2] Kembali ke Menu Utama
    echo -------------------------------------------------------------------------------
    set /p next_tv="Pilihan [1-2, default=2]: "
    if "%next_tv%"=="1" goto single_deploy
    goto menu
)
goto menu


:robinhood_deploy
cls
call DEPLOY_1_TOKEN_ROBINHOOD.bat
echo.
echo ===============================================================================
echo     [+] ESTAFET LANGKAH BERIKUTNYA SETELAH DEPLOYMENT ROBINHOOD [+]
echo ===============================================================================
echo   Pilih aksi lanjutan untuk token yang baru dibuat:
echo   [1] Terbitkan Website 3D Parallax ^& Profil DexScreener [Opsi 14W]
echo   [2] Pasang Bot Telegram Komunitas Khusus [Opsi 12]
echo   [3] Buat Materi Promosi ^& Investor Offer Deck [Opsi 14]
echo   [4] Kembali ke Menu Utama
echo ===============================================================================
set /p next_rh="Pilihan langkah selanjutnya [1-4, default=4]: "
if "%next_rh%"=="1" goto website_deploy
if "%next_rh%"=="2" goto telegram_bot
if "%next_rh%"=="3" goto token_offer
goto menu

:clanker_deploy
cls
call DEPLOY_1_TOKEN_CLANKER.bat
echo.
echo ===============================================================================
echo     [+] ESTAFET LANGKAH BERIKUTNYA SETELAH DEPLOYMENT CLANKER [+]
echo ===============================================================================
echo   Pilih aksi lanjutan untuk token yang baru dibuat:
echo   [1] Terbitkan Website 3D Parallax ^& Profil DexScreener [Opsi 14W]
echo   [2] Pasang Bot Telegram Komunitas Khusus [Opsi 12]
echo   [3] Buat Materi Promosi ^& Investor Offer Deck [Opsi 14]
echo   [4] Eksekusi Catalyst Buy ~$1 untuk Nyalakan Grafik DexScreener [Opsi 18]
echo   [5] Kembali ke Menu Utama
echo ===============================================================================
set /p next_cl="Pilihan langkah selanjutnya [1-5, default=5]: "
if "%next_cl%"=="1" goto website_deploy
if "%next_cl%"=="2" goto telegram_bot
if "%next_cl%"=="3" goto token_offer
if "%next_cl%"=="4" goto catalyst_swap
goto menu

:scan_ca
cls
call SCAN_CA_INTELLIGENCE.bat
goto menu

:arc_deploy
cls
call DEPLOY_1_TOKEN_ARC.bat
goto menu

:single_deploy
cls
call DEPLOY_1_TOKEN_BASE.bat
echo.
echo ===============================================================================
echo     [+] ESTAFET LANGKAH BERIKUTNYA SETELAH DEPLOYMENT BASE [+]
echo ===============================================================================
echo   Pilih aksi lanjutan untuk token yang baru dibuat:
echo   [1] Daftarkan Proyek ke Bankr API (Detail Tim ^& Produk Nyata) [Opsi 11]
echo   [2] Pasang Bot Telegram Komunitas Khusus [Opsi 12]
echo   [3] Eksekusi Catalyst Buy ~$1 untuk Nyalakan Grafik DexScreener [Opsi 18]
echo   [4] Buat Materi Promosi ^& Investor Offer Deck [Opsi 14]
echo   [5] Terbitkan Website 3D Parallax ^& Profil DexScreener [Opsi 14W]
echo   [6] Buat Tautan Referral Bagi Hasil (5%% WETH) [Opsi 17]
echo   [7] Kembali ke Menu Utama
echo ===============================================================================
set /p next_act="Pilihan langkah selanjutnya [1-7, default=7]: "
if "%next_act%"=="1" goto project_sync
if "%next_act%"=="2" goto telegram_bot
if "%next_act%"=="3" goto catalyst_swap
if "%next_act%"=="4" goto token_offer
if "%next_act%"=="5" goto website_deploy
if "%next_act%"=="6" goto affiliate_link
goto menu

:solana_deploy
cls
call DEPLOY_1_TOKEN_SOLANA.bat
echo.
echo ===============================================================================
echo     [+] ESTAFET LANGKAH BERIKUTNYA SETELAH DEPLOYMENT SOLANA [+]
echo ===============================================================================
echo   Pilih aksi lanjutan:
echo   [1] Pasang Bot Telegram Komunitas Khusus [Opsi 12]
echo   [2] Buat Materi Promosi ^& Investor Offer Deck [Opsi 14]
echo   [3] Terbitkan Website 3D Parallax ^& Profil DexScreener [Opsi 14W]
echo   [4] Tampilkan Matriks Armada Token [Opsi 2]
echo   [5] Kembali ke Menu Utama
echo ===============================================================================
set /p next_sol="Pilihan langkah selanjutnya [1-5, default=5]: "
if "%next_sol%"=="1" goto telegram_bot
if "%next_sol%"=="2" goto token_offer
if "%next_sol%"=="3" goto website_deploy
if "%next_sol%"=="4" goto fleet_matrix
goto menu

:project_sync
cls
echo ===============================================================================
echo     [+] SINKRONISASI PROYEK BANKR API (TIM INTI ^& PRODUK TERDAFTAR) [+]
echo ===============================================================================
echo.
echo   Pilih aksi:
echo   [1] Lihat daftar proyek terdaftar di Bankr API (Detail Tim ^& Produk)
echo   [2] Sinkronkan seluruh armada token Base ke Proyek Bankr lengkap
echo   [3] Kembali ke Menu Utama
echo.
set /p pchoice="Pilihan [1-3]: "
if "%pchoice%"=="1" (
    echo.
    call bun run scripts/manage-bankr-project.ts list
    echo.
    pause
    goto menu
)
if "%pchoice%"=="2" (
    echo.
    call bun run scripts/manage-bankr-project.ts sync-all
    echo.
    pause
    goto menu
)
goto menu

:telegram_bot
cls
call START_TELEGRAM_BOT.bat
goto menu

:creator_fees
cls
echo ===============================================================================
echo     [+] AUDIT ^& KLAIM CREATOR FEE WETH DARI UNISWAP / DOPPLER [+]
echo ===============================================================================
echo.
call bun run scripts/verify-creator-fee-status.ts
echo.
echo -------------------------------------------------------------------------------
echo   Tekan tombol apa saja untuk kembali ke Menu Utama...
pause >nul
goto menu

:token_offer
cls
call GENERATE_TOKEN_OFFER.bat
goto menu

:website_deploy
cls
call GENERATE_WEBSITE.bat
goto menu

:website_preview
cls
call PREVIEW_WEBSITE.bat
goto menu

:update_profile
cls
call UPDATE_TOKEN_PROFILES.bat
goto menu

:cloudflare_cleaner
cls
call CLEAN_CLOUDFLARE_PAGES.bat
goto menu

:flywheel_deploy
cls
call DEPLOY_FLYWHEEL_MODE.bat
goto menu

:flywheel_worker
cls
call START_FLYWHEEL_WORKER.bat
goto menu

:affiliate_link
cls
call GENERATE_AFFILIATE_LINK.bat
goto menu

:catalyst_swap
cls
call CATALYST_SWAP.bat
echo.
echo ===============================================================================
echo     [+] ESTAFET LANGKAH BERIKUTNYA SETELAH CATALYST TRADING [+]
echo ===============================================================================
echo   Pilih aksi lanjutan:
echo   [1] Jalankan Mesin Harvester Flywheel 24/7 (Dividen WETH) [Opsi 16]
echo   [2] Tampilkan Dashboard Status ^& PnL Real-Time [Opsi 1]
echo   [3] Nyalakan DexScreener Trending Booster [Opsi 19]
echo   [4] Rekonsiliasi Armada On-Chain [Opsi 23]
echo   [5] Kembali ke Menu Utama
echo ===============================================================================
set /p next_cat="Pilihan langkah selanjutnya [1-5, default=5]: "
if "%next_cat%"=="1" goto flywheel_worker
if "%next_cat%"=="2" goto status
if "%next_cat%"=="3" goto trending_booster
if "%next_cat%"=="4" goto reconcile_fleet
goto menu

:trending_booster
cls
call START_TRENDING_BOOSTER.bat
goto menu

:autopilot
cls
call START_BOT_AUTOPILOT.bat
goto menu

:wallet_cli
cls
call MANAJEMEN_WALLET.bat
goto menu

:backup_vault
cls
call BACKUP_DATABASE.bat
goto menu

:reconcile_fleet
cls
call RECONCILE_FLEET.bat
goto menu

:rehearse_launch
cls
call REHEARSE_DEPLOYMENT.bat
goto menu

:keluar
cls
echo ===============================================================================
echo   Terima kasih telah menggunakan Omnichain Auto Viral Meme Deployer!
echo ===============================================================================
echo.
ping -n 2 127.0.0.1 >nul
exit /b 0
