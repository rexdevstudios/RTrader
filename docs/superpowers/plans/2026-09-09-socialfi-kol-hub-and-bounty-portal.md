# SocialFi KOL Hub, Marketing Bounty Portal, & Buyer Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun antarmuka dan endpoint API terintegrasi untuk SocialFi KOL Hub, Marketing Bounty Portal, dan Buyer Protection Suite dengan verifikasi otomatis tweet proof via `FirecrawlScraperService` & `BountyEscrowService`, serta verifikasi reputasi KOL via `ArkhamIntelligenceService`, selaras dengan aturan Vercel Control Plane & Non-Custodial SSOT.

**Architecture:** Next.js App Router (Stateless Serverless APIs di `/api/kol/*` dan `/api/launchpad/bounty/*`), PostgreSQL SSOT adapter, Client-side EVM interactions dengan `BondingCurveLaunchpad.sol`, serta reuse modul `packages/social/kol-service.ts`, `packages/launchpad/bounty-escrow.ts`, dan `packages/intelligence/nutrition-label.ts`.

**Tech Stack:** Next.js 14/15 App Router, TypeScript, Tailwind CSS, Lucide Icons, Ethers.js v6, Arkham Intelligence API adapter, Firecrawl Scraper adapter.

---

## Global Constraints & Invariants

1. **Control Plane Isolation (`AGENTS.md`):** Vercel fungsi harus strictly stateless. Tidak ada background worker yang berputar tanpa henti.
2. **Postgres SSOT:** Data profil KOL, kampanye bounty, dan klaim tersimpan di PostgreSQL (`kol_profiles`, `bounty_campaigns`, `bounty_claims`).
3. **Non-Custodial Guarantee:** Platform admin wallet address hanya public address (`ADMIN_WALLET_PUBLIC_ADDRESS`). Tidak ada private key di Vercel env.
4. **Deterministic Risk Gate:** Transaksi trading dan token buy live wajib lolos validasi `packages/trading/risk-gate.ts`.
5. **Minimal Change (Min-Diff) & Zero-Regression:** Semua 4 rangkaian simulasi yang sudah ada (`test-simulation.ts`, `test-socialfi-simulation.ts`, `test-launch-modes-simulation.ts`, `test-angel-pipeline-simulation.ts`) wajib tetap lulus 100%.

---

## Detailed Task Breakdown & To-Do List

### Task 1: Serverless API Routes for KOL Profile (`app/api/kol/profile/route.ts`)

**Files:**
- Create: `app/api/kol/profile/route.ts`
- Test: `scripts/test-kol-bounty-simulation.ts`

**Interfaces:**
- Consumes: `KolService`, `ArkhamIntelligenceService`, `ApiResponse`
- Produces: `GET /api/kol/profile?userId=...` & `POST /api/kol/profile` `{ walletAddress, twitterHandle, followersCount }`

- [ ] **Step 1: Write Route Implementation**
Implement `GET` and `POST` handlers that instantiate `KolService` with standard database adapter fallback and compute trust score via Arkham Intelligence.

- [ ] **Step 2: Verify Route Compiles**
Run: `npx tsc --noEmit`
Expected: 0 errors.

---

### Task 2: Serverless API Routes for Bounty Campaigns & Claims (`app/api/launchpad/bounty/route.ts` & `app/api/launchpad/bounty/claim/route.ts`)

**Files:**
- Create: `app/api/launchpad/bounty/route.ts`
- Create: `app/api/launchpad/bounty/claim/route.ts`
- Test: `scripts/test-kol-bounty-simulation.ts`

**Interfaces:**
- Consumes: `BountyEscrowService`, `FirecrawlScraperService`, `KolProfile`, `BountyCampaign`
- Produces: `GET /api/launchpad/bounty` (list campaigns), `POST /api/launchpad/bounty` (create campaign), `POST /api/launchpad/bounty/claim` (submit proof URL & verify)

