# Future Scaling Roadmap: AI Tweet Quality Gate, LayerZero Cross-Chain Claim, & 6-Month Liquidity Time-Lock Vault

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan 3 inovasi strategis dari Future Scaling Roadmap untuk memperkuat platform RTrader SocialFi:
1. **Automated AI Tweet Quality & Sentiment Scorer:** Menyaring tweet promosi KOL secara cerdas sebelum bounty disetujui, mendeteksi spam/bot engagement, copy-paste berbobot rendah, dan sentimen negatif/FUD.
2. **LayerZero Cross-Chain Claim Adapter Interface:** Memungkinkan KOL mengklaim alokasi token bounty mereka langsung ke chain EVM tujuan (Arbitrum, Optimism, Base) dengan efisiensi gas.
3. **Decentralized 6-Month Liquidity Time-Lock Vault:** Mengunci likuiditas secara otomatis di smart contract `BondingCurveLaunchpad.sol` selama minimal 180 hari saat token lulus bonding curve, memberikan garansi anti-rugpull 100% pada Token Nutrition Label.

**Architecture:** 
- Smart Contract: Penambahan `liquidityUnlockTimestamps`, `MIN_LOCK_DURATION`, dan `claimBountyRewardCrossChain` di `BondingCurveLaunchpad.sol`.
- Intelligence Engine: `packages/intelligence/tweet-quality-scorer.ts` terintegrasi dengan `BountyEscrowService`.
- Cross-Chain Layer: `packages/launchpad/cross-chain-claim-adapter.ts` dengan standar LayerZero v2 Endpoint ID.
- UI & Safety: Indikator Time-Lock Vault pada `NutritionLabelCard` dan integrasi audit skor AI pada halaman `/kol`.

**Tech Stack:** Solidity 0.8.20, Next.js 14/15 App Router, TypeScript, Ethers.js v6, Tailwind CSS, Lucide Icons, LayerZero v2 Standard.

---

## User Review Required

> [!IMPORTANT]
> - **Zero Breaking Changes on Existing Smart Contract Functions:** Fungsi `buyTokens`, `buyWhitelistTokens`, `buyTokensWithReferral`, dan `claimBountyReward` yang sudah lulus verifikasi tetap 100% kompatibel tanpa modifikasi signature.
> - **Anti-Rugpull 180-Day Liquidity Invariant:** Likuiditas yang terkumpul saat token mencapai `graduationThresholdWei` tidak dapat ditarik oleh deployer mana pun sebelum masa `MIN_LOCK_DURATION` (180 hari) berlalu.
> - **Sybil & Spam Prevention:** Klaim bounty kini mewajibkan `passedQualityGate === true` (skor AI >= 65 dan sentimen non-negatif) untuk mencegah eksploitasi reward oleh bot farm.

---

## Open Questions

> [!NOTE]
> Seluruh arsitektur mematuhi `AGENTS.md`, `ADR-001` (Control Plane Isolation), dan `ADR-003` (Postgres SSOT). Tidak ada ambiguitas dalam spesifikasi ini.

---

## Proposed Changes

Group files by component and dependency order:

### 1. Smart Contracts (`contracts/launchpad/`)

#### [MODIFY] [BondingCurveLaunchpad.sol](file:///c:/Users/a/Downloads/Blockchain/contracts/launchpad/BondingCurveLaunchpad.sol)
- Menambahkan konstanta waktu penguncian likuiditas minimum:
  ```solidity
  uint256 public constant MIN_LOCK_DURATION = 180 days;
  ```
- Menambahkan state mapping:
  ```solidity
  mapping(address => uint256) public liquidityUnlockTimestamps;
  ```
- Menambahkan event:
  ```solidity
  event LiquidityTimeLocked(address indexed tokenAddress, uint256 unlockTimestamp, uint256 lockedAmountWei);
  event CrossChainBountyClaimInitiated(address indexed tokenAddress, address indexed kolWallet, uint32 dstEid, bytes32 recipientOnDst, uint256 tokenAmount);
  ```
