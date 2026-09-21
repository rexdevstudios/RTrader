/**
 * tests/onchain-reconciliation.test.ts
 *
 * Test suite for Milestone V2.1 — Task 3: On-chain Reconciliation & Balance Verifier
 *
 * Scenarios:
 * EVM:
 *  1. pending deployment receipt
 *  2. successful deployment receipt
 *  3. failed deployment receipt
 *  4. RPC timeout (returns status: "unknown", NEVER "failed")
 *  5. malformed receipt / txHash
 *  6. wrong chain handling
 *  7. token balance verification (balanceOf, decimals, raw string)
 * Solana:
 *  8. pending transaction
 *  9. confirmed transaction
 *  10. failed transaction
 *  11. token balance verification (SPL token accounts)
 *  12. RPC failure (returns status: "unknown", NEVER "failed")
 * Position:
 *  13. BUY_SUBMITTED remains pending without balance evidence
 *  14. BUY_SUBMITTED -> POSITION_OPEN after verified balance delta
 *  15. POSITION_CLOSING remains closing while sell is unconfirmed
 *  16. POSITION_CLOSING -> POSITION_CLOSED after verified exit
 *  17. existing pre-buy balance does not falsely confirm buy
 *  18. duplicate reconciliation is idempotent
 *  19. concurrent reconciliation cannot corrupt state (lock protection)
 *  20. RPC failure never triggers buy/sell retry
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import {
  verifyEvmTransactionReceipt,
  verifyEvmTokenBalance,
  getEvmPublicClient,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  verifySolanaTransaction,
  verifySolanaTokenBalance,
} from "../src/modules/reconciliation/solana-verifier.ts";
import * as reconcilerModule from "../src/modules/reconciliation/onchain-reconciler.ts";
import {
  reconcilePendingBuys,
  reconcileClosingPositions,
  runOnchainReconciliation,
} from "../src/modules/reconciliation/onchain-reconciler.ts";
import {
  createPendingPosition,
  getPositionByContract,
  transitionPositionState,
  acquireLock,
  releaseLock,
  isLockHeld,
  DB_PATH,
} from "../src/db/vault.ts";
import * as sniperModule from "../src/modules/sniper/basedbot-sniper.ts";

describe("Milestone V2.1 Task 3 — On-chain Reconciliation & Balance Verifier", () => {
  beforeEach(() => {
    releaseLock("onchain_reconciler");
    releaseLock("test_rec_lock");
  });

  afterEach(() => {
    releaseLock("onchain_reconciler");
    releaseLock("test_rec_lock");
  });

  afterAll(() => {
    try {
      const db = new Database(DB_PATH);
      db.run("DELETE FROM active_positions WHERE ticker IN ('TEST1', 'RACE', 'EXIT_TEST', 'RESTART_TEST', 'NO_DELTA', 'VERIFIED_BUY', 'STILL_CLOSING', 'CONFIRMED_EXIT', 'PRE_EXISTING', 'IDEMPOTENT_TEST', 'RPC_FAIL_TEST')");
    } catch {
      /* ignore */
    }
  });

  // ─── EVM VERIFICATION ───────────────────────────────────────

  // 1. pending deployment receipt
  it("1. should return status: 'pending' when EVM transaction is not yet mined", async () => {
    const mockClient: any = {
      getTransactionReceipt: async () => {
        throw new Error("TransactionNotFoundError: Transaction with hash 0x... could not be found.");
      },
    };

    const res = await verifyEvmTransactionReceipt(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      "base",
      mockClient
    );
    expect(res.status).toBe("pending");
    expect(res.reason).toContain("not yet mined");
  });

  // 2. successful deployment receipt
  it("2. should return status: 'confirmed' when EVM transaction receipt status is 'success'", async () => {
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 12345678n,
        contractAddress: "0x2222222222222222222222222222222222222222",
      }),
    };

    const res = await verifyEvmTransactionReceipt(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      "base",
      mockClient
    );
    expect(res.status).toBe("confirmed");
    expect(res.blockNumber).toBe(12345678n);
    expect(res.contractAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  // 3. failed deployment receipt
  it("3. should return status: 'failed' when EVM transaction receipt status is 'reverted'", async () => {
    const mockClient: any = {
      getTransactionReceipt: async () => ({
        status: "reverted",
        blockNumber: 12345678n,
      }),
    };

    const res = await verifyEvmTransactionReceipt(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      "base",
      mockClient
    );
    expect(res.status).toBe("failed");
    expect(res.reason).toContain("Transaction reverted on-chain");
  });

  // 4. RPC timeout (returns status: "unknown", NEVER "failed")
  it("4. should return status: 'unknown' on RPC network timeout without assuming transaction failed", async () => {
    const mockClient: any = {
      getTransactionReceipt: async () => {
        throw new Error("ETIMEDOUT: Connection timed out after 15000ms");
      },
    };

    const res = await verifyEvmTransactionReceipt(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      "base",
      mockClient
    );
    expect(res.status).toBe("unknown");
    expect(res.reason).toContain("RPC_FAILURE");
    expect(res.status).not.toBe("failed");
  });

  // 5. malformed receipt / txHash
  it("5. should safely reject malformed EVM transaction hash without throwing", async () => {
    const res = await verifyEvmTransactionReceipt("invalid_not_hex_txhash", "base");
    expect(res.status).toBe("error");
    expect(res.reason).toContain("Malformed EVM transaction hash");
  });

  // 6. wrong chain handling
  it("6. should reject unsupported chain with clear diagnostic error", () => {
    // H7 FIX: getEvmPublicClient returns null for unsupported chains instead of throwing,
    // preventing reconciler crashes when BSC/ETH positions exist.
    const client = getEvmPublicClient("polygon_unsupported");
    expect(client).toBeNull();
  });

  // 7. token balance verification (balanceOf, decimals, raw string)
  it("7. should read raw ERC-20 token balance and format decimals safely without float math", async () => {
    const mockClient: any = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") return 18;
        if (functionName === "balanceOf") return 1500000000000000000000n; // 1500 tokens
        return 0n;
      },
    };

    const bal = await verifyEvmTokenBalance(
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      "base",
      mockClient
    );

    expect(bal).not.toBeNull();
    expect(bal?.rawBalance).toBe(1500000000000000000000n);
    expect(bal?.balanceString).toBe("1500000000000000000000");
    expect(bal?.decimals).toBe(18);
    expect(bal?.formattedBalance).toBe("1500");
  });

  // ─── SOLANA VERIFICATION ────────────────────────────────────

  // 8. pending transaction
  it("8. should return status: 'pending' when Solana signature is processed or not yet confirmed", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: {
          slot: 12345,
          confirmationStatus: "processed",
          err: null,
        },
      }),
    };

    const res = await verifySolanaTransaction("5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", mockConn);
    expect(res.status).toBe("pending");
    expect(res.confirmationStatus).toBe("processed");
  });

  // 9. confirmed transaction
  it("9. should return status: 'confirmed' when Solana signature confirmationStatus is 'confirmed' or 'finalized'", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: {
          slot: 12345,
          confirmationStatus: "confirmed",
          err: null,
        },
      }),
    };

    const res = await verifySolanaTransaction("5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", mockConn);
    expect(res.status).toBe("confirmed");
    expect(res.slot).toBe(12345);
  });

  // 10. failed transaction
  it("10. should return status: 'failed' when Solana signature has on-chain error", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => ({
        value: {
          slot: 12345,
          confirmationStatus: "finalized",
          err: { InstructionError: [0, "Custom: 1"] },
        },
      }),
    };

    const res = await verifySolanaTransaction("5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", mockConn);
    expect(res.status).toBe("failed");
    expect(res.reason).toContain("Solana transaction failed with on-chain error");
  });

  // 11. token balance verification (SPL token accounts)
  it("11. should parse SPL token account balances summing raw tokens safely", async () => {
    const mockConn: any = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    tokenAmount: {
                      amount: "500000000",
                      decimals: 6,
                      uiAmount: 500,
                    },
                  },
                },
              },
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

    expect(bal).not.toBeNull();
    expect(bal?.rawBalance).toBe("500000000");
    expect(bal?.decimals).toBe(6);
    expect(bal?.uiAmountString).toBe("500");
  });

  // 12. RPC failure on Solana (returns status: "unknown", NEVER "failed")
  it("12. should return status: 'unknown' on Solana RPC network failure without assuming transaction failed", async () => {
    const mockConn: any = {
      getSignatureStatus: async () => {
        throw new Error("FetchError: 503 Service Unavailable");
      },
    };

    const res = await verifySolanaTransaction("5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", mockConn);
    expect(res.status).toBe("unknown");
    expect(res.reason).toContain("RPC_FAILURE");
    expect(res.status).not.toBe("failed");
  });

  // ─── POSITION & RECONCILIATION LIFECYCLE ────────────────────

  // 13. BUY_SUBMITTED remains pending without balance evidence
  it("13. should keep position in BUY_SUBMITTED when on-chain token balance has not increased", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 501,
      chain: "base",
      contractAddr: testContract,
      ticker: "NO_DELTA",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "0", decimals: 18, formatted: "0" };
      }
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcilePendingBuys();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("buy_submitted");
    expect(pos?.reconciliationStatus).toBe("pending");

    spy.mockRestore();
  });

  // 14. BUY_SUBMITTED -> POSITION_OPEN after verified balance delta
  it("14. should transition BUY_SUBMITTED -> POSITION_OPEN only when on-chain balance strictly exceeds baseline", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 502,
      chain: "base",
      contractAddr: testContract,
      ticker: "VERIFIED_BUY",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "1000000000000000000000", decimals: 18, formatted: "1000" };
      }
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcilePendingBuys();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("open");
    expect(pos?.reconciliationStatus).toBe("confirmed");
    expect(pos?.balanceAfter).toBe("1000000000000000000000");

    spy.mockRestore();
  });

  // 15. POSITION_CLOSING remains closing while sell is unconfirmed
  it("15. should maintain POSITION_CLOSING when wallet still holds tokens on-chain", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 503,
      chain: "base",
      contractAddr: testContract,
      ticker: "STILL_CLOSING",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    // Move to open, then closing
    transitionPositionState(testContract, "buy_submitted", "open", {
      entryPrice: 1.0,
      currentBalance: "1000000000000000000000",
      balanceAfter: "1000000000000000000000",
    });
    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "1000000000000000000000", decimals: 18, formatted: "1000" };
      }
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcileClosingPositions();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("closing");
    expect(pos?.closedAt).toBeNull();

    spy.mockRestore();
  });

  // 16. POSITION_CLOSING -> POSITION_CLOSED after verified exit
  it("16. should transition POSITION_CLOSING -> sold_tp/sold_sl when wallet token balance is 0 on-chain", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 504,
      chain: "base",
      contractAddr: testContract,
      ticker: "CONFIRMED_EXIT",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    // Move to open with entryPrice 1.0
    transitionPositionState(testContract, "buy_submitted", "open", {
      entryPrice: 1.0,
      currentBalance: "1000000000000000000000",
      balanceAfter: "1000000000000000000000",
    });

    // Move to closing with exitPrice 2.0 and exitReason take_profit
    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
      exitAmount: 0.05,
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "0", decimals: 18, formatted: "0" };
      }
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcileClosingPositions();

    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("sold_tp");
    expect(pos?.closedAt).not.toBeNull();
    expect(pos?.reconciliationStatus).toBe("confirmed");
    // C4 FIX: Without actual exitProceedsNative, PnL correctly stays pnl_pending
    // instead of fabricating a dimensionally-invalid number.
    // priceReturnPercent is still calculated from entry/exit USD prices.
    expect(pos?.pnlStatus).toBe("pnl_pending");
    expect(pos?.priceReturnPercent).toBeCloseTo(100.0); // (2.0 - 1.0) / 1.0 * 100 = +100%

    spy.mockRestore();
  });

  // 17. existing pre-buy balance does not falsely confirm buy
  it("17. should NOT falsely confirm buy when wallet already had tokens and balance did not change", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    // Wallet had 500 tokens before order was sent
    createPendingPosition({
      deployLogId: 505,
      chain: "base",
      contractAddr: testContract,
      ticker: "PRE_EXISTING",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "500000000000000000000", // 500 tokens baseline
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "500000000000000000000", decimals: 18, formatted: "500" };
      }
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcilePendingBuys();

    const pos = getPositionByContract(testContract);
    // MUST remain buy_submitted (no false confirmation!)
    expect(pos?.status).toBe("buy_submitted");
    expect(pos?.reconciliationStatus).toBe("pending");

    spy.mockRestore();
  });

  // 18. duplicate reconciliation is idempotent
  it("18. should ensure repeated reconciliation passes are strictly idempotent with no duplicate state changes", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 506,
      chain: "base",
      contractAddr: testContract,
      ticker: "IDEMPOTENT_TEST",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "1000000000000000000000", decimals: 18, formatted: "1000" };
      }
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    // Pass 1: moves to open
    await reconcilePendingBuys();
    const state1 = getPositionByContract(testContract);
    expect(state1?.status).toBe("open");

    // Pass 2: idempotent, no pending buys remaining, state remains identical
    await reconcilePendingBuys();
    const state2 = getPositionByContract(testContract);
    expect(state2?.status).toBe("open");
    expect(state2?.balanceAfter).toBe(state1?.balanceAfter);

    spy.mockRestore();
  });

  // 19. concurrent reconciliation cannot corrupt state
  it("19. should prevent concurrent reconciliation passes via mutual exclusion lock", async () => {
    // Acquire lock manually
    const acquired1 = acquireLock("onchain_reconciler", 60);
    expect(acquired1).toBe(true);

    // Concurrent runOnchainReconciliation call must detect lock and gracefully skip
    await runOnchainReconciliation();

    // Lock is still held by test
    expect(isLockHeld("onchain_reconciler")).toBe(true);

    releaseLock("onchain_reconciler");
    expect(isLockHeld("onchain_reconciler")).toBe(false);
  });

  // 20. RPC failure never triggers buy/sell retry
  it("20. should guarantee that RPC failures never trigger trading mutations or retries", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 507,
      chain: "base",
      contractAddr: testContract,
      ticker: "RPC_FAIL_TEST",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    // Mock fetchOnchainTokenBalance returning null (simulating RPC timeout/down)
    const balSpy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => null);
    const snipeSpy = spyOn(sniperModule, "snipeNewToken");
    const sellSpy = spyOn(sniperModule, "sellToken");

    await reconcilePendingBuys();

    // Invariant: ZERO buy calls, ZERO sell calls
    expect(snipeSpy).not.toHaveBeenCalled();
    expect(sellSpy).not.toHaveBeenCalled();

    // Position remains safely untouched in buy_submitted
    const pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("buy_submitted");

    balSpy.mockRestore();
    snipeSpy.mockRestore();
    sellSpy.mockRestore();
  });
});
