# DexScreener Token Profile Update & Volume Activation Playbook: $PUMPRUN

Dokumen ini memuat data isian resmi dan panduan taktis untuk memperbarui profil token **$PUMPRUN (Pump Hill Runner)** di DexScreener serta langkah-langkah aktivasi likuiditas dan volume trading on-chain.

---

## 1. Data Siap Salin untuk Form Update DexScreener

Saat mengajukan update di [DexScreener Marketplace](https://marketplace.dexscreener.com/product/token-info/order?chainId=base&tokenAddress=0x0a99f4251A461e8abC693a56BB837fD815D51BA3) atau mengklik tombol **"Update Token Info"** di halaman chart token:

| Kolom Form DexScreener | Nilai yang Harus Diisi (Copy-Paste) | Keterangan |
| :--- | :--- | :--- |
| **Chain** | `Base` | L2 Ethereum by Coinbase |
| **Token Address** | `0x0a99f4251A461e8abC693a56BB837fD815D51BA3` | Contract token terverifikasi on-chain |
| **Pair / Pool Address** | `0x645d579d8002a6ac09d67c59526d065321b07570b1d9f359a70346c072ca7584` | Pool Uniswap v4 (Doppler Hook) resmi |
| **Token Name** | `Pump Hill Runner` | Nama resmi |
| **Token Symbol** | `PUMPRUN` | Ticker |
| **Project Website** | `https://pumprun-web3.pages.dev` | DApp Web3 resmi |
| **Twitter / X** | `https://x.com/PUMPRUN_coin` | Link anonim token-centric (opsional jika ada) |
| **Telegram Portal** | `https://t.me/pumprun_portal` | Link grup / channel komunitas (opsional jika ada) |
| **Block Explorer** | `https://basescan.org/token/0x0a99f4251A461e8abC693a56BB837fD815D51BA3` | BaseScan contract URL |
| **Logo / Icon** | `sites/pumprun/dexscreener-icon.png` | Berkas lokal 500x500 PNG (1:1) |
| **Header Banner** | `sites/pumprun/dexscreener-header.png` | Berkas lokal 1500x500 PNG (3:1) |

### Description / Bio Singkat (Tanpa URL):
```text
Pump Hill Runner ($PUMPRUN) is the autonomous green runner on Base Mainnet. Features 0% trading tax, 30% perpetual auto buyback & burn, and 20% passive native dividends powered by Doppler Protocol.
```

---

## 2. Status Penautan Ekosistem

Token `$PUMPRUN` aktif dan terindeks di Base Mainnet:
- **Token Name**: `Pump Hill Runner`
- **Ticker**: `PUMPRUN`
- **Token Address**: `0x0a99f4251A461e8abC693a56BB837fD815D51BA3`
- **Doppler Web Terminal**: [https://app.doppler.lol/tokens/base/0x0a99f4251A461e8abC693a56BB837fD815D51BA3](https://app.doppler.lol/tokens/base/0x0a99f4251A461e8abC693a56BB837fD815D51BA3)

---

## 3. Taktik Aktivasi Volume & Visibilitas (Agar Token Dilirik Komunitas)

Meme token baru membutuhkan sinyal aktivitas awal (*green candles*) agar muncul di filter radar trader crypto seperti filter **"New Pairs"**, **"Gainers"**, dan **"Active Volumes"**.

### Taktik 1: Micro-Swaps & Initial Candlestick Creation
1. **Lakukan Swap Perdana (Micro-Buy)**:
   - Gunakan Uniswap di Base Mainnet untuk melakukan pembelian kecil ($2 - $10 ETH) ke contract `0x7CE19E4F978009EB644c27946B47221b824C0bA3`.
   - Hal ini akan menghasilkan candle hijau pertama di chart DexScreener dan mencatatkan volume awal.
2. **Efek Algoritmik DexScreener**:
   - Pasangan trading dengan transaksi aktif dalam 1-6 jam terakhir otomatis terindeks pada tab **"Trending"** dan **"Top Gainers Base"**.

### Taktik 2: Distribusi Konten & Alpha Calls (Anon Dev)
1. **Publikasikan Twitter Launch Thread**:
   - Gunakan materi tweet yang sudah disiapkan di `promotions/OFFER_PUMPRUN_BASE.md`.
   - Berikan hashtag relevan: `#Base #BaseMeme #CryptoAlpha #PumpRun #UniswapV3 #CoinbaseWallet`.
   - Sertakan link chart DexScreener resmi: `https://dexscreener.com/base/0x7CE19E4F978009EB644c27946B47221b824C0bA3`.
2. **Telegram Alpha Groups**:
   - Sebarkan template pengumuman Telegram ke grup komunitas degen Base dan bot call channels.

### Taktik 3: Pemanfaatan Auto-Buyback & Burn Flywheel
1. Setiap transaksi jual-beli di Uniswap v3 menghasilkan creator fees (WETH).
2. Fee tersebut dapat diklaim tanpa biaya gas melalui Bankr relayer (gas 100% sponsored di Base) dan dialokasikan untuk auto-buyback on-chain.

---

## 4. Keamanan & Jaminan Privasi Operator

- Seluruh tautan yang dipublikasikan bersifat **100% anonim** (`PUMPRUN_coin`, `pump-hill-runner`).
- Identitas pribadi operator tidak pernah dibocorkan ke on-chain contract, DexScreener, maupun metadata IPFS.
- Contract address telah berstatus renounced / immutable, bebas biaya tersembunyi (0% tax), dan aman dari indikator rug-pull.
