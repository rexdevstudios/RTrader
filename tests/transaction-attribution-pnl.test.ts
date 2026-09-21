/**
 * tests/transaction-attribution-pnl.test.ts
 *
 * Test suite for Milestone V2.1.1 — Transaction Attribution & Realized PnL Verifier
 *
 * 32 Comprehensive Verification Scenarios:
 * EVM:
 *  1. Successful deployment receipt (direct contract creation)
 *  2. Reverted deployment receipt
 *  3. Successful receipt but wrong token address (mismatch)
 *  4. Factory deployment with attributable event emitter / topic
 *  5. Successful receipt with insufficient attribution evidence (unresolved)
 *  6. Successful buy with tx hash + balance delta (transaction_verified)
 *  7. Buy with pre-existing balance and no delta (unresolved, remains buy_submitted)
 *  8. Buy balance delta without tx attribution (balance_delta_only)
 *  9. Successful sell with verified proceeds and tx hash (transaction_verified)
 *  10. Sell with token balance decrease but no tx attribution (balance_delta_only)
 *  11. Partial sell on EVM
 *  12. RPC failure during attribution (unknown, no assumption of failure)
 *
 * Solana:
 *  13. Confirmed deployment/buy/sell signature
 *  14. Failed signature with on-chain error
 *  15. Transaction metadata with wrong mint
 *  16. Transaction metadata with wrong owner
 *  17. Balance delta without signature (balance_delta_only)
 *  18. Multiple token accounts summed properly
 *  19. Partial sell on Solana
 *  20. RPC failure on Solana (unknown)
 *
 * Realized PnL:
 *  21. Exact full-position PnL: netExitProceeds - allocatedEntryCost
 *  22. Partial-fill PnL: proportional cost basis allocation
 *  23. Fees included in PnL calculation
 *  24. Slippage reflected by actual execution proceeds
 *  25. Missing proceeds -> PNL_PENDING (no fabricated PnL)
 *  26. Missing cost basis -> PNL_PENDING
 *  27. Repeated reconciliation does not alter PnL (idempotency)
 *  28. No invented PnL when only price moved without exit
 *
 * Safety:
 *  29. RPC failure causes zero mutations and zero buy/sell triggers
 *  30. Weak evidence (balance_delta_only) CANNOT overwrite stronger evidence (transaction_verified)
 *  31. Concurrent reconciliations remain mutually exclusive via locks
 *  32. Restart/reconciliation after interruption is strictly idempotent
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import {
  verifyEvmDeploymentAttribution,
  verifyEvmTransactionAttribution,
  verifyEvmTransactionReceipt,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  verifySolanaTransaction,
  verifySolanaTransactionAttribution,
  verifySolanaTokenBalance,
} from "../src/modules/reconciliation/solana-verifier.ts";
import * as reconcilerModule from "../src/modules/reconciliation/onchain-reconciler.ts";
import {
  calculateRealizedPnl,
  reconcileDeployments,
  reconcilePendingBuys,
  reconcileClosingPositions,
  runOnchainReconciliation,
} from "../src/modules/reconciliation/onchain-reconciler.ts";
import {
  createPendingPosition,
  getPositionByContract,
  transitionPositionState,
  updatePositionReconciliation,
  isEvidenceRankHigher,
  logDeploy,
  acquireLock,
  releaseLock,
  isLockHeld,
  closePosition,
  DB_PATH,
} from "../src/db/vault.ts";
import * as sniperModule from "../src/modules/sniper/basedbot-sniper.ts";

describe("Milestone V2.1.1 — Transaction Attribution & Realized PnL Verifier", () => {
  beforeEach(() => {
    releaseLock("onchain_reconciler");
    releaseLock("test_v211_lock");
  });

  afterEach(() => {
    releaseLock("onchain_reconciler");
    releaseLock("test_v211_lock");
  });

  afterAll(() => {
    try {
      const db = new Database(DB_PATH);
      db.run("DELETE FROM active_positions WHERE ticker IN ('BUY_TX', 'PRE_EX', 'BAL_ONLY', 'SELL_TX', 'SELL_BAL', 'PART_EVM', 'SOL_BUY', 'RPC_SAFETY', 'MONOTONIC', 'IDEMP_RESTART')");
    } catch {
      /* ignore */
    }
  });

  // ─── EVM ATTRIBUTION ────────────────────────────────────────

  // 1. Successful deployment receipt (direct contract creation)
  it("1. should attribute direct EVM deployment when receipt.contractAddress matches expected token", async () => {
    const targetAddr = "0x2222222222222222222222222222222222222222";
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 1000n,
        contractAddress: targetAddr,
      }),
    };

    const res = await verifyEvmDeploymentAttribution("0x" + "1".repeat(64), targetAddr, "base", mockClient);
    expect(res.status).toBe("confirmed");
    expect(res.attributionType).toBe("direct_contract_creation");
    expect(res.attributedAddress?.toLowerCase()).toBe(targetAddr.toLowerCase());
  });

  // 2. Reverted deployment receipt
  it("2. should mark deployment as failed when EVM receipt status is reverted", async () => {
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "reverted",
        blockNumber: 1000n,
      }),
    };

    const res = await verifyEvmDeploymentAttribution("0x" + "1".repeat(64), "0x" + "2".repeat(40), "base", mockClient);
    expect(res.status).toBe("failed");
    expect(res.reason).toContain("reverted");
  });

  // 3. Successful receipt but wrong token address (mismatch)
  it("3. should detect mismatch when receipt.contractAddress differs from expected token address", async () => {
    const expectedAddr = "0x2222222222222222222222222222222222222222";
    const actualAddr = "0x3333333333333333333333333333333333333333";
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 1000n,
        contractAddress: actualAddr,
      }),
    };

    const res = await verifyEvmDeploymentAttribution("0x" + "1".repeat(64), expectedAddr, "base", mockClient);
    expect(res.status).toBe("mismatch");
    expect(res.reason).toContain("does not match expected token address");
  });

  // 4. Factory deployment with attributable event emitter / topic
  it("4. should attribute factory deployment when logs emit event from or reference expected token address", async () => {
    const expectedToken = "0x4444444444444444444444444444444444444444";
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 1000n,
        contractAddress: null, // Factory deployment does not set receipt.contractAddress directly
        logs: [
          {
            address: expectedToken, // Token emitted initialization/transfer event
            topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
            data: "0x0000000000000000000000000000000000000000000000000000000000000001",
          },
        ],
      }),
    };

    const res = await verifyEvmDeploymentAttribution("0x" + "1".repeat(64), expectedToken, "base", mockClient);
    expect(res.status).toBe("confirmed");
    expect(res.attributionType).toBe("factory_log_emitter");
    expect(res.attributedAddress?.toLowerCase()).toBe(expectedToken.toLowerCase());
  });

  // 5. Successful receipt with insufficient attribution evidence (unresolved)
  it("5. should return unresolved when factory deployment logs do not reference expected token address", async () => {
    const expectedToken = "0x4444444444444444444444444444444444444444";
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 1000n,
        contractAddress: null,
        logs: [
          {
            address: "0x9999999999999999999999999999999999999999", // Unrelated emitter
            topics: ["0x1111111111111111111111111111111111111111111111111111111111111111"],
            data: "0x00",
          },
        ],
      }),
    };

    const res = await verifyEvmDeploymentAttribution("0x" + "1".repeat(64), expectedToken, "base", mockClient);
    expect(res.status).toBe("unresolved");
    expect(res.reason).toContain("no logs or event references match expected token address");
  });

  // 6. Successful buy with tx hash + balance delta (transaction_verified)
  it("6. should assign attribution_status: 'transaction_verified' when buy tx hash is confirmed", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;
    const testWallet = "0x1234567890123456789012345678901234567890";
    const buyTx = "0x" + "a".repeat(64);

    createPendingPosition({
      deployLogId: 601,
      chain: "base",
      contractAddr: testContract,
      ticker: "BUY_TX",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: testWallet,
      balanceBefore: "0",
    });

    updatePositionReconciliation(testContract, { buyTxHash: buyTx });

    // Mock EVM tx attribution
    const txSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "1000000000000000000000",
      decimals: 18,
      formatted: "1000",
    }));

    const evmSpy = spyOn(require("../src/modules/reconciliation/evm-verifier.ts"), "verifyEvmTransactionAttribution").mockResolvedValueOnce({
      status: "confirmed",
      tokenTransferred: true,
      walletInvolved: true,
    });

    await reconcilePendingBuys();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("open");
    expect(pos?.attributionStatus).toBe("transaction_verified");

    txSpy.mockRestore();
    evmSpy.mockRestore();
  });

  // 7. Buy with pre-existing balance and no delta
  it("7. should keep position in buy_submitted with unresolved attribution when no net token inflow occurs", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 602,
      chain: "base",
      contractAddr: testContract,
      ticker: "PRE_EX",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "5000",
    });

    const txSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "5000",
      decimals: 18,
      formatted: "5000",
    }));

    await reconcilePendingBuys();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("buy_submitted");
    expect(pos?.attributionStatus).toBe("unresolved");

    txSpy.mockRestore();
  });

  // 8. Buy balance delta without tx attribution (balance_delta_only)
  it("8. should assign attribution_status: 'balance_delta_only' when balance increases without buy tx hash", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 603,
      chain: "base",
      contractAddr: testContract,
      ticker: "BAL_ONLY",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
    });

    const txSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "7000",
      decimals: 18,
      formatted: "7000",
    }));

    await reconcilePendingBuys();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("open");
    expect(pos?.attributionStatus).toBe("balance_delta_only");

    txSpy.mockRestore();
  });

  // 9. Successful sell with verified proceeds and tx hash (transaction_verified)
  it("9. should assign attribution_status: 'transaction_verified' when sell tx is confirmed on-chain", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;
    const sellTx = "0x" + "b".repeat(64);

    createPendingPosition({
      deployLogId: 604,
      chain: "base",
      contractAddr: testContract,
      ticker: "SELL_TX",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
    });

    transitionPositionState(testContract, "buy_submitted", "open", {
      currentBalance: "1000",
      balanceAfter: "1000",
      entryPrice: 1.0,
    });

    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    updatePositionReconciliation(testContract, {
      sellTxHash: sellTx,
      entryCostRaw: "0.05",
      exitProceedsRaw: "0.10",
      exitFeeRaw: "0.002",
    });

    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "0",
      decimals: 18,
      formatted: "0",
    }));

    const evmSpy = spyOn(require("../src/modules/reconciliation/evm-verifier.ts"), "verifyEvmTransactionAttribution").mockResolvedValueOnce({
      status: "confirmed",
      tokenTransferred: true,
      walletInvolved: true,
    });

    await reconcileClosingPositions();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("sold_tp");
    expect(pos?.attributionStatus).toBe("transaction_verified");
    expect(pos?.pnlStatus).toBe("calculated");
    expect(pos?.realizedPnl).toBeCloseTo(0.048); // 0.10 - 0.002 - 0.05 = 0.048 ETH

    balSpy.mockRestore();
    evmSpy.mockRestore();
  });

  // 10. Sell with token balance decrease but no tx attribution
  it("10. should assign attribution_status: 'balance_delta_only' when exit is verified by zero balance without sell tx", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 605,
      chain: "base",
      contractAddr: testContract,
      ticker: "SELL_BAL",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
    });

    transitionPositionState(testContract, "buy_submitted", "open", {
      currentBalance: "1000",
      balanceAfter: "1000",
      entryPrice: 1.0,
    });

    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "0",
      decimals: 18,
      formatted: "0",
    }));

    await reconcileClosingPositions();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("sold_tp");
    expect(pos?.attributionStatus).toBe("balance_delta_only");

    balSpy.mockRestore();
  });

  // 11. Partial sell on EVM
  it("11. should handle partial sell by updating current balance and calculating proportional realized PnL", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 606,
      chain: "base",
      contractAddr: testContract,
      ticker: "PART_EVM",
      snipeAmount: 0.1,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
    });

    transitionPositionState(testContract, "buy_submitted", "open", {
      currentBalance: "1000",
      balanceAfter: "1000",
      entryPrice: 1.0,
    });

    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    updatePositionReconciliation(testContract, {
      entryCostRaw: "0.10",
      exitProceedsRaw: "0.10", // 500 tokens sold at 2.0 = 0.10 proceeds
    });

    // 500 tokens remain (50% exit)
    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "500",
      decimals: 18,
      formatted: "500",
    }));

    await reconcileClosingPositions();

    const pos = getPositionByContract(testContract);
    expect(pos?.currentBalance).toBe("500");
    expect(pos?.pnlStatus).toBe("calculated");
    // Allocated cost is 50% of 0.10 = 0.05. Net proceeds = 0.10. Realized PnL = 0.05.
    expect(pos?.realizedPnl).toBeCloseTo(0.05);

    balSpy.mockRestore();
  });

  // 12. RPC failure during attribution
  it("12. should return status: 'unknown' during EVM RPC failure without crashing or mutating DB", async () => {
    const mockClient: any = {
      getTransactionReceipt: async () => {
        throw new Error("RPC error: 504 Gateway Timeout");
      },
    };

    const res = await verifyEvmDeploymentAttribution("0x" + "1".repeat(64), "0x" + "2".repeat(40), "base", mockClient);
    expect(res.status).toBe("unknown");
    expect(res.reason).toContain("RPC_FAILURE");
  });

  // ─── SOLANA ATTRIBUTION ─────────────────────────────────────

  // 13. Confirmed deployment/buy/sell signature
  it("13. should verify confirmed Solana transaction attribution", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: { slot: 100, confirmationStatus: "confirmed", err: null },
      }),
      getParsedTransaction: async () => ({
        meta: { err: null },
      }),
    };

    const res = await verifySolanaTransactionAttribution("5" + "a".repeat(60), undefined, undefined, mockConn);
    expect(res.status).toBe("confirmed");
  });

  // 14. Failed signature with on-chain error
  it("14. should mark Solana transaction attribution as failed on on-chain instruction error", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: { slot: 100, confirmationStatus: "finalized", err: { InstructionError: [1, "Custom: 0"] } },
      }),
    };

    const res = await verifySolanaTransactionAttribution("5" + "a".repeat(60), undefined, undefined, mockConn);
    expect(res.status).toBe("failed");
    expect(res.reason).toContain("on-chain error");
  });

  // 15. Transaction metadata with wrong mint
  it("15. should flag mintMatched: false when parsed transaction does not contain expected mint", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: { slot: 100, confirmationStatus: "confirmed", err: null },
      }),
      getParsedTransaction: async () => ({
        meta: {
          err: null,
          preTokenBalances: [{ mint: "UnrelatedMint1111111111111111111111111111" }],
          postTokenBalances: [{ mint: "UnrelatedMint1111111111111111111111111111" }],
        },
      }),
    };

    const res = await verifySolanaTransactionAttribution("5" + "a".repeat(60), "ExpectedMint11111111111111111111111111111", undefined, mockConn);
    expect(res.status).toBe("confirmed");
    expect(res.mintMatched).toBe(false);
  });

  // 16. Transaction metadata with wrong owner
  it("16. should flag walletMatched: false when parsed transaction does not belong to expected owner", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: { slot: 100, confirmationStatus: "confirmed", err: null },
      }),
      getParsedTransaction: async () => ({
        meta: {
          err: null,
          preTokenBalances: [{ owner: "OtherOwner11111111111111111111111111111111" }],
          postTokenBalances: [{ owner: "OtherOwner11111111111111111111111111111111" }],
        },
      }),
    };

    const res = await verifySolanaTransactionAttribution("5" + "a".repeat(60), undefined, "ExpectedOwner11111111111111111111111111111", mockConn);
    expect(res.status).toBe("confirmed");
    expect(res.walletMatched).toBe(false);
  });

  // 17. Balance delta without signature (balance_delta_only)
  it("17. should assign attribution_status: 'balance_delta_only' for Solana buy when no signature is provided", async () => {
    const testMint = "So11111111111111111111111111111111111111112";

    createPendingPosition({
      deployLogId: 607,
      chain: "solana",
      contractAddr: testMint,
      ticker: "SOL_BUY",
      snipeAmount: 0.1,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      balanceBefore: "0",
    });

    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "500000000",
      decimals: 6,
      formatted: "500",
    }));

    await reconcilePendingBuys();

    const pos = getPositionByContract(testMint);
    expect(pos?.status).toBe("open");
    expect(pos?.attributionStatus).toBe("balance_delta_only");

    balSpy.mockRestore();
  });

  // 18. Multiple token accounts summed properly
  it("18. should correctly sum token amounts across multiple SPL token accounts for same mint", async () => {
    const mockConn: any = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          {
            account: {
              data: { parsed: { info: { tokenAmount: { amount: "300000000", decimals: 6, uiAmount: 300 } } } },
            },
          },
          {
            account: {
              data: { parsed: { info: { tokenAmount: { amount: "700000000", decimals: 6, uiAmount: 700 } } } },
            },
          },
        ],
      }),
    };

    const bal = await verifySolanaTokenBalance(
      "So11111111111111111111111111111111111111112",
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      mockConn
    );
    expect(bal?.rawBalance).toBe("1000000000"); // 300M + 700M = 1,000,000,000 (1000 UI)
    expect(bal?.uiAmountString).toBe("1000");
  });

  // 19. Partial sell on Solana
  it("19. should handle partial sell on Solana with proportional cost accounting", () => {
    const pnl = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 400n, // 40% sold
      entryCostNative: 2.0, // 2 SOL
      exitProceedsNative: 1.2, // 1.2 SOL received
      entryFees: 0.01,
      exitFees: 0.005,
    });

    expect(pnl.isPartialExit).toBe(true);
    expect(pnl.tokensRemaining).toBe(600n);
    expect(pnl.allocatedEntryCost).toBeCloseTo(0.804); // 40% of (2.0 + 0.01) = 0.804
    expect(pnl.netExitProceeds).toBeCloseTo(1.195); // 1.2 - 0.005 = 1.195
    expect(pnl.realizedPnl).toBeCloseTo(0.391); // 1.195 - 0.804 = +0.391 SOL
  });

  // 20. RPC failure on Solana
  it("20. should return unknown on Solana RPC network partition without assuming transaction failure", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => {
        throw new Error("HTTP 502 Bad Gateway");
      },
    };

    const res = await verifySolanaTransaction("5" + "a".repeat(60), mockConn);
    expect(res.status).toBe("unknown");
    expect(res.reason).toContain("RPC_FAILURE");
  });

  // ─── REALIZED PNL & ACCOUNTING ──────────────────────────────

  // 21. Exact full-position PnL
  it("21. should compute exact full-position realized PnL = netExitProceeds - allocatedEntryCost", () => {
    const res = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 1000n,
      entryCostNative: 1.0,
      exitProceedsNative: 2.5,
    });

    expect(res.pnlStatus).toBe("calculated");
    expect(res.realizedPnl).toBeCloseTo(1.5);
    expect(res.realizedPnlPercent).toBeCloseTo(150.0);
    expect(res.isPartialExit).toBe(false);
  });

  // 22. Partial-fill PnL
  it("22. should compute partial-fill realized PnL with exact proportional cost basis", () => {
    const res = calculateRealizedPnl({
      entryAmountTokens: 10000n,
      exitAmountTokens: 2500n, // 25% sold
      entryCostNative: 4.0, // 4 ETH total entry
      exitProceedsNative: 1.5, // 1.5 ETH received
    });

    expect(res.allocatedEntryCost).toBeCloseTo(1.0); // 25% of 4.0 = 1.0
    expect(res.realizedPnl).toBeCloseTo(0.5); // 1.5 - 1.0 = +0.5 ETH
    expect(res.realizedPnlPercent).toBeCloseTo(50.0);
    expect(res.isPartialExit).toBe(true);
    expect(res.tokensRemaining).toBe(7500n);
  });

  // 23. Fees included in PnL calculation
  it("23. should include transaction and trading fees in net realized PnL", () => {
    const res = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 1000n,
      entryCostNative: 1.0,
      entryFees: 0.02,
      exitProceedsNative: 2.0,
      exitFees: 0.03,
    });

    // allocatedCost = 1.0 + 0.02 = 1.02. netProceeds = 2.0 - 0.03 = 1.97.
    // realizedPnl = 1.97 - 1.02 = 0.95 ETH
    expect(res.allocatedEntryCost).toBeCloseTo(1.02);
    expect(res.netExitProceeds).toBeCloseTo(1.97);
    expect(res.realizedPnl).toBeCloseTo(0.95);
  });

  // 24. Slippage reflected by actual execution proceeds
  it("24. should reflect on-chain slippage directly in actual proceeds and realized PnL", () => {
    // Expected proceeds at 2x was 2.0 ETH, but due to slippage actual proceeds was only 1.8 ETH
    const res = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 1000n,
      entryCostNative: 1.0,
      exitProceedsNative: 1.8,
      entryPriceUsd: 10.0,
      exitPriceUsd: 20.0, // Price was 20 (+100%), but proceeds reflected slippage
    });

    expect(res.priceReturnPercent).toBeCloseTo(100.0); // Price return +100%
    expect(res.realizedPnl).toBeCloseTo(0.8); // Actual realized return +80% due to slippage
    expect(res.realizedPnlPercent).toBeCloseTo(80.0);
  });

  // 25. Missing proceeds -> PNL_PENDING (no fabricated PnL)
  it("25. should set pnlStatus: 'pnl_pending' and undefined realized PnL when proceeds are missing", () => {
    const res = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 1000n,
      entryCostNative: 1.0,
      // exitProceedsNative missing
    });

    expect(res.pnlStatus).toBe("pnl_pending");
    expect(res.realizedPnl).toBeUndefined();
    expect(res.reason).toContain("missing");
  });

  // 26. Missing cost basis -> PNL_PENDING
  it("26. should set pnlStatus: 'pnl_pending' when entry cost basis is missing", () => {
    const res = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 1000n,
      exitProceedsNative: 2.0,
      // entryCostNative missing
    });

    expect(res.pnlStatus).toBe("pnl_pending");
    expect(res.realizedPnl).toBeUndefined();
  });

  // 27. Repeated reconciliation does not alter PnL (idempotency)
  it("27. should produce identical PnL outcomes across repeated reconciliation passes", () => {
    const input = {
      entryAmountTokens: 5000n,
      exitAmountTokens: 5000n,
      entryCostNative: 0.5,
      exitProceedsNative: 1.2,
      entryFees: 0.005,
      exitFees: 0.005,
    };

    const pass1 = calculateRealizedPnl(input);
    const pass2 = calculateRealizedPnl(input);

    expect(pass1.realizedPnl).toBe(pass2.realizedPnl);
    expect(pass1.realizedPnlPercent).toBe(pass2.realizedPnlPercent);
  });

  // 28. No invented PnL when only price moved without exit
  it("28. should not calculate realized PnL if no exit tokens were sold", () => {
    const res = calculateRealizedPnl({
      entryAmountTokens: 1000n,
      exitAmountTokens: 0n, // Holding
      entryCostNative: 1.0,
      entryPriceUsd: 1.0,
      exitPriceUsd: 5.0, // Dex price is 5x, but position is still held
    });

    expect(res.priceReturnPercent).toBe(400); // +400% price move
    expect(res.pnlStatus).toBe("pnl_pending");
    expect(res.realizedPnl).toBeUndefined(); // No fabricated PnL when held
    expect(res.tokensRemaining).toBe(1000n);
  });

  // ─── SAFETY INVARIANTS ──────────────────────────────────────

  // 29. RPC failure causes zero mutations and zero buy/sell triggers
  it("29. should ensure RPC failures cause ZERO trading mutations or retries", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 608,
      chain: "base",
      contractAddr: testContract,
      ticker: "RPC_SAFETY",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
    });

    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => null);
    const buySpy = spyOn(sniperModule, "snipeNewToken");
    const sellSpy = spyOn(sniperModule, "sellToken");

    await runOnchainReconciliation();

    expect(buySpy).not.toHaveBeenCalled();
    expect(sellSpy).not.toHaveBeenCalled();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("buy_submitted");

    balSpy.mockRestore();
    buySpy.mockRestore();
    sellSpy.mockRestore();
  }, 15000);

  // 30. Weak evidence cannot overwrite stronger evidence
  it("30. should ensure weak evidence (balance_delta_only) CANNOT overwrite stronger evidence (transaction_verified)", () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 609,
      chain: "base",
      contractAddr: testContract,
      ticker: "MONOTONIC",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
      attributionStatus: "transaction_verified",
      attributionReason: "Direct on-chain transaction receipt confirmed",
    });

    // Attempt to update with weaker evidence
    updatePositionReconciliation(testContract, {
      attributionStatus: "balance_delta_only",
      attributionReason: "Balance changed without tx hash",
    });

    const pos = getPositionByContract(testContract);
    // MUST preserve transaction_verified!
    expect(pos?.attributionStatus).toBe("transaction_verified");
    expect(pos?.attributionReason).toBe("Direct on-chain transaction receipt confirmed");
  });

  // 31. Concurrent reconciliations remain mutually exclusive via locks
  it("31. should enforce mutual exclusion so concurrent reconciliations do not collide", async () => {
    const acquired = acquireLock("onchain_reconciler", 60);
    expect(acquired).toBe(true);

    // Another worker attempting to run must skip gracefully
    await runOnchainReconciliation();

    expect(isLockHeld("onchain_reconciler")).toBe(true);
    releaseLock("onchain_reconciler");
  });

  // 32. Restart/reconciliation after interruption is strictly idempotent
  it("32. should maintain identical state when reconciliation is restarted after interruption", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 610,
      chain: "base",
      contractAddr: testContract,
      ticker: "IDEMP_RESTART",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1234567890123456789012345678901234567890",
      balanceBefore: "0",
    });

    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => ({
      rawBalance: "1000",
      decimals: 18,
      formatted: "1000",
    }));

    // Run 1
    await reconcilePendingBuys();
    const state1 = getPositionByContract(testContract);

    // Run 2 (simulating restart)
    await reconcilePendingBuys();
    const state2 = getPositionByContract(testContract);

    expect(state1?.status).toBe("open");
    expect(state2?.status).toBe("open");
    expect(state1?.attributionStatus).toBe(state2?.attributionStatus);
    expect(state1?.balanceAfter).toBe(state2?.balanceAfter);

    balSpy.mockRestore();
  });
});
