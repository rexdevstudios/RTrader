# Rekomendasi Lanjutan SocialFi: On-Chain Bounty Merkle Claim, Twitter/X Verification, & Paper Trading Sandbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan 3 Rekomendasi Lanjutan strategis dari Blueprint SocialFi:
1. **On-Chain Merkle Bounty Claim:** Klaim token reward promosi KOL secara on-chain dan gas-efisien di `BondingCurveLaunchpad.sol` berbasis cryptographic Merkle proof.
2. **Twitter/X Attestation & Verification:** Verifikasi kepemilikan akun Twitter/X secara kriptografis (OAuth PKCE & EIP-712/Signature attestation) untuk mencegah *spoofing* identitas KOL.
3. **Paper Trading Sandbox Token Integration:** Menghubungkan token *bonding curve* ke Paper Trading terminal dan menyematkan *Token Nutrition Label* agar investor/buyer dapat menguji coba token secara 100% aman dan bebas risiko (*zero-capital risk*).

**Architecture:** 
- Smart Contract: Penambahan `bountyMerkleRoots` & fungsi `claimBountyReward` di `BondingCurveLaunchpad.sol`.
- Control Plane (Next.js / Vercel): API stateless di `/api/kol/*`, `/api/social/*`, dan `/api/launchpad/bounty/*`.
- Intelligence & Security: Reuse `ArkhamIntelligenceService`, `FirecrawlScraperService`, dan `TradingRiskGate`.
- Client UI: Portal 4-Tab `app/kol/page.tsx` + integrasi token Launchpad dan `NutritionLabelCard` di `app/trading/page.tsx`.

**Tech Stack:** Solidity 0.8.20, Next.js 14/15 App Router, TypeScript, Ethers.js v6, Tailwind CSS, Lucide Icons, Arkham Intelligence API adapter.

---

## User Review Required

> [!IMPORTANT]
> - **Smart Contract Immutability & Backward Compatibility:** Fungsi yang sudah ada (`buyTokens`, `buyWhitelistTokens`, `buyTokensWithReferral`) tidak mengalami breaking change. Penambahan `claimBountyReward` bersifat murni aditif.
> - **Non-Custodial Guarantee:** Penyetelan `bountyMerkleRoot` dan pencairan reward dilakukan secara terdesentralisasi; Vercel tidak pernah memegang *private key* atau dana pengguna.
> - **Anti-Double-Claim Protection:** Smart contract mencatat `hasClaimedBounty[tokenAddress][kolWallet]` untuk memastikan tiap KOL hanya dapat mengklaim reward 1 kali per kampanye/epoch.

---

## Open Questions

> [!NOTE]
> Tidak ada ambiguitas arsitektur. Rencana ini mengadopsi struktur modular yang selaras 100% dengan `AGENTS.md`, `ADR-001` (Control Plane Isolation), dan `ADR-003` (Postgres SSOT).

---

## Proposed Changes

Group files by component and dependency order:

### 1. Smart Contracts (`contracts/launchpad/`)

#### [MODIFY] [BondingCurveLaunchpad.sol](file:///c:/Users/a/Downloads/Blockchain/contracts/launchpad/BondingCurveLaunchpad.sol)
- Menambahkan state variable:
  ```solidity
  mapping(address => bytes32) public bountyMerkleRoots;
  mapping(address => mapping(address => bool)) public hasClaimedBounty;
  ```
- Menambahkan event:
  ```solidity
  event BountyRewardClaimed(address indexed tokenAddress, address indexed kolWallet, uint256 amountTokens);
  event BountyMerkleRootSet(address indexed tokenAddress, bytes32 newRoot);
  ```
- Menambahkan fungsi `setBountyMerkleRoot(address tokenAddress, bytes32 newRoot) external;`
- Menambahkan fungsi `claimBountyReward(address tokenAddress, uint256 tokenAmount, bytes32[] calldata merkleProof) external nonReentrant;`

---

### 2. Service & Business Logic Layer (`packages/`)

#### [MODIFY] [bounty-escrow.ts](file:///c:/Users/a/Downloads/Blockchain/packages/launchpad/bounty-escrow.ts)
- Menambahkan static method `generateBountyMerkleTree(claims: Array<{ walletAddress: string; tokenAmount: bigint }>)` untuk menghitung Merkle root dan proof klaim bounty.

#### [MODIFY] [kol-service.ts](file:///c:/Users/a/Downloads/Blockchain/packages/social/kol-service.ts)
- Menambahkan validasi attestation kriptografis sosial `verifySocialAttestation(wallet: string, twitterHandle: string, signature: string)`.
- Menambahkan helper generator OAuth PKCE dengan *graceful fallback* saat environment Twitter unconfigured.

---

### 3. Serverless API Endpoints (`app/api/`)

#### [NEW] [route.ts](file:///c:/Users/a/Downloads/Blockchain/app/api/kol/profile/route.ts)
- `GET /api/kol/profile`: Mengambil profil KOL & skor reputasi.
- `POST /api/kol/profile`: Mendaftarkan profil KOL dengan kalkulasi Arkham Trust Score.