- Memodifikasi mekanisme kelulusan di `buyTokens` & `buyTokensWithReferral` untuk otomatis menetapkan `liquidityUnlockTimestamps[tokenAddress] = block.timestamp + MIN_LOCK_DURATION` dan meng-emit `LiquidityTimeLocked`.
- Menambahkan fungsi `getLiquidityLockInfo(address tokenAddress) external view returns (bool isLocked, uint256 unlockTimestamp, uint256 timeRemaining);`
- Menambahkan fungsi `releaseGraduatedLiquidity(address tokenAddress) external nonReentrant;`
- Menambahkan fungsi aditif `claimBountyRewardCrossChain(address tokenAddress, uint256 tokenAmount, bytes32[] calldata merkleProof, uint32 dstEid, bytes32 recipientOnDst) external payable nonReentrant;`

---

### 2. Service & Intelligence Layer (`packages/`)

#### [NEW] [tweet-quality-scorer.ts](file:///c:/Users/a/Downloads/Blockchain/packages/intelligence/tweet-quality-scorer.ts)
- Engine analisis teks tweet cerdas yang mengevaluasi:
  - Kelayakan panjang konten promosi.
  - Keberadaan hashtag resmi kampanye.
  - Deteksi kata kunci spam / bot / phishing.
  - Analisis sentimen (Positive/Neutral/Negative).
  - Mengembalikan `TweetQualityAuditResult` dengan `qualityScore` (0–100) dan `passedQualityGate`.

#### [MODIFY] [bounty-escrow.ts](file:///c:/Users/a/Downloads/Blockchain/packages/launchpad/bounty-escrow.ts)
- Mengintegrasikan `TweetQualityScorer` ke dalam alur `submitAndVerifyClaim`.
- Menolak klaim tweet berkualitas rendah, spam, atau bermuatan FUD sebelum menyetujui klaim.

#### [NEW] [cross-chain-claim-adapter.ts](file:///c:/Users/a/Downloads/Blockchain/packages/launchpad/cross-chain-claim-adapter.ts)
- Adapter LayerZero v2 yang menyediakan:
  - Mapping Endpoint ID (Base = 30184, Arbitrum = 30110, Optimism = 30111).
  - Helper encoding payload pesan lintas chain.
  - Estimasi biaya gas lintas rantai secara stateless.

#### [MODIFY] [nutrition-label.ts](file:///c:/Users/a/Downloads/Blockchain/packages/intelligence/nutrition-label.ts)
- Memasukkan parameter `unlockTimestamp` pada kalkulasi `computeTokenRiskLabel`.
- Memberikan badge reputasi "🔒 100% Time-Locked Liquidity (180 Days)" pada token yang telah mengunci likuiditas.

---

### 3. Serverless API Endpoints (`app/api/`)

#### [NEW] [route.ts](file:///c:/Users/a/Downloads/Blockchain/app/api/launchpad/cross-chain-quote/route.ts)
- `GET /api/launchpad/cross-chain-quote?dstEid=...&tokenAmount=...`: Mengembalikan estimasi gas dan format payload pesan LayerZero.

#### [MODIFY] [route.ts](file:///c:/Users/a/Downloads/Blockchain/app/api/launchpad/bounty/claim/route.ts)
- Menyertakan skor kualitas tweet dan alasan audit AI pada respon submission klaim.

---

### 4. UI Layer (`app/`)

#### [MODIFY] [NutritionLabelCard.tsx](file:///c:/Users/a/Downloads/Blockchain/app/components/NutritionLabelCard.tsx)
- Menampilkan indikator visual gembok waktu "🔒 Time-Locked Liquidity (180 Hari)" saat likuiditas terkunci di vault.

#### [MODIFY] [page.tsx](file:///c:/Users/a/Downloads/Blockchain/app/kol/page.tsx)
- Menampilkan kartu hasil audit AI (*Tweet Quality Score* & *Sentiment Breakdown*) setelah KOL mengirimkan bukti tweet.
- Menambahkan tombol pilihan klaim lintas rantai ("Klaim ke Arbitrum/Optimism via LayerZero").

---

### 5. Automated Tests & Simulations (`scripts/`)

