# Blueprint & Spesifikasi Desain: SocialFi Launchpad & KOL Hub (RTrader)

**Tanggal:** 2026-09-09  
**Status:** DRAFT (Menunggu Review User)  
**Target Platform:** Next.js (App Router) di Vercel + PostgreSQL (SSOT) + EVM Smart Contracts (`BondingCurveLaunchpad.sol`)

---

## 1. Ringkasan Eksekutif & North Star

Membangun lapisan sosial dan kepercayaan (*Trust & SocialFi Layer*) di atas platform **RTrader** yang mempertemukan:
1. **Token Deployer (Creator):** Meluncurkan token anti-rugpull secara instan via *bonding curve*, mengunci alokasi promosi di *smart contract*, dan merekrut KOL secara transparan.
2. **KOL (Key Opinion Leader / Influencer):** Membangun reputasi publik (*on-chain & off-chain*), mengerjakan *bounty marketing* (ala Warpcast/FOMO), dan menerima pembagian hasil (*revenue share / referral*) langsung ke dompet tanpa perantara.
3. **Investor / Buyer (Trader):** Berinvestasi dengan rasa aman berkat **"Nutrition Label" Risiko**, perlindungan *deterministic risk gate*, serta simulasi *paper trading*.
4. **Platform Treasury (Admin):** Menerima potongan *fee* peluncuran dan transaksi secara otomatis ke `ADMIN_WALLET_ADDRESS` tanpa menyimpan dana pengguna di server Vercel (*non-custodial*).

---

## 2. Arsitektur Sistem Modular (Vercel-Friendly)

Mengikuti prinsip `ADR-001` (Vercel sebagai *Control Plane Only*), seluruh beban transaksi keuangan dialihkan ke *Smart Contract*, sedangkan Vercel hanya menangani UI, API, dan integrasi sosial.

```
                  ┌──────────────────────────────────────────────────┐
                  │                 USER BROWSER                     │
                  │   (RainbowKit / Wagmi + Metamask / Phantom)       │
                  └───────────────┬──────────────────┬───────────────┘
                                  │                  │
                    Web3 Actions  │                  │  UI / Read / Social OAuth
                    (Client-Side) │                  │  (Server Actions)
                                  ▼                  ▼
┌───────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│          BLOCKCHAIN (EVM)             │   │       CONTROL PLANE (Next.js / Vercel)   │
│                                       │   │                                          │
│  - BondingCurveLaunchpad.sol          │   │  - NextAuth.js (X/Twitter OAuth)         │
│  - Auto-Lock Liquidity Pool           │   │  - Edge Middleware (Stateless Auth & RBAC)│
│  - Marketing Bounty Escrow            │   │  - AI Nutrition Label Generator          │
│  - Non-Custodial Fee Splitter:        │   │  - Risk Gate UI Validator                │
│    ├── Platform (process.env.ADMIN)   │   │                                          │
│    ├── KOL Referral Share             │   └────────────────────┬─────────────────────┘
│    └── Creator Allocation             │                        │
└───────────────────────────────────────┘                        │ Queries / Prisma
                                                                 ▼
                                            ┌──────────────────────────────────────────┐
                                            │      OPERATIONAL SSOT (PostgreSQL)       │
                                            │                                          │
                                            │  - users & kol_profiles                  │
                                            │  - bounty_campaigns & claims             │
                                            │  - token_drafts & risk_passports         │
                                            │  - audit_logs & billing_ledgers          │
                                            └──────────────────────────────────────────┘
```

---

## 3. Spesifikasi Domain & Fitur Baru

### A. Domain Identitas & Sosial (`packages/auth/` & `packages/social/`)
*   **Web3 + Web2 Account Linking:** 
    *   Pengguna *login* menggunakan SIWE (Sign-In with Ethereum).
    *   Opsi menautkan akun X/Twitter via OAuth 2.0 (disimpan aman di tabel `kol_profiles`).
*   **KOL Trust & Passport Score:**
    *   Mengintegrasikan `ArkhamIntelligenceService` untuk memverifikasi dompet KOL terhadap riwayat *scam/exploit*.
    *   Menampilkan metrik: *Follower count*, *Account age*, *Completed Bounties*, dan *Reputation Tier* (Bronze, Silver, Gold).

### B. Domain Launchpad & Bounty Escrow (`packages/launchpad/` & `contracts/`)
*   **Template Kontrak Terkunci:**
    *   Deployer wajib memakai `BondingCurveLaunchpad.sol`.
    *   Fungsi cetak token sembarangan (*unlimited mint*) dinonaktifkan.
    *   Likuiditas otomatis dikunci saat mencapai target *market cap* kelulusan (ke Uniswap/PancakeSwap).