#### [NEW] [route.ts](file:///c:/Users/a/Downloads/Blockchain/app/api/social/verify-twitter/route.ts)
- `POST /api/social/verify-twitter`: Menautkan handle Twitter ke wallet address dengan validasi attestation sosial.

#### [NEW] [route.ts](file:///c:/Users/a/Downloads/Blockchain/app/api/launchpad/bounty/route.ts)
- `GET /api/launchpad/bounty`: Mengambil daftar kampanye promosi aktif.
- `POST /api/launchpad/bounty`: Membuat kampanye promosi baru untuk token deployer.

#### [NEW] [route.ts](file:///c:/Users/a/Downloads/Blockchain/app/api/launchpad/bounty/claim/route.ts)
- `GET /api/launchpad/bounty/claim`: Mengambil Merkle proof on-chain untuk alamat dompet KOL.
- `POST /api/launchpad/bounty/claim`: Mengirim URL bukti tweet dan verifikasi otomatis hashtag via scraper.

---

### 4. User Interface Layer (`app/`)

#### [NEW] [page.tsx](file:///c:/Users/a/Downloads/Blockchain/app/kol/page.tsx)
- Halaman portal SocialFi lengkap dengan 4 tab:
  1. **KOL Passport:** Tampilan Trust Score Arkham, badge verifikasi, tier reputasi (Bronze/Silver/Gold).
  2. **Bounties Marketplace:** Daftar task promosi token, nominal reward, syarat minimum follower, dan sisa slot.
  3. **Submit Proof & Claim:** Form submission tweet bukti dengan verifikasi instan dan tombol klaim on-chain.
  4. **Creator Escrow Manager:** Dashboard untuk token creator mengunci reward bounty dan menetapkan Merkle root.

#### [MODIFY] [page.tsx](file:///c:/Users/a/Downloads/Blockchain/app/trading/page.tsx)
- Menambahkan opsi pasangan token Bonding Curve (`MOON/ETH`, `PEOPLE/ETH`, `CDAO/ETH`) di dropdown pasangan mata uang.
- Menampilkan komponen [`NutritionLabelCard`](file:///c:/Users/a/Downloads/Blockchain/app/components/NutritionLabelCard.tsx) di panel trading untuk evaluasi risiko investor.
- Menghubungkan eksekusi Paper Trading (`stage: 'PAPER'`) dengan formula harga bonding curve tanpa risiko modal riil.

#### [MODIFY] [HeaderNav.tsx](file:///c:/Users/a/Downloads/Blockchain/app/components/HeaderNav.tsx)
- Menambahkan tautan navigasi `👑 KOL Hub` (`/kol`).
- Menambahkan opsi `KOL` di tombol *Switch Role*.

---

### 5. Automated Tests & Simulations (`scripts/`)

#### [NEW] [test-next-phase-simulation.ts](file:///c:/Users/a/Downloads/Blockchain/scripts/test-next-phase-simulation.ts)
- Menguji 3 pilar rekomendasi lanjutan:
  1. Kalkulasi Merkle Root & Proof untuk on-chain bounty reward claim.
  2. Verifikasi attestation sosial Twitter/X & reputasi Arkham.
  3. Simulasi Paper Trading token bonding curve dengan pemeriksaan Nutrition Label.

---

## Verification Plan

### Automated Tests
1. **Next-Phase Simulation Test:**
   ```bash
   npx tsx scripts/test-next-phase-simulation.ts
   ```
   *Expected:* Exit code 0, semua assertions lolos.

2. **All 5 Test Suites (Zero-Regression):**
   ```bash
   npx tsx scripts/test-simulation.ts && npx tsx scripts/test-socialfi-simulation.ts && npx tsx scripts/test-launch-modes-simulation.ts && npx tsx scripts/test-angel-pipeline-simulation.ts && npx tsx scripts/test-next-phase-simulation.ts
   ```
   *Expected:* Kelima suite simulasi selesai dengan exit code 0.

3. **TypeScript Static Check:**
   ```bash
   npx tsc --noEmit
   ```
   *Expected:* 0 errors.

### Manual Verification
- Navigasi ke `/kol`: Memeriksa 4 tab (Passport, Marketplace, Proof Claim, Creator Manager).
- Navigasi ke `/trading`: Memilih token bonding curve, memeriksa kemunculan Nutrition Label Card, dan mengeksekusi simulasi Paper Trade.

---

## Rekomendasi Lanjutan Masa Depan (Future Scaling Recommendations)

1. **AI Automated Bounty Auditor:** Memanfaatkan model AI untuk mendeteksi spam tweet, engagement palsu (bot likes/retweets), dan sentimen negatif secara otomatis sebelum verifikasi disetujui.
2. **LayerZero Cross-Chain KOL Claims:** Mengizinkan KOL mengklaim reward bounty mereka di chain mana pun (misal: Arbitrum atau Polygon) meskipun token diluncurkan di Base Mainnet.
3. **Decentralized Time-Lock Liquidity Vault:** Mengintegrasikan smart contract escrow lock multi-sig untuk menjamin dana likuiditas bonding curve terkunci minimal 6-12 bulan setelah kelulusan ke DEX.
