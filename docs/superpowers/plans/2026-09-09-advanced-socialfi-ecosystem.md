# Advanced SocialFi Scaling: ERC-4337 Paymaster, DeFi Yield Vault, & Web3 Social Graph

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan 3 inovasi strategis lanjutan untuk platform RTrader SocialFi:
1. **ERC-4337 Account Abstraction & Gasless Paymaster (Biconomy / ZeroDev Compliant):** Membebaskan biaya gas klaim reward bounty dan onboarding KOL.
2. **DeFi Liquid Staking Vault for Locked Liquidity:** Mengalirkan likuiditas yang terkunci 180 hari (24 ETH) ke liquid staking pool (4.2% APY) agar menghasilkan dividen bagi platform dan komunitas.
3. **Decentralized Reputation Graph (Farcaster + Lens Protocol):** Mengintegrasikan grafik sosial terdesentralisasi Web3 native ke dalam kalkulasi Trust Score profil KOL.

**Architecture:** 
- Smart Contract: Penambahan `isLiquidityStaked`, `claimBountyRewardGasless`, `stakeLockedLiquidity`, dan `harvestYield` pada `BondingCurveLaunchpad.sol`.
- Paymaster Engine: `packages/launchpad/gasless-paymaster.ts` dengan tanda tangan otorisasi sponsor.
- Yield Engine: `packages/launchpad/yield-vault-service.ts` untuk kalkulasi bunga likuiditas terkunci.
- Web3 Social Engine: `packages/social/farcaster-lens-service.ts` untuk verifikasi Farcaster & Lens.
- UI & Protection: Integrasi tombol Gasless Claim dan koneksi Farcaster/Lens di `/kol` serta badge yield staking di `NutritionLabelCard`.

**Tech Stack:** Solidity 0.8.20, Next.js 14/15 App Router, TypeScript, Ethers.js v6, Neynar API, Lens Protocol Standard, ERC-4337 Paymaster Standard.

---

## User Review Required

> [!IMPORTANT]
> - **Zero Breaking Changes on Existing Smart Contract Functions:** Fungsi `buyTokens`, `buyWhitelistTokens`, `buyTokensWithReferral`, `claimBountyReward`, `releaseGraduatedLiquidity`, dan `claimBountyRewardCrossChain` tetap 100% kompatibel tanpa perubahan signature.
> - **Anti-Abuse Gas Sponsorship Gate:** Paymaster hanya mensponsori transaksi klaim yang telah lolos AI Tweet Quality Gate (`passedQualityGate === true`).
> - **Non-Custodial Principal Guarantee:** Pokok likuiditas 24 ETH tidak dapat dicairkan sebelum batas 180 hari berakhir; hanya bunga akrual yield yang dapat dipanen secara berkala.

---

## Bite-Sized Action Steps & To-Do List

- [ ] **Task 1: Smart Contract Enhancements (`BondingCurveLaunchpad.sol`)**
  - Tambahkan mapping `authorizedPaymaster`, `isLiquidityStaked`, `stakedLiquidityAmount`, `lastYieldHarvestTimestamp`, dan `accruedYieldWei`.
  - Tambahkan event `AuthorizedPaymasterUpdated`, `GaslessBountyClaimed`, `LiquidityStaked`, dan `YieldHarvested`.
  - Tambahkan fungsi `setAuthorizedPaymaster`, `claimBountyRewardGasless`, `stakeLockedLiquidity`, dan `harvestYield`.
  - Pastikan `releaseGraduatedLiquidity` menangani un-staking likuiditas dengan aman.

- [ ] **Task 2: Gasless Paymaster Service & Serverless API (`packages/launchpad/` & `app/api/`)**
  - Buat `packages/launchpad/gasless-paymaster.ts` untuk mengelola kuota dan menandatangani otorisasi transaksi sponsor.
  - Buat API endpoint `app/api/paymaster/sponsor/route.ts`.

- [ ] **Task 3: DeFi Liquid Staking Vault Service (`packages/launchpad/`)**
  - Buat `packages/launchpad/yield-vault-service.ts` untuk kalkulasi yield bunga likuiditas 4.2% APY.
  - Hubungkan ke `packages/intelligence/nutrition-label.ts` untuk menampilkan indikator yield aktif.

- [ ] **Task 4: Decentralized Reputation Graph (Farcaster + Lens Protocol)**
  - Buat `packages/social/farcaster-lens-service.ts`.
  - Modifikasi `packages/social/kol-service.ts` dan `packages/shared/types/domain.ts` untuk mengintegrasikan skor Farcaster/Lens.
  - Buat endpoint `app/api/social/verify-farcaster/route.ts` dan `app/api/social/verify-lens/route.ts`.

- [ ] **Task 5: UI Layer Integrations (`app/`)**
  - Update `app/components/NutritionLabelCard.tsx` untuk menampilkan badge `🌾 4.2% APY STAKING YIELD`.
  - Update `app/kol/page.tsx`:
    - Tab Passport: Tampilan integrasi Farcaster & Lens.
    - Tab Claim: Tombol toggle Gasless Claim (Sponsored).
    - Tab Creator: Tombol aktivasi Liquid Staking Yield.

- [ ] **Task 6: Automated Simulation Suite & Zero-Regression Verification**
  - Buat `scripts/test-advanced-socialfi-simulation.ts`.
  - Jalankan seluruh 7 simulation scripts platform.
  - Jalankan `npx tsc --noEmit` untuk verifikasi tipe statis.
