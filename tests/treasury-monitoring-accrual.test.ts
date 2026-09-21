/**
 * tests/treasury-monitoring-accrual.test.ts
 *
 * Dedicated Test Suite for Production Treasury Monitoring & Organic Creator Fee Accrual:
 *  1. Zero Fee: Returns empty/valid production state, no claim dispatched, no ledger pollution.
 *  2. Below Threshold: Detects fee but gates claim when amount < 0.005 ETH.
 *  3. Threshold Reached: Executes claim and autonomously credits treasury ledger.
 *  4. Duplicate Claim Prevention: Rejects claims on already-claimed fees; ledger entry is strictly unique.
 *  5. Pending / In-Progress Claim: Non-claimable states reject claim attempts.
 *  6. Claim Success & Failure Handling: Verification failure marks 'failed' without ledger credit.
 *  7. Malformed Bankr Response: 404, null, or malformed data handled gracefully without crashes.
 *  8. Creator Destination & Identity: Matches custodial wallet and WETH numeraire.
 *  9. Deterministic Claim Epoch: Multiple scans produce identical event_key per claim epoch.
 * 10. Concurrency Lock: Auto-claim lock prevents overlapping execution.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import axios from "axios";
import { resetConfig, getConfig } from "../src/config.ts";
import {
  BankrFeeAdapter,
  scanCreatorFees,
  getClaimableFees,
} from "../src/modules/treasury/fee-scanner.ts";
import {
  claimAvailableFee,
  claimAllAvailableFees,
  reconcileInFlightFeeClaims,
} from "../src/modules/treasury/fee-claimer.ts";
import {
  recordFeeClaimedToLedger,
  getTreasuryBalanceSummary,
  getTreasuryLedgerEntries,
} from "../src/modules/treasury/treasury-ledger.ts";
import {
  registerWalletAccount,
  getWalletAccount,
} from "../src/modules/identity/wallet-manager.ts";
import * as evmVerifier from "../src/modules/reconciliation/evm-verifier.ts";
import {
  recordFeeEvent,
  getFeeEventById,
  getFeeEvents,
  logDeploy,
  acquireLock,
  releaseLock,
  type DeployLog,
  type FeeEvent,
  DB_PATH,
} from "../src/db/vault.ts";

const db = new Database(DB_PATH);

const TARGET_TOKEN = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
const TARGET_POOL = "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9";
const CREATOR_WALLET = "0x1e130ec63174d4258473366b762f197560942760";

describe("Production Treasury Monitoring & Organic Creator Fee Accrual", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;
  let axiosPostSpy: ReturnType<typeof spyOn>;
  let evmVerifySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_key";
    process.env.FIRECRAWL_API_KEY = "test_key";
    process.env.PINATA_JWT = "test_key";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.BANKR_API_KEY = "bk_usr_test_audit_key";
    process.env.BANKR_CHAIN = "base";
    process.env.BANKR_QUOTE_ONLY_FEES = "true";
    process.env.BANKR_DEGEN_MODE = "true";
    process.env.TREASURY_AUTO_CLAIM_ENABLED = "true";
    process.env.TREASURY_MIN_CLAIM_ETH = "0.005";
    process.env.DEPLOY_MODE = "testnet";

    db.run("DELETE FROM treasury_ledger WHERE wallet_id LIKE 'test_audit_%'");
    db.run("DELETE FROM fee_events WHERE wallet_id LIKE 'test_audit_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_audit_%'");
    db.run("DELETE FROM deploy_logs WHERE ticker = 'PUMPRUN_AUDIT'");
    releaseLock("treasury_auto_claim");

    axiosGetSpy = spyOn(axios, "get");
    axiosPostSpy = spyOn(axios, "post");
    evmVerifySpy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
      blockNumber: 50940132n,
    });
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
    axiosPostSpy?.mockRestore();
    evmVerifySpy?.mockRestore();
    releaseLock("treasury_auto_claim");
  });

  // ─── 1. Zero-Fee Gate ───────────────────────────────────────────
  it("1. Zero-Fee State: returns empty array, triggers NO claim, and leaves ledger untouched", async () => {
    const adapter = new BankrFeeAdapter();
    const wallet = {
      id: "test_audit_zero",
      label: "Audit Zero Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const dep: DeployLog = {
      id: 9901,
      chain: "base",
      tokenName: "Pump Hill Runner",
      ticker: "PUMPRUN_AUDIT",
      contractAddr: TARGET_TOKEN,
      poolId: TARGET_POOL,
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: wallet.id,
    };

    // Live Bankr response structure when no volume/fees have accrued
    axiosGetSpy.mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/doppler/")) {
        return { status: 200, data: { eligible: false, claimableFees: { token0: "0" } } };
      }
      return {
        status: 200,
        data: {
          address: CREATOR_WALLET,
          tokens: [
            {
              tokenAddress: TARGET_TOKEN,
              share: "95.00%",
              token0Label: "WETH",
              tokenIsToken0: false,
              claimable: { token0: 0, token1: 0 },
              claimed: { token0: 0, count: 0 },
            },
          ],
          totals: {
            claimableWeth: 0,
            claimedWeth: 0,
            claimCount: 0,
          },
        },
      };
    });

    const detected = await adapter.scanFees(dep, wallet);
    expect(detected).toEqual([]);
    expect(axiosPostSpy).not.toHaveBeenCalled();

    // Verify ledger is clean
    const ledger = getTreasuryLedgerEntries({ walletId: wallet.id });
    expect(ledger.length).toBe(0);
  });

  // ─── 2. Below-Threshold Gate ────────────────────────────────────
  it("2. Below-Threshold State: records fee event but fails closed against claim (0.002 < 0.005 ETH)", async () => {
    registerWalletAccount({
      id: "test_audit_below",
      label: "Below Threshold Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "bankr_creator_fee:base:" + TARGET_TOKEN + ":claim_epoch_0",
      walletId: "test_audit_below",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "2000000000000000", // 0.002 WETH
      amountFormatted: 0.002,
      status: "claimable",
    });

    const result = await claimAvailableFee(fee.id, { executeOnchain: true });

    expect(result.success).toBe(false);
    expect(result.status).toBe("claimable");
    expect(result.error).toContain("below minimum claim threshold");

    // Event status in DB must remain claimable (not failed, not claimed)
    const stored = getFeeEventById(fee.id);
    expect(stored?.status).toBe("claimable");

    // Treasury ledger must have 0 entries
    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_below" });
    expect(ledger.length).toBe(0);
  });

  // ─── 3. Threshold Met & Autonomous Ledger Credit ────────────────
  it("3. Threshold Reached: executes claim and autonomously credits treasury ledger (+0.008 WETH)", async () => {
    registerWalletAccount({
      id: "test_audit_met",
      label: "Threshold Met Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "bankr_creator_fee:base:" + TARGET_TOKEN + ":claim_epoch_0",
      walletId: "test_audit_met",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "8000000000000000", // 0.008 WETH
      amountFormatted: 0.008,
      status: "claimable",
    });

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        txHash: "0xfeeclaimconfirmed1234567890abcdef1234567890abcdef1234567890abcdef",
        claimedAmount: "0.008",
      },
    });

    const result = await claimAvailableFee(fee.id, { executeOnchain: true });

    expect(result.success).toBe(true);
    expect(result.status).toBe("claimed");
    expect(result.claimTxHash).toBeDefined();

    // Event updated to 'claimed'
    const stored = getFeeEventById(fee.id);
    expect(stored?.status).toBe("claimed");

    // Ledger credited exactly once
    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_met" });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amountFormatted).toBe(0.008);
    expect(ledger[0].tokenSymbol).toBe("WETH");
    expect(ledger[0].direction).toBe("credit");
    expect(ledger[0].beneficiaryAddress).toBe(CREATOR_WALLET);
  });

  // ─── 4. Duplicate Claim Prevention ──────────────────────────────
  it("4. Duplicate Claim Prevention: rejects claim on already-claimed event and ledger remains idempotent", async () => {
    registerWalletAccount({
      id: "test_audit_dup",
      label: "Duplicate Claim Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "bankr_creator_fee:base:" + TARGET_TOKEN + ":claim_epoch_0",
      walletId: "test_audit_dup",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "8000000000000000",
      amountFormatted: 0.008,
      status: "claimed",
      metadata: { note: "previously claimed" },
    });

    // Attempting to claim again must fail immediately
    const result = await claimAvailableFee(fee.id, { executeOnchain: true });
    expect(result.success).toBe(false);
    expect(result.status).toBe("claimed");
    expect(result.error).toContain("must be 'claimable'");
    expect(axiosPostSpy).not.toHaveBeenCalled();

    // Idempotent ledger entry insertion
    const entry1 = recordFeeClaimedToLedger(fee, "0xdupclaimtx1");
    const entry2 = recordFeeClaimedToLedger(fee, "0xdupclaimtx1");
    expect(entry2.id).toBe(entry1.id);

    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_dup" });
    expect(ledger.length).toBe(1); // Exactly 1 entry!
  });

  // ─── 5. Pending / In-Progress Claim Guard ───────────────────────
  it("5. Non-Claimable States: rejects claim attempts on 'detected' or 'failed' events", async () => {
    registerWalletAccount({
      id: "test_audit_states",
      label: "States Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const detectedFee = recordFeeEvent({
      eventKey: "test_audit_detected_fee",
      walletId: "test_audit_states",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "detected",
    });

    const resDetected = await claimAvailableFee(detectedFee.id, { executeOnchain: true });
    expect(resDetected.success).toBe(false);
    expect(resDetected.error).toContain("must be 'claimable'");

    const failedFee = recordFeeEvent({
      eventKey: "test_audit_failed_fee",
      walletId: "test_audit_states",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "failed",
    });

    const resFailed = await claimAvailableFee(failedFee.id, { executeOnchain: true });
    expect(resFailed.success).toBe(false);
    expect(resFailed.error).toContain("must be 'claimable'");
  });

  // ─── 6. On-Chain Claim Failure Handling ─────────────────────────
  it("6. On-Chain Claim Failure: transitions status to 'failed' and does NOT credit ledger", async () => {
    registerWalletAccount({
      id: "test_audit_fail",
      label: "Failure Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_revert_fee",
      walletId: "test_audit_fail",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claimable",
    });

    // Mock on-chain verification returning reverted / error
    evmVerifySpy.mockResolvedValueOnce({
      status: "error",
      errorReason: "Transaction reverted on chain",
    });

    const result = await claimAvailableFee(fee.id, {
      customTxHash: "0xrevertedtx1234567890abcdef1234567890abcdef1234567890abcdef12345",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("On-chain verification failed or reverted");

    // Fee event status in DB is now failed
    const stored = getFeeEventById(fee.id);
    expect(stored?.status).toBe("failed");

    // Ledger has 0 entries
    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_fail" });
    expect(ledger.length).toBe(0);
  });

  // ─── 7. Malformed Bankr API Response ───────────────────────────
  it("7. Malformed Response: handles 404, null, and empty payloads gracefully without throwing", async () => {
    const adapter = new BankrFeeAdapter();
    const wallet = {
      id: "test_audit_malformed",
      label: "Malformed Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const dep: DeployLog = {
      id: 9902,
      chain: "base",
      tokenName: "Pump Hill Runner",
      ticker: "PUMPRUN_AUDIT",
      contractAddr: TARGET_TOKEN,
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: wallet.id,
    };

    // Case 1: 404
    axiosGetSpy.mockResolvedValueOnce({ status: 404, data: null });
    const res404 = await adapter.scanFees(dep, wallet);
    expect(res404).toEqual([]);

    // Case 2: 200 with null data
    axiosGetSpy.mockResolvedValueOnce({ status: 200, data: null });
    const resNull = await adapter.scanFees(dep, wallet);
    expect(resNull).toEqual([]);

    // Case 3: Network error / exception
    axiosGetSpy.mockRejectedValueOnce(new Error("Network timeout (ETIMEDOUT)"));
    const resErr = await adapter.scanFees(dep, wallet);
    expect(resErr).toEqual([]);
  });

  // ─── 8. Creator Destination & Numeraire Verification ───────────
  it("8. Identity Verification: assigns verified custodial address and WETH numeraire", async () => {
    const adapter = new BankrFeeAdapter();
    const wallet = {
      id: "test_audit_identity",
      label: "Identity Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const dep: DeployLog = {
      id: 9903,
      chain: "base",
      tokenName: "Pump Hill Runner",
      ticker: "PUMPRUN_AUDIT",
      contractAddr: TARGET_TOKEN,
      poolId: TARGET_POOL,
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: wallet.id,
    };

    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        address: CREATOR_WALLET,
        tokens: [
          {
            tokenAddress: TARGET_TOKEN,
            share: "95.00%",
            token0Label: "WETH",
            numeraire: "0x4200000000000000000000000000000000000006",
            claimable: { token0: 0.012 },
          },
        ],
        totals: {
          claimableWeth: 0.012,
          claimCount: 0,
        },
      },
    });

    const fees = await adapter.scanFees(dep, wallet);
    expect(fees.length).toBe(1);
    expect(fees[0].beneficiaryAddress).toBe(CREATOR_WALLET);
    expect(fees[0].tokenSymbol).toBe("WETH");
    expect(fees[0].amountFormatted).toBe(0.012);
    expect(fees[0].epochOrIdentifier).toBe("claim_epoch_0");
  });

  // ─── 9. Deterministic Claim Epoch Idempotency ───────────────────
  it("9. Deterministic Claim Epoch: repeated scans produce identical event_key per claim epoch", async () => {
    const adapter = new BankrFeeAdapter();
    const wallet = {
      id: "test_audit_epoch",
      label: "Epoch Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const dep: DeployLog = {
      id: 9904,
      chain: "base",
      tokenName: "Pump Hill Runner",
      ticker: "PUMPRUN_AUDIT",
      contractAddr: TARGET_TOKEN,
      poolId: TARGET_POOL,
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: wallet.id,
    };

    const bankrPayload = {
      status: 200,
      data: {
        address: CREATOR_WALLET,
        tokens: [
          {
            tokenAddress: TARGET_TOKEN,
            share: "95.00%",
            token0Label: "WETH",
            claimable: { token0: 0.01 },
            claimed: { count: 0 },
          },
        ],
        totals: {
          claimableWeth: 0.01,
          claimCount: 0,
        },
      },
    };

    // First scan
    axiosGetSpy.mockResolvedValueOnce(bankrPayload);
    const scan1 = await adapter.scanFees(dep, wallet);

    // Second scan (same claimCount)
    axiosGetSpy.mockResolvedValueOnce(bankrPayload);
    const scan2 = await adapter.scanFees(dep, wallet);

    expect(scan1[0].epochOrIdentifier).toBe("claim_epoch_0");
    expect(scan2[0].epochOrIdentifier).toBe("claim_epoch_0");
    expect(scan1[0].epochOrIdentifier).toBe(scan2[0].epochOrIdentifier);
  });

  // ─── 10. Concurrency Lock Guard ─────────────────────────────────
  it("10. Concurrency Lock: acquireLock('treasury_auto_claim') guards against parallel runs", () => {
    // Acquire lock
    const firstAcquire = acquireLock("treasury_auto_claim", 120);
    expect(firstAcquire).toBe(true);

    // Second acquire must be rejected
    const secondAcquire = acquireLock("treasury_auto_claim", 120);
    expect(secondAcquire).toBe(false);

    // Release lock
    releaseLock("treasury_auto_claim");

    // Third acquire should now succeed
    const thirdAcquire = acquireLock("treasury_auto_claim", 120);
    expect(thirdAcquire).toBe(true);
    releaseLock("treasury_auto_claim");
  });

  // ─── 11. UNKNOWN Claim Result: Timeout/5xx classifies CLAIM_UNKNOWN ───
  it("11. Unknown Claim Result: timeout/5xx classifies status as 'unknown' and prevents blind retries", async () => {
    process.env.DEPLOY_MODE = "mainnet";
    process.env.BANKR_SIMULATE_ONLY = "false";
    resetConfig();

    registerWalletAccount({
      id: "test_audit_unknown",
      label: "Unknown Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_timeout_fee",
      walletId: "test_audit_unknown",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claimable",
    });

    // Mock axios timeout error
    const timeoutErr: any = new Error("timeout of 15000ms exceeded");
    timeoutErr.isAxiosError = true;
    timeoutErr.code = "ECONNABORTED";
    axiosPostSpy.mockRejectedValueOnce(timeoutErr);

    const result = await claimAvailableFee(fee.id, { executeOnchain: true });

    expect(result.success).toBe(false);
    expect(result.status).toBe("unknown");
    expect(result.error).toContain("CLAIM_UNKNOWN");

    const stored = getFeeEventById(fee.id);
    expect(stored?.status).toBe("unknown");
    expect((stored?.metadata as any)?.claimLifecycle).toBe("CLAIM_UNKNOWN");

    // Ledger has 0 entries
    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_unknown" });
    expect(ledger.length).toBe(0);
  });

  // ─── 12. In-Flight Claim Guard: Prevents concurrent claim ─────────
  it("12. In-Flight Claim Guard: rejects claims when fee event is in 'claim_submitted' or 'claim_pending'", async () => {
    registerWalletAccount({
      id: "test_audit_inflight",
      label: "Inflight Wallet",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const submittedFee = recordFeeEvent({
      eventKey: "test_audit_inflight_submitted",
      walletId: "test_audit_inflight",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_submitted",
    });

    const res1 = await claimAvailableFee(submittedFee.id, { executeOnchain: true });
    expect(res1.success).toBe(false);
    expect(res1.error).toContain("must be 'claimable'");

    const pendingFee = recordFeeEvent({
      eventKey: "test_audit_inflight_pending",
      walletId: "test_audit_inflight",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_pending",
    });

    const res2 = await claimAvailableFee(pendingFee.id, { executeOnchain: true });
    expect(res2.success).toBe(false);
    expect(res2.error).toContain("must be 'claimable'");
  });

  // ─── 13. Recovery: Restart on CLAIM_SUBMITTED (Bankr Claimed) ─────
  it("13. Recovery: restart on CLAIM_SUBMITTED resolves to 'claimed' if Bankr processed the claim", async () => {
    registerWalletAccount({
      id: "test_audit_rec_sub_claimed",
      label: "Rec Sub Claimed",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_sub_claimed_key",
      walletId: "test_audit_rec_sub_claimed",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_submitted",
    });

    // Mock Bankr API showing claim was processed
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        address: CREATOR_WALLET,
        tokens: [
          {
            tokenAddress: TARGET_TOKEN,
            claimed: { count: 1, txHash: "0xbankrtx_recovered_1" },
            claimable: { token0: 0 },
          },
        ],
        totals: {
          claimCount: 1,
          claimedWeth: 0.01,
          claimableWeth: 0,
        },
      },
    });

    const rec = await reconcileInFlightFeeClaims();
    expect(rec.confirmed).toBe(1);

    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("claimed");
    expect(updated?.claimTxHash).toBe("0xbankrtx_recovered_1");

    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_rec_sub_claimed" });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amountFormatted).toBe(0.01);
  });

  // ─── 14. Recovery: Restart on CLAIM_SUBMITTED (No Claim on Bankr) ──
  it("14. Recovery: restart on CLAIM_SUBMITTED safely resets to 'claimable' if Bankr has not claimed after timeout", async () => {
    registerWalletAccount({
      id: "test_audit_rec_sub_reset",
      label: "Rec Sub Reset",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_sub_reset_key",
      walletId: "test_audit_rec_sub_reset",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_submitted",
    });

    // Manually set updated_at to 40 seconds ago to simulate timeout
    const fortySecsAgo = new Date(Date.now() - 40000).toISOString();
    db.run("UPDATE fee_events SET updated_at = ? WHERE id = ?", [fortySecsAgo, fee.id]);

    // Mock Bankr API showing claim was never processed (fees still claimable)
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        address: CREATOR_WALLET,
        tokens: [
          {
            tokenAddress: TARGET_TOKEN,
            claimed: { count: 0 },
            claimable: { token0: 0.01 },
          },
        ],
        totals: {
          claimCount: 0,
          claimedWeth: 0,
          claimableWeth: 0.01,
        },
      },
    });

    const rec = await reconcileInFlightFeeClaims();
    expect(rec.resetToClaimable).toBe(1);

    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("claimable");

    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_rec_sub_reset" });
    expect(ledger.length).toBe(0);
  });

  // ─── 15. Recovery: Restart on CLAIM_PENDING (On-Chain Confirmed) ───
  it("15. Recovery: restart on CLAIM_PENDING checks on-chain tx and confirms claim & ledger", async () => {
    registerWalletAccount({
      id: "test_audit_rec_pending_ok",
      label: "Rec Pending OK",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_pending_ok_key",
      walletId: "test_audit_rec_pending_ok",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_pending",
    });

    // Attach txHash
    db.run("UPDATE fee_events SET claim_tx_hash = '0xpending_mined_tx' WHERE id = ?", [fee.id]);

    evmVerifySpy.mockResolvedValueOnce({
      status: "confirmed",
      blockNumber: 50940200n,
    });

    const rec = await reconcileInFlightFeeClaims();
    expect(rec.confirmed).toBe(1);

    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("claimed");

    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_rec_pending_ok" });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amountFormatted).toBe(0.01);
  });

  // ─── 16. Recovery: Missing Ledger Entry on Confirmed Claim ─────────
  it("16. Recovery: autonomously repairs missing ledger entries on previously confirmed claims", async () => {
    registerWalletAccount({
      id: "test_audit_rec_missing_ledger",
      label: "Rec Missing Ledger",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_missing_ledger_key",
      walletId: "test_audit_rec_missing_ledger",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "15000000000000000",
      amountFormatted: 0.015,
      status: "claimed",
    });
    db.run("UPDATE fee_events SET claim_tx_hash = '0xconfirmed_tx_missing_ledger' WHERE id = ?", [fee.id]);

    // Ledger currently has 0 entries
    expect(getTreasuryLedgerEntries({ walletId: "test_audit_rec_missing_ledger" }).length).toBe(0);

    const rec = await reconcileInFlightFeeClaims();
    expect(rec.ledgerEntriesRepaired).toBe(1);

    // Now ledger has exactly 1 entry
    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_rec_missing_ledger" });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amountFormatted).toBe(0.015);
  });

  // ─── 17. Recovery: Reverted Claim on On-Chain Check ────────────────
  it("17. Recovery: marks reverted on-chain claims as 'failed' without ledger credit", async () => {
    registerWalletAccount({
      id: "test_audit_rec_revert",
      label: "Rec Revert",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_revert_key",
      walletId: "test_audit_rec_revert",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_pending",
    });
    db.run("UPDATE fee_events SET claim_tx_hash = '0xreverted_onchain_tx' WHERE id = ?", [fee.id]);

    evmVerifySpy.mockResolvedValueOnce({
      status: "error",
      errorReason: "Transaction reverted by EVM",
    });

    const rec = await reconcileInFlightFeeClaims();
    expect(rec.reverted).toBe(1);

    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("failed");

    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_rec_revert" });
    expect(ledger.length).toBe(0);
  });

  // ─── 18. Recovery: RPC Unavailable (Fail-Closed) ──────────────────
  it("18. Recovery: leaves claim_pending untouched when RPC throws (does not mark failed)", async () => {
    registerWalletAccount({
      id: "test_audit_rec_rpc_down",
      label: "Rec RPC Down",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_rpc_down_key",
      walletId: "test_audit_rec_rpc_down",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claim_pending",
    });
    db.run("UPDATE fee_events SET claim_tx_hash = '0xrpc_down_tx' WHERE id = ?", [fee.id]);

    evmVerifySpy.mockRejectedValueOnce(new Error("RPC endpoint unreachable (ECONNREFUSED)"));

    const rec = await reconcileInFlightFeeClaims();
    expect(rec.unresolved).toBe(1);

    // Must still remain claim_pending (not failed)
    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("claim_pending");

    const ledger = getTreasuryLedgerEntries({ walletId: "test_audit_rec_rpc_down" });
    expect(ledger.length).toBe(0);
  });

  // ─── 19. Duplicate Recovery Idempotency ───────────────────────────
  it("19. Idempotent Recovery: running reconcileInFlightFeeClaims multiple times produces 0 duplicate ledger rows", async () => {
    registerWalletAccount({
      id: "test_audit_rec_idemp",
      label: "Rec Idemp",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_audit_rec_idemp_key",
      walletId: "test_audit_rec_idemp",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claimed",
    });
    db.run("UPDATE fee_events SET claim_tx_hash = '0xidemp_tx' WHERE id = ?", [fee.id]);

    // Run recovery round 1
    await reconcileInFlightFeeClaims();
    const count1 = getTreasuryLedgerEntries({ walletId: "test_audit_rec_idemp" }).length;

    // Run recovery round 2
    await reconcileInFlightFeeClaims();
    const count2 = getTreasuryLedgerEntries({ walletId: "test_audit_rec_idemp" }).length;

    expect(count1).toBe(1);
    expect(count2).toBe(1); // Exactly 1!
  });

  // ─── 20. Repeated Scheduler After Confirmed Claim ─────────────────
  it("20. Repeated Scheduler Cycles: post-confirmation scans create zero duplicate fee events or claims", async () => {
    registerWalletAccount({
      id: "test_audit_sched_repeat",
      label: "Sched Repeat",
      evmAddress: CREATOR_WALLET,
      status: "ACTIVE",
    });

    // Token has been confirmed and claimed in epoch 0
    recordFeeEvent({
      eventKey: `bankr_creator_fee:base:${TARGET_TOKEN}:claim_epoch_0`,
      walletId: "test_audit_sched_repeat",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: TARGET_TOKEN,
      beneficiaryAddress: CREATOR_WALLET,
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claimed",
      claimTxHash: "0xepoch0_claimed_tx",
    });

    // Next scan: Bankr reports claimCount: 1, claimableWeth: 0
    const adapter = new BankrFeeAdapter();
    axiosGetSpy.mockResolvedValue({
      status: 200,
      data: {
        address: CREATOR_WALLET,
        tokens: [
          {
            tokenAddress: TARGET_TOKEN,
            claimed: { count: 1 },
            claimable: { token0: 0 },
          },
        ],
        totals: {
          claimCount: 1,
          claimedWeth: 0.01,
          claimableWeth: 0,
        },
      },
    });

    const dep: DeployLog = {
      id: 9999,
      chain: "base",
      tokenName: "Pump Hill Runner",
      ticker: "PUMPRUN",
      contractAddr: TARGET_TOKEN,
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: "test_audit_sched_repeat",
    };
    const wallet = getWalletAccount("test_audit_sched_repeat")!;

    // Scan cycle 1
    const res1 = await adapter.scanFees(dep, wallet);
    expect(res1).toEqual([]);

    // Scan cycle 2
    const res2 = await adapter.scanFees(dep, wallet);
    expect(res2).toEqual([]);

    // Total claimable fees remains 0
    const claimable = getClaimableFees("test_audit_sched_repeat");
    expect(claimable.length).toBe(0);
  });
});

