# Automated Keepers, KOL Staking Booster, & Anti-MEV DEX Graduation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan 3 pilar penyempurnaan ekosistem SocialFi RTrader:
1. **Chainlink Automation Keeper for Yield Auto-Compounding:** Otomasi pemanenan dividen 4.2% APY likuiditas terkunci setiap 7 hari tanpa intervensi manual.
2. **KOL Tier-Based Staking Booster Engine:** Multiplier alokasi yield hingga 1.35x (5.67% APY) berdasarkan reputasi Arkham & verifikasi Web3 Farcaster/Lens.
3. **Dynamic Slippage & Anti-MEV Protection for Uniswap v3 Graduation:** Melindungi likuiditas 24 ETH dari sandwich attack saat kelulusan bonding curve dengan batas toleransi 1.5% dan private RPC routing.

**Architecture:** 
- Smart Contract: Penambahan `checkUpkeep`, `performUpkeep`, `setKolStakingBooster`, dan `prepareMevProtectedGraduation` di `BondingCurveLaunchpad.sol`.
- Keeper Engine: `packages/launchpad/keeper-automation-service.ts` dengan interface Chainlink Automation.
- Booster Engine: Perluasan `YieldVaultService` dengan kalkulasi bertingkat per tier KOL.
- MEV Protection: `packages/trading/mev-protection.ts` dengan Flashbots Protect / MEV Blocker routing.

**Tech Stack:** Solidity 0.8.20, Next.js 14/15 App Router, TypeScript, Ethers.js v6, Chainlink Automation Standard, Flashbots Protect RPC.

---

## Bite-Sized Action Steps & To-Do List

- [ ] **Task 1: Smart Contract Enhancements (`BondingCurveLaunchpad.sol`)**
  - Tambahkan konstanta `HARVEST_INTERVAL` (7 hari) dan `MAX_GRADUATION_SLIPPAGE_BPS` (150 bps = 1.5%).
  - Tambahkan mapping `kolStakingBoosterBps`.
  - Tambahkan fungsi `checkUpkeep`, `performUpkeep`, `setKolStakingBooster`, dan `prepareMevProtectedGraduation`.
  - Tambahkan event `UpkeepPerformed`, `KolBoosterUpdated`, dan `DexGraduationInitiated`.

- [ ] **Task 2: Domain & Shared Types (`packages/shared/types/domain.ts`)**
  - Tambahkan `stakingBoosterMultiplier` pada `KolProfile`.
  - Tambahkan `mevProtectedGraduation`, `maxGraduationSlippagePct`, dan `autoCompoundingActive` pada `NutritionLabelRiskScore`.
  - Definisikan tipe `UpkeepStatus` dan `MevProtectionQuote`.

- [ ] **Task 3: Service Layer Implementations (`packages/`)**
  - Tambahkan `calculateBoostedYield` di `packages/launchpad/yield-vault-service.ts`.
  - Buat `packages/launchpad/keeper-automation-service.ts`.
  - Buat `packages/trading/mev-protection.ts`.
  - Update `packages/intelligence/nutrition-label.ts` untuk memproses status MEV guard dan auto-compounding.

- [ ] **Task 4: Serverless API Endpoints (`app/api/`)**
  - Buat `app/api/launchpad/keeper/route.ts`.
  - Buat `app/api/trading/mev-quote/route.ts`.

- [ ] **Task 5: UI Layer Integrations (`app/`)**
  - Update `app/components/NutritionLabelCard.tsx` dengan badge MEV Protection dan Auto-Compounding.
  - Update `app/kol/page.tsx` dengan tampilan Yield Booster Multiplier dan status Keeper Auto-Harvest.

- [ ] **Task 6: Automated Simulation & Full Regression Run**
  - Buat `scripts/test-keeper-mev-booster-simulation.ts`.
  - Jalankan seluruh 8 simulation scripts.
  - Jalankan `npx tsc --noEmit`.
