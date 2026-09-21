@echo off
title Omnichain Deployer - Manajemen Multi-Wallet dan Proxy
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
echo     [+] OMNICHAIN MEME DEPLOYER - MANAJEMEN MULTI-WALLET DAN PROXY [+]
echo ===============================================================================
echo.
echo   PILIH AKSI MANAJEMEN WALLET:
echo.
echo   [1] Lihat Daftar Wallet DAN Status Rute Saat Ini
echo   [2] Cek Saldo On-Chain Real-Time (ETH DAN SOL)
echo   [3] Sinkronkan / Daftarkan Wallet Operator dari .env
echo   [4] Atur Alamat Tujuan Kas / Treasury Pribadi (Cold Wallet)
echo   [5] Atur Webhook Notifikasi Komunitas (Telegram / Discord)
echo   [6] Tambah Wallet Baru Manual (ID, Label, Alamat)
echo   [7] Tambah Konfigurasi Proxy Manual (HTTP / SOCKS5)
echo   [8] [WIZARD] Tambah 1 Akun Bankr + 1 Proxy Lengkap (Auto-Test DAN Bind)
echo   [9] [DIAGNOSTIK] Uji Latensi DAN Kesehatan Semua Proxy
echo   [10] [BIND RUTE] Hubungkan Wallet ke Proxy yang Sudah Ada (set-route)
echo   [11] [KUNCI BANKR] Atur / Perbarui BANKR_API_KEY (Uji Saldo Real-Time)
echo   [12] [GENERATOR] Generate Akun Multi-Wallet Otomatis (EVM & Solana)
echo   [13] [AUDIT CEX] Audit Pendanaan Bersih & Deteksi Anti-Cluster Sub-Wallet
echo   [14] Keluar
echo.
echo ===============================================================================
set /p w_choice="Masukkan angka pilihan Anda [1-14]: "