*   **Social Proof Marketing Bounty (Warpcast/FOMO Model):**
    *   Deployer menyisihkan sejumlah token/stablecoin ke dalam *bounty pool*.
    *   KOL memposting promosi dengan *hashtag* yang ditentukan di Twitter.
    *   KOL submit URL bukti di platform.
    *   Sistem memvalidasi keberadaan tweet menggunakan `FirecrawlScraper` / Twitter API.
    *   Setelah lolos validasi, *Smart Contract* mencairkan alokasi token ke dompet KOL dengan opsi *vesting* bertahap.

### C. Domain Perlindungan Investor (`packages/risk/` & `packages/intelligence/`)
*   **Token "Nutrition Label" Component:**
    *   Indikator visual risiko instan:
        *   🟢 **Hijau:** Kontrak terkunci, likuiditas aman, pembuat token memiliki reputasi terverifikasi.
        *   🟡 **Kuning:** Akun baru, belum ada riwayat promosi KOL ternama.
        *   🔴 **Merah:** Ditemukan anomali dompet oleh Arkham atau terdeteksi potensi honeypot.
*   **Deterministic Guardrails:**
    *   Membatasi maksimal pembelian (*Max Order Cap*) untuk mencegah *whale dumping*.
    *   Fitur simulasi *Paper Trading* agar pengguna baru bisa menguji strategi tanpa kehilangan aset nyata.

### D. Domain Treasury & Keuangan Platform (`packages/billing/`)
*   **Zero-Custody Vercel Architecture:**
    *   Vercel **TIDAK PERNAH** menyimpan *private key* atau menampung saldo dompet pengguna.
    *   Di Vercel hanya terdapat `ADMIN_WALLET_PUBLIC_ADDRESS`.
    *   Setiap kali ada transaksi di *bonding curve* atau *deployment*, potongan 1% langsung ditransfer oleh *smart contract* ke alamat tersebut di level *blockchain*.

---

## 4. Roadmap Tahapan Pengembangan (Phases)

| Fase | Fokus | Output Utama |
| :--- | :--- | :--- |
| **Fase 1 (MVP Foundation)** | Vercel Setup & Social Linking | • NextAuth Twitter OAuth terhubung dengan SIWE<br>• Tampilan Profil KOL & Deployer<br>• UI Launchpad memanggil `BondingCurveLaunchpad.sol` |
| **Fase 2 (Trust & Nutrition Label)** | Investor Safety UI | • Komponen "Nutrition Label" berbasis data onchain<br>• Filter anti-bot dan batas *slippage* di UI<br>• Integrasi Arkham Risk Passport di halaman token |
| **Fase 3 (SocialFi Bounty & Quests)** | Interaksi Kontrak KOL & Deployer | • Kontrak Escrow Bounty (deployer lock token untuk marketing)<br>• Automated Proof Verification (via API/Firecrawl)<br>• Klaim token otomatis untuk KOL |
| **Fase 4 (Scale & Expansion)** | Monetisasi & Advanced Features | • Angel Investor Deal Room (ronde privat sebelum bonding curve)<br>• Onchain Referral Fee Splitter otomatis<br>• Paper Trading Sandbox penuh |

---

## 5. Blueprint Aturan AI (Antigravity Rule)

Simpan aturan di bawah ini ke dalam file `AGENTS.md` atau `.agents/rules/socialfi-rules.md` di proyek Anda agar asisten AI Antigravity selalu mematuhi batasan arsitektur ini saat menulis kode di masa depan:

```markdown
# Antigravity System Rules for RTrader SocialFi Platform

## Core Principles
1. **Control Plane Isolation:** Next.js and Vercel are strictly for UI, Edge routing, and stateless APIs. Never implement long-running websockets or background workers inside Vercel functions.
2. **Postgres SSOT:** PostgreSQL is the single source of truth for all operational states (users, profiles, drafts, audit logs). Blockchain state is mirrored, not mutated directly.
3. **Non-Custodial Guarantee:** NEVER store private keys, seed phrases, or custody user funds in Vercel environment variables or database tables. The platform admin address in Vercel MUST BE a Public Address (`ADMIN_WALLET_PUBLIC_ADDRESS`) only.
4. **Smart Contract Immutability:** Token deployment must use audited factory templates (`BondingCurveLaunchpad.sol`). Never allow arbitrary unverified bytecode deployment.
5. **Deterministic Risk Gate:** Live trading and sensitive transactions must pass through `packages/trading/risk-gate.ts`. AI agents are strictly advisory/proposal-only and cannot bypass policy checks.
6. **KOL & Bounty Verification:** Off-chain social proofs (tweets, engagement) must be validated via verified APIs or scrapers before granting smart contract claim signatures.
```
