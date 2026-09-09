# Angel Deal Room, Merkle Claim, & On-Chain Referral Splitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan Angel Investor Deal Room & On-Chain Merkle Claim, serta On-Chain Referral Fee Splitter untuk KOL di smart contract `BondingCurveLaunchpad.sol`, service, API, dan UI, dengan prinsip zero-regression dan minimal change (min-diff).

**Architecture:**
- Smart Contract: Memperluas `BondingCurveLaunchpad.sol` dengan fungsi `buyWhitelistTokens` (verifikasi bukti kriptografi MerkleProof untuk Angel Investor) dan `buyTokensWithReferral` (pembagian fee otomatis 0.25% ke dompet KOL) tanpa merusak fungsi `buyTokens` yang lama.
- Service Layer: `LaunchDraftService` menyediakan helper `generateMerkleProof` dan `verifyWhitelist`.
- API Layer: `app/api/launchpad/whitelist/route.ts` untuk memeriksa apakah dompet investor terdaftar dan menghasilkan bukti Merkle secara instan.
- UI Component: `AngelDealRoomModal.tsx` di `app/components/` dan integrasi tab di `app/launchpad/page.tsx`.
- Non-Custodial Guarantee: Dana langsung mengalir dari investor ke bonding curve / dompet admin / dompet KOL secara on-chain; Vercel tidak memegang private key.

**Tech Stack:** Solidity 0.8.20, Ethers.js 6, Next.js 14, TypeScript 5, Merkle Proof verification.

## Global Constraints
- Non-Negotiable: Next.js + Vercel adalah Control Plane only (ADR-001).
- Non-Negotiable: Smart contract perubahan harus backward-compatible (fungsi `buyTokens` lama tidak boleh berubah signature/behavior-nya).
- Non-Negotiable: Vercel TIDAK PERNAH menyimpan private key atau mengkustodi dana pengguna.
- Non-Negotiable: Seluruh 3 simulation suite (`test-simulation.ts`, `test-socialfi-simulation.ts`, `test-launch-modes-simulation.ts`) harus tetap 100% LULUS.

---

### Task 1: Smart Contract Upgrade: MerkleProof & Referral Fee Splitter (`contracts/launchpad/BondingCurveLaunchpad.sol`)

**Files:**
- Modify: `contracts/launchpad/BondingCurveLaunchpad.sol:60-222`
- Test: `scripts/test-angel-pipeline-simulation.ts`

**Interfaces:**
- Produces: `buyWhitelistTokens(address tokenAddress, uint256 tokenAmount, bytes32[] calldata merkleProof)`, `buyTokensWithReferral(address tokenAddress, uint256 tokenAmount, address payable referralWallet)`

- [ ] **Step 1: Tambahkan pustaka MerkleProof dan fungsi baru ke `BondingCurveLaunchpad.sol`**
Tambahkan pustaka MerkleProof sederhana dan fungsi `buyWhitelistTokens` serta `buyTokensWithReferral`:

```solidity
library MerkleProof {
    function verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }
}
```

Dan tambahkan fungsi:
1. `buyWhitelistTokens(...)`: verifikasi proof sebelum mengeksekusi pembelian alokasi angel investor.
2. `buyTokensWithReferral(...)`: membagi 0.25% fee ke dompet KOL secara on-chain.

- [ ] **Step 2: Commit Smart Contract**
```bash
git add contracts/launchpad/BondingCurveLaunchpad.sol
git commit -m "feat(contracts): add MerkleProof verification for Angel Investors and on-chain referral splitter"
```

---

### Task 2: Service Layer: Merkle Tree Generator & Proof Helper (`packages/launchpad/launch-draft-service.ts`)

**Files:**
- Modify: `packages/launchpad/launch-draft-service.ts`
- Test: `scripts/test-angel-pipeline-simulation.ts`

- [ ] **Step 1: Tambahkan fungsi pembentukan Merkle Tree dan generasi proof di `LaunchDraftService`**
```typescript
static generateMerkleTree(wallets: string[]): { root: string; getProof: (wallet: string) => string[] }
```

- [ ] **Step 2: Commit Service**
```bash
git add packages/launchpad/launch-draft-service.ts
git commit -m "feat(launchpad): add Merkle tree generator and proof calculation helper"
```

---

### Task 3: API Endpoint: Whitelist Verification & Proof Provider (`app/api/launchpad/whitelist/route.ts`)

**Files:**
- Create: `app/api/launchpad/whitelist/route.ts`
- Test: `scripts/test-angel-pipeline-simulation.ts`

- [ ] **Step 1: Tulis API route handler untuk verifikasi status whitelist Angel Investor**
Menerima `GET /api/launchpad/whitelist?tokenAddress=...&walletAddress=...` dan mengembalikan proof array untuk eksekusi kontrak on-chain.

- [ ] **Step 2: Commit API Route**
```bash
git add app/api/launchpad/whitelist/route.ts
git commit -m "feat(api): add /api/launchpad/whitelist proof verification route"
```

---

### Task 4: UI Component: Angel Deal Room & Referral Modal (`app/components/AngelDealRoomModal.tsx`)

**Files:**
- Create: `app/components/AngelDealRoomModal.tsx`
- Modify: `app/launchpad/page.tsx`

- [ ] **Step 1: Buat komponen `AngelDealRoomModal.tsx`**
Antarmuka modal di mana Angel Investor memasukkan token address, memeriksa kelayakan dompet, melihat jatah alokasi seed, dan menekan tombol *"Claim Angel Allocation"*.

- [ ] **Step 2: Sematkan tombol "Angel Deal Room" ke header `app/launchpad/page.tsx`**

- [ ] **Step 3: Commit UI changes**
```bash
git add app/components/AngelDealRoomModal.tsx app/launchpad/page.tsx
git commit -m "feat(ui): add AngelDealRoomModal and integrate into launchpad view"
```

---

### Task 5: Sanity Simulation Suite & Zero Regression Guard (`scripts/test-angel-pipeline-simulation.ts`)

**Files:**
- Create: `scripts/test-angel-pipeline-simulation.ts`

- [ ] **Step 1: Tulis skrip simulasi pengujian Merkle verification dan fee distribution**
- [ ] **Step 2: Jalankan skrip test**
Run: `npx tsx scripts/test-angel-pipeline-simulation.ts`
Expected: ALL ANGEL DEAL ROOM SIMULATIONS PASSED!

- [ ] **Step 3: Jalankan seluruh 4 test suites secara paralel**
Run: `npx tsx scripts/test-simulation.ts && npx tsx scripts/test-socialfi-simulation.ts && npx tsx scripts/test-launch-modes-simulation.ts && npx tsx scripts/test-angel-pipeline-simulation.ts`
Expected: ALL 4 SUITES PASSED CLEANLY!

- [ ] **Step 4: Jalankan TypeScript typecheck**
Run: `npx tsc --noEmit`
Expected: 0 Errors

- [ ] **Step 5: Commit test suite**
```bash
git add scripts/test-angel-pipeline-simulation.ts
git commit -m "test: add angel deal room and referral simulation tests"
```