if "%w_choice%"=="1" (
    cls
    echo ===============================================================================
    echo     [+] DAFTAR WALLET DAN STATUS RUTE [+]
    echo ===============================================================================
    echo.
    call bun run scripts/manage-wallets.ts list
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="2" (
    cls
    echo ===============================================================================
    echo     [+] SALDO ON-CHAIN REAL-TIME (BASE L2 & SOLANA) [+]
    echo ===============================================================================
    echo.
    echo   PILIH MODE CEK SALDO:
    echo   [1] Tampilkan Saldo di Terminal Saja
    echo   [2] Tampilkan Saldo ^& Kirim Alert Notifikasi jika Kritis (--alert)
    echo   [3] Auto-Rebalance Saldo Defisit dari Master Wallet (--rebalance)
    echo   [4] Simulasi Auto-Rebalance Saldo (--dry-run)
    echo.
    set /p bal_mode="Masukkan pilihan Anda [1-4]: "
    echo.
    if "%bal_mode%"=="2" (
        call bun run scripts/manage-wallets.ts check-balance --alert
    ) else if "%bal_mode%"=="3" (
        call bun run scripts/manage-wallets.ts rebalance --broadcast
    ) else if "%bal_mode%"=="4" (
        call bun run scripts/manage-wallets.ts rebalance --dry-run
    ) else (
        call bun run scripts/manage-wallets.ts check-balance
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="3" (
    cls
    echo ===============================================================================
    echo     [+] SINKRONISASI WALLET DARI .ENV [+]
    echo ===============================================================================
    echo.
    call bun run scripts/manage-wallets.ts sync-env
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="4" (
    cls
    echo ===============================================================================
    echo     [+] ATUR ALAMAT TUJUAN KAS / TREASURY (COLD WALLET) [+]
    echo ===============================================================================
    echo.
    echo   Pilih jenis jaringan dompet penerima:
    echo   [1] EVM (Base L2 / Ethereum / BSC - contoh: 0x...)
    echo   [2] Solana (contoh: 4znm...)
    echo.
    set /p t_chain="Masukkan pilihan [1/2]: "
    if "%t_chain%"=="1" (
        set /p t_addr="Masukkan Alamat EVM Penerima Fee (0x...): "
        echo.
        call bun run scripts/manage-wallets.ts set-treasury evm %t_addr%
    ) else if "%t_chain%"=="2" (
        set /p t_addr="Masukkan Alamat Solana Penerima Fee: "
        echo.
        call bun run scripts/manage-wallets.ts set-treasury solana %t_addr%
    ) else (
        echo [ERROR] Pilihan tidak valid.
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="5" (
    cls
    echo ===============================================================================
    echo     [+] ATUR WEBHOOK NOTIFIKASI KOMUNITAS [+]
    echo ===============================================================================
    echo.
    echo   Pilih platform webhook:
    echo   [1] Telegram Webhook (https://api.telegram.org/...)
    echo   [2] Discord Webhook (https://discord.com/api/webhooks/...)
    echo.
    set /p hook_choice="Masukkan pilihan [1/2]: "
    if "%hook_choice%"=="1" (
        set /p hook_url="Masukkan URL Webhook Telegram: "
        echo.
        call bun run scripts/manage-wallets.ts set-webhook telegram %hook_url%
    ) else if "%hook_choice%"=="2" (
        set /p hook_url="Masukkan URL Webhook Discord: "
        echo.
        call bun run scripts/manage-wallets.ts set-webhook discord %hook_url%
    ) else (
        echo [ERROR] Pilihan tidak valid.
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="6" (
    cls
    echo ===============================================================================
    echo     [+] TAMBAH WALLET BARU [+]
    echo ===============================================================================
    echo.
    set /p new_id="Masukkan ID Wallet (contoh: sub-wallet-1): "
    set /p new_label="Masukkan Label Wallet (contoh: Wallet Cadangan): "
    set /p new_evm="Masukkan Alamat EVM (0x...): "
    set /p new_sol="Masukkan Alamat Solana (opsional, tekan ENTER jika kosong): "
    echo.
    call bun run scripts/manage-wallets.ts add-wallet %new_id% "%new_label%" %new_evm% %new_sol%
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="7" (
    cls
    echo ===============================================================================
    echo     [+] TAMBAH KONFIGURASI PROXY MANUAL [+]
    echo ===============================================================================
    echo.
    set /p p_id="Masukkan ID Proxy (contoh: proxy_us_1): "
    set /p p_proto="Masukkan Protokol (http / https / socks5): "
    set /p p_host="Masukkan Host / IP: "
    set /p p_port="Masukkan Port: "
    set /p p_user="Masukkan Username (opsional): "
    set /p p_pass="Masukkan Password (opsional): "
    echo.
    call bun run scripts/manage-wallets.ts add-proxy %p_id% %p_proto% %p_host% %p_port% %p_user% %p_pass%
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="8" (
    cls
    echo ===============================================================================
    echo     [+] WIZARD SETUP MULTI-ACCOUNT DAN PROXY [+]
    echo ===============================================================================
    echo.
    echo   PILIH METODE PENAMBAHAN AKUN:
    echo.
    echo   [1] Wizard Interaktif 1 Akun (Step-by-Step dengan Auto-Naming)
    echo   [2] Bulk Import Banyak Proxy / Akun dari File (.txt / .csv)
    echo   [3] Kembali ke Menu Utama
    echo.
    set /p wiz_mode="Masukkan pilihan Anda [1-3]: "
    if "%wiz_mode%"=="1" (
        cls
        call bun run scripts/manage-wallets.ts wizard-interactive
    ) else if "%wiz_mode%"=="2" (
        cls
        echo ===============================================================================
        echo     [+] BULK IMPORT PROXY / MULTI-ACCOUNT DARI FILE [+]
        echo ===============================================================================
        echo.
        echo   Format yang didukung:
        echo     1. File .txt (1 proxy per baris: host:port:user:pass atau host:port)
        echo     2. File .csv (dengan kolom: proxy, id, label, key, evm, solana)
        echo.
        set /p bulk_file="Masukkan path file sumber (.txt / .csv): "
        echo.
        call bun run scripts/manage-wallets.ts import-proxies "%bulk_file%"
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="9" (
    cls
    echo ===============================================================================
    echo     [+] DIAGNOSTIK KESEHATAN, LATENSI DAN AUTO-FAILOVER PROXY [+]
    echo ===============================================================================
    echo.
    echo   PILIH MODE DIAGNOSTIK:
    echo.
    echo   [1] Uji Latensi DAN Kesehatan Semua Proxy (Diagnostik Cepat)
    echo   [2] Uji Kesehatan + Auto-Failover (Otomatis Alihkan Rute yang Down)
    echo   [3] Jalankan Monitor Daemon di Background (Pemantauan Berkala)
    echo   [4] Karantina / Bersihkan Proxy Mati (Auto-Prune Dead Proxies)
    echo   [5] Uji & Pulihkan Proxy Karantina (--probe-quarantined)
    echo   [6] Sinkronisasi Otomatis dari Webshare Proxy API (Auto-Sync)
    echo   [7] Ganti Otomatis Proxy Flapping via Webshare Replacement API
    echo   [8] Kembali ke Menu Utama
    echo.
    set /p diag_mode="Masukkan pilihan Anda [1-8]: "
    if "%diag_mode%"=="1" (
        cls
        call bun run scripts/manage-wallets.ts test-proxies
    ) else if "%diag_mode%"=="2" (
        cls
        call bun run scripts/manage-wallets.ts recheck-proxies --auto-failover
    ) else if "%diag_mode%"=="3" (
        cls
        echo Memulai Daemon Pemantau Proxy (Interval: 15 menit)...
        call bun run scripts/manage-wallets.ts recheck-proxies --daemon --interval 15 --auto-failover
    ) else if "%diag_mode%"=="4" (
        cls
        echo ===============================================================================
        echo     [+] BERSIHKAN / KARANTINA PROXY MATI (AUTO-PRUNE) [+]
        echo ===============================================================================
        echo.
        echo   [1] Karantina Soft (DISABLED) - Proxy mati ^> 24 jam dinonaktifkan
        echo   [2] Simulasi Karantina (--dry-run) - Cek daftar tanpa mengubah database
        echo   [3] Karantina Semua Proxy Mati Langsung (--all-dead)
        echo   [4] Hapus Permanen dari Database (--hard-delete)
        echo.
        set /p prune_mode="Pilih mode pembersihan [1-4]: "
        if "%prune_mode%"=="1" (
            call bun run scripts/manage-wallets.ts prune-proxies
        ) else if "%prune_mode%"=="2" (
            call bun run scripts/manage-wallets.ts prune-proxies --dry-run
        ) else if "%prune_mode%"=="3" (
            call bun run scripts/manage-wallets.ts prune-proxies --all-dead
        ) else if "%prune_mode%"=="4" (
            call bun run scripts/manage-wallets.ts prune-proxies --hard-delete
        )
    ) else if "%diag_mode%"=="5" (
        cls
        echo Menguji proxy yang berstatus DISABLED untuk memulihkan yang sudah sehat kembali...
        call bun run scripts/manage-wallets.ts recheck-proxies --probe-quarantined --auto-failover
    ) else if "%diag_mode%"=="6" (
        cls
        echo ===============================================================================
        echo     [+] SINKRONISASI WEBSHARE PROXY API (AUTO-SYNC) [+]
        echo ===============================================================================
        echo.
        echo   [1] Sync Otomatis (Gunakan WEBSHARE_API_KEY dari .env) + Auto-Bind
        echo   [2] Masukkan API Token Webshare Baru / Manual
        echo.
        set /p ws_mode="Pilih opsi [1/2]: "
        echo.
        if "%ws_mode%"=="2" (
            set /p ws_key="Masukkan Webshare API Token: "
            call bun run scripts/manage-wallets.ts sync-webshare --api-key %ws_key% --auto-bind --broadcast
        ) else (
            call bun run scripts/manage-wallets.ts sync-webshare --auto-bind --broadcast
        )
    ) else if "%diag_mode%"=="7" (
        cls
        echo ===============================================================================
        echo     [+] GANTI OTOMATIS PROXY FLAPPING (WEBSHARE REPLACEMENT) [+]
        echo ===============================================================================
        echo.
        echo   Memindai proxy yang mengalami flapping (>= 3 kegagalan dalam 24 jam)
        echo   dan meminta alokasi IP baru ke Webshare Replacement API...
        echo.
        call bun run scripts/manage-wallets.ts replace-flapping --broadcast
    )
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="10" (
    cls
    echo ===============================================================================
    echo     [+] BIND RUTE WALLET KE PROXY [+]
    echo ===============================================================================
    echo.
    set /p b_wallet="Masukkan ID Wallet: "
    set /p b_proxy="Masukkan ID Proxy: "
    echo.
    call bun run scripts/manage-wallets.ts bind-route %b_wallet% %b_proxy% bankr
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="11" (
    cls
    call SET_BANKR_KEY.bat
    goto menu
)

if "%w_choice%"=="12" (
    cls
    call GENERATE_MULTI_WALLETS.bat
    goto menu
)

if "%w_choice%"=="13" (
    cls
    call bun run scripts/audit-clean-funding.ts
    echo.
    echo -------------------------------------------------------------------------------
    echo   Tekan tombol apa saja untuk kembali...
    pause >nul
    goto menu
)

if "%w_choice%"=="14" (
    exit /b 0
)

exit /b 0