- [ ] **Step 1: Write Bounty Campaign CRUD Route**
Implement `GET` (list active campaigns) and `POST` (create new campaign for a token).

- [ ] **Step 2: Write Bounty Claim & Proof Verification Route**
Implement `POST /api/launchpad/bounty/claim` calling `BountyEscrowService.submitAndVerifyClaim` with automated hashtag and tweet validation.

- [ ] **Step 3: Verify Route Compiles**
Run: `npx tsc --noEmit`
Expected: 0 errors.

---

### Task 3: SocialFi KOL Hub & Bounty Portal UI (`app/kol/page.tsx`)

**Files:**
- Create: `app/kol/page.tsx`
- Modify: `app/components/HeaderNav.tsx`

**Interfaces:**
- Consumes: `useAuth`, `/api/kol/profile`, `/api/launchpad/bounty`, `/api/launchpad/bounty/claim`
- Produces: Interactive 4-tab SocialFi Hub:
  - Tab 1: KOL Passport & Reputation Badge
  - Tab 2: Marketing Bounties Marketplace
  - Tab 3: Proof Submission & Verification Status
  - Tab 4: Creator Escrow Deposit Manager

- [ ] **Step 1: Build `app/kol/page.tsx`**
Create responsive cyber-themed UI matching RTrader design tokens (CSS variables, dark theme, neon accents).

- [ ] **Step 2: Update Header Navigation (`app/components/HeaderNav.tsx`)**
Add `KOL Hub` nav link and allow switching to `KOL` perspective in role selector.

- [ ] **Step 3: Verify UI Compiles**
Run: `npx tsc --noEmit`
Expected: 0 errors.

---

### Task 4: End-to-End Simulation Test Suite (`scripts/test-kol-bounty-simulation.ts`)

**Files:**
- Create: `scripts/test-kol-bounty-simulation.ts`

**Interfaces:**
- Validates: Full lifecycle of KOL profile registration -> Arkham trust score -> Campaign creation -> Tweet proof validation -> Sybil rejection.

- [ ] **Step 1: Write Simulation Script**
Cover all edge cases (missing hashtag rejection, low follower rejection, valid proof approval).

- [ ] **Step 2: Execute Simulation Script**
Run: `npx tsx scripts/test-kol-bounty-simulation.ts`
Expected: Exit code 0, all assertions pass.

---

### Task 5: Full Regression Testing & Zero-Regression Verification

- [ ] **Step 1: Execute all 5 Test Suites in Sequence**
Run: `npx tsx scripts/test-simulation.ts && npx tsx scripts/test-socialfi-simulation.ts && npx tsx scripts/test-launch-modes-simulation.ts && npx tsx scripts/test-angel-pipeline-simulation.ts && npx tsx scripts/test-kol-bounty-simulation.ts`
Expected: Exit code 0, 100% tests pass.

- [ ] **Step 2: Run Full Static Typecheck**
Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit Clean Code**
Run: `git add . && git commit -m "feat(socialfi): implement KOL Hub, marketing bounty escrow portal, and proof verification engine"`

---

## Rekomendasi Lanjutan (Next-Phase Recommendations)

1. **On-Chain Merkle Claim Payout for Bounties:**
   - Mirip dengan alokasi Angel Investor, token reward bounty dapat diakumulasikan ke dalam Merkle tree mingguan sehingga KOL dapat mengklaim seluruh reward bounty mereka dalam 1 transaksi gas-efisien di `BondingCurveLaunchpad.sol`.
2. **Dynamic Twitter/X OAuth Callback (`/api/auth/callback/twitter`):**
   - Menghubungkan Twitter OAuth 2.0 PKCE resmi untuk verifikasi kepemilikan akun secara kriptografis tanpa perlu input manual.
3. **Paper Trading Sandbox Token Integration:**
   - Menambahkan dropdown token bonding curve di halaman `/trading` sehingga calon pembeli dapat melakukan paper trade token baru sebelum likuiditas lulus ke DEX.
