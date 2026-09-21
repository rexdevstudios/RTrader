# 🚀 Omnichain Auto Viral Meme Deployer & Safe Launch Engine

Bot AI otonom kelas produksi untuk mendeteksi tren viral, memvalidasi keamanan parameter token (*anti-rug* & *scanner-ready*), men-deploy token meme secara terdesentralisasi ke blockchain (Base Mainnet & Solana), serta mengeksekusi *controlled snipe* atau *100% fair launch* berbiaya Rp 0.

---

## 📁 Struktur Proyek

```
BOT-Deploy-Multi-Chain/
├── src/
│   ├── index.ts                    ← Orchestrator utama & cron pipeline
│   ├── config.ts                   ← Validasi environment variables (Zod)
│   ├── logger.ts                   ← Logger terpusat ANSI warna & file stream
│   ├── db/
│   │   └── vault.ts                ← SQLite: vault akun, rute proxy, log deploy, posisi PnL
│   └── modules/
│       ├── trend/firecrawl-radar.ts   ← Radar tren viral (Firecrawl API)
│       ├── ai/gemini-brain.ts         ← AI prompt generator (Google Gemini / ByteDance Ark)
│       ├── image/pollinations-gen.ts  ← Logo meme generator (Pollinations AI)
│       ├── ipfs/pinata-uploader.ts    ← Pinning IPFS & metadata (Pinata)
│       ├── deploy-guard.ts            ← Verifikasi safety scanner & ekstraksi CA deterministik
│       ├── evm/bankr-deployer.ts      ← Token launch Base (100% sponsored gas via Bankr)
│       ├── solana/pumpfun-deployer.ts ← Token launch Solana (Pump.fun API)
│       ├── sniper/basedbot-sniper.ts  ← Multi-account sniper & Doppler anti-whale clamp
│       ├── reconciliation/            ← On-chain verifier & PnL accounting
│       └── treasury/                  ← Monitoring & auto-claim 95% WETH creator fees
├── scripts/
│   ├── execute-single-base-deployment.ts ← Skrip deploy 1 token terarah ke Base
│   ├── manage-wallets.ts          ← CLI manajemen wallet operator & proxy
│   ├── simulate-option-a.ts       ← Simulasi end-to-end mode testnet
│   └── verify-creator-fee-status.ts ← Audit on-chain creator fee $PUMPRUN
├── .env                           ← Kunci API & konfigurasi (RAHASIA!)
├── .eliza/vault.db                ← Database SQLite lokal
└── logs/bot.log                   ← Riwayat log lengkap sistem
```

---

## ⚡ Dua Mode Operasional Utama

### 1. 🟢 Mode Modal Rp 0 (Zero-Capital Community Fair Launch)
Sangat cocok saat tidak ingin mengeluarkan modal pribadi untuk buy order:
- **Biaya Gas Deploy**: 100% Gratis (disponsori oleh Bankr Relayer).
- **Snipe Buy**: Dilewati (`SNIPER_ENABLED=false`).
- **Alamat Kontrak (CA)**: Ditampilkan di konsol bersama templat Telegram siap salin (*copy-paste*) untuk langsung dibagikan sebagai *Early Access* ke komunitas Anda.
- **Keuntungan**: Saat anggota komunitas atau publik melakukan swap beli di Uniswap/DexScreener, Anda otomatis memanen **95% Creator Fee WETH** langsung ke wallet Anda.

```env
# Konfigurasi di .env:
DEPLOY_MODE=mainnet
ACTIVE_CHAINS=base
BANKR_REQUIRE_GAS_SPONSORSHIP=true
SNIPER_ENABLED=false
SNIPE_AMOUNT_ETH=0
```

### 2. 🟣 Mode Mikro-Snipe Multi-Wallet (Beli Awal + Audit Rick Bot Hijau)
Jika ingin BasedBot membeli sedikit untuk membentuk *candle* hijau pembuka di chart:
- Memecah alokasi beli ke `SNIPE_WALLET_COUNT` sub-wallet.
- Membatasi pembelian per wallet $< 1.8\%$ pasokan (Doppler anti-whale clamp).
- Memberikan jeda waktu 300ms mikro-jitter antar order.
- Lolos audit scanner publik (*Rick Bot / TTF Bot*): Top Holders terdesentralisasi (`TH: 1.5% · 1.2% · 1.0%`).

```env
# Konfigurasi di .env:
DEPLOY_MODE=mainnet
ACTIVE_CHAINS=base
BANKR_REQUIRE_GAS_SPONSORSHIP=true
SNIPER_ENABLED=true
SNIPE_AMOUNT_ETH=0.003
SNIPE_WALLET_COUNT=3
```

---

## 🚀 Panduan Menjalankan

### A. Uji Coba Simulasi Testnet (Rekomendasi Sebelum Mainnet)
Jalankan simulasi tanpa gas riil:
```bash
bun run scripts/simulate-option-a.ts
```

### B. Deploy 1 Token Terarah ke Base Mainnet (Controlled Single-Shot)
Deploy tepat satu token meme ke Base Mainnet dengan verifikasi keamanan lengkap:
```bash
bun run scripts/execute-single-base-deployment.ts
```

### C. Jalankan Bot Penuh (Cron Scheduler Otomatis)
Menjalankan bot secara terus menerus sesuai interval di `.env`:
```bash
bun run start
```

### D. Manajemen Multi-Wallet & Proxy
Melihat dan mengatur akun wallet operator:
```bash
bun run wallet:manage list
bun run wallet:manage add-wallet sub1 "BasedBot Wallet 1" <evmAddress>
```

---

## 🛡️ Jaminan Keamanan & Audit

- **Audit Kontrak Otomatis**: Kontrak Bankr adalah clone minimal proxy EIP-1167 dari master ter-audit. Bersifat *renounced by design* (0% tax, no mint function, unruggable liquidity).
- **Pre-Flight Safety Check**: Memvalidasi kelengkapan nama, ticker, deskripsi, dan media sosial sebelum broadcast on-chain.
- **Predictive CA**: Mengetahui alamat kontrak (CA) dan Pool ID lebih awal sebelum siaran transaksi ke jaringan.
- **Fail-Closed Relayer**: Jika sponsor gas relayer tidak tersedia, bot otomatis membatalkan siklus tanpa menyedot saldo ETH dompet Anda.
- **Zero Regression**: 581/581 tests lulus 100% pada suite pengujian (`bun test`).