#### [NEW] [test-future-scaling-simulation.ts](file:///c:/Users/a/Downloads/Blockchain/scripts/test-future-scaling-simulation.ts)
- Menguji secara komprehensif:
  1. *AI Tweet Quality Gate:* Verifikasi tweet berkualitas tinggi lulus, sedangkan tweet spam atau bermuatan FUD ditolak dengan alasan yang tepat.
  2. *Cross-Chain Claim Adapter:* Validasi enkripsi payload LayerZero v2 dan kalkulasi estimasi fee.
  3. *Time-Lock Vault on-chain:* Pengujian lock timestamp 180 hari saat kelulusan bonding curve dan dampaknya pada Nutrition Label Score.

---

## Bite-Sized Action Steps & To-Do List

- [ ] **Task 1: Smart Contract Upgrade (`BondingCurveLaunchpad.sol`)**
  - Tambahkan `MIN_LOCK_DURATION` (180 hari) dan mapping `liquidityUnlockTimestamps`.
  - Pasang trigger `LiquidityTimeLocked` pada kelulusan bonding curve di `buyTokens` & `buyTokensWithReferral`.
  - Tambahkan fungsi `getLiquidityLockInfo`, `releaseGraduatedLiquidity`, dan `claimBountyRewardCrossChain`.

- [ ] **Task 2: AI Tweet Quality & Sentiment Scorer (`packages/intelligence/`)**
  - Buat `packages/intelligence/tweet-quality-scorer.ts`.
  - Sambungkan ke `packages/launchpad/bounty-escrow.ts` pada method `submitAndVerifyClaim`.

- [ ] **Task 3: LayerZero Cross-Chain Claim Adapter (`packages/launchpad/`)**
  - Buat `packages/launchpad/cross-chain-claim-adapter.ts`.
  - Buat API route `app/api/launchpad/cross-chain-quote/route.ts`.

- [ ] **Task 4: Nutrition Label Time-Lock & UI Enhancements**
  - Modifikasi `packages/intelligence/nutrition-label.ts` untuk memproses status time-lock vault.
  - Modifikasi `app/components/NutritionLabelCard.tsx` untuk menampilkan badge vault time-lock.
  - Modifikasi `app/kol/page.tsx` untuk menampilkan scorecard audit AI tweet dan opsi klaim lintas rantai.

- [ ] **Task 5: End-to-End Simulation & Zero-Regression Verification**
  - Buat `scripts/test-future-scaling-simulation.ts`.
  - Jalankan seluruh 6 simulation suite platform:
    `npx tsx scripts/test-simulation.ts && npx tsx scripts/test-socialfi-simulation.ts && npx tsx scripts/test-launch-modes-simulation.ts && npx tsx scripts/test-angel-pipeline-simulation.ts && npx tsx scripts/test-next-phase-simulation.ts && npx tsx scripts/test-future-scaling-simulation.ts`
  - Jalankan `npx tsc --noEmit` untuk validasi tipe kompilasi statis.
  - Commit hasil kerja ke git.

---

## Verification Plan

### Automated Tests
1. **Future Scaling Simulation Test:**
   ```bash
   npx tsx scripts/test-future-scaling-simulation.ts
   ```
   *Expected:* Exit code 0, 3 pilar simulasi lulus.

2. **Semua 6 Test Suite (Zero-Regression):**
   ```bash
   npx tsx scripts/test-simulation.ts && npx tsx scripts/test-socialfi-simulation.ts && npx tsx scripts/test-launch-modes-simulation.ts && npx tsx scripts/test-angel-pipeline-simulation.ts && npx tsx scripts/test-next-phase-simulation.ts && npx tsx scripts/test-future-scaling-simulation.ts
   ```
   *Expected:* Keliling 6 suite simulasi lulus tanpa regresi.

3. **TypeScript Static Typecheck:**
   ```bash
   npx tsc --noEmit
   ```
   *Expected:* 0 errors.

---

## Rekomendasi Lanjutan Masa Depan (Final Vision)

1. **ERC-4337 Account Abstraction Paymaster:** Membebaskan biaya gas untuk KOL pemula saat pertama kali mengeklaim alokasi bounty.
2. **DeFi Yield Staking for Locked Liquidity:** Memasukkan ETH yang terkunci di Time-Lock Vault ke liquid staking (misal: Lido wstETH) agar menghasilkan yield tambahan bagi platform treasury selama masa lock 180 hari.
3. **Decentralized Reputation Graph (Farcaster + Lens Protocol):** Menggabungkan reputasi Farcaster Social Graph ke dalam kalkulasi Trust Passport KOL.
