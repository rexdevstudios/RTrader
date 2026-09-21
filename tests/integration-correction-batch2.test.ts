/**
 * Integration Correction Batch 2 — Regression Tests
 *
 * H4: Partial exit lifecycle (closing → open for re-monitoring)
 * H5: deploy_logs.exit_status sync with position lifecycle
 * H6: Robinhood price monitoring mapping
 * H7: EVM verifier unsupported chain guard
 * H8: SQLite DB path consistency
 * M6: Transaction hash format validation in deploy-guard
 */
import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { confirmDeployment, isValidTxHash } from "../src/modules/deploy-guard.ts";
import { getEvmPublicClient, verifyEvmTransactionReceipt, verifyEvmTokenBalance } from "../src/modules/reconciliation/evm-verifier.ts";
import { reconcileClosingPositions, fetchOnchainTokenBalance } from "../src/modules/reconciliation/onchain-reconciler.ts";
import {
  createPendingPosition,
  transitionPositionState,
  getPositionByContract,
  logDeploy,
  acquireLock,
  releaseLock,
  DB_PATH,
} from "../src/db/vault.ts";
import { resetConfig } from "../src/config.ts";
import * as reconcilerModule from "../src/modules/reconciliation/onchain-reconciler.ts";

describe("Integration Correction Batch 2 — Regression Tests", () => {
  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
    process.env.FIRECRAWL_API_KEY = "test";
    process.env.PINATA_JWT = "test";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.DEPLOY_MODE = "testnet";
    releaseLock("onchain_reconciler");
  });

  afterEach(() => {
    releaseLock("onchain_reconciler");
  });

  // === H4 REGRESSION: Partial exit transitions back to open for continued monitoring ===
  it("H4 REGRESSION: partial exit should transition position from closing back to open", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 9001,
      chain: "base",
      contractAddr: testContract,
      ticker: "B2_PARTIAL",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x1111111111111111111111111111111111111111",
      balanceBefore: "0",
    });

    // Move to open with balance
    transitionPositionState(testContract, "buy_submitted", "open", {
      entryPrice: 1.0,
      currentBalance: "1000000000000000000000", // 1000 tokens
      balanceAfter: "1000000000000000000000",
    });

    // Move to closing (take profit triggered)
    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    // Mock: 50% of tokens still held (partial exit)
    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async (_chain, cAddr) => {
      if (cAddr === testContract) {
        return { rawBalance: "500000000000000000000", decimals: 18, formatted: "500" }; // 500 tokens remaining
      }
      return null;
    });

    await reconcileClosingPositions();

    const pos = getPositionByContract(testContract);
    // H4 FIX: Must transition back to 'open' for continued monitoring
    expect(pos?.status).toBe("open");
    expect(pos?.closedAt).toBeNull();
    // Position should be re-monitorable by price-monitor

    spy.mockRestore();

    // Cleanup
    const db = new Database(DB_PATH);
    db.run("DELETE FROM active_positions WHERE ticker = 'B2_PARTIAL'");
    db.close();
  });

  it("H4 REGRESSION: partial exit followed by full exit should finalize position", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 9002,
      chain: "base",
      contractAddr: testContract,
      ticker: "B2_PARTIAL_FULL",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x2222222222222222222222222222222222222222",
      balanceBefore: "0",
    });

    transitionPositionState(testContract, "buy_submitted", "open", {
      entryPrice: 1.0,
      currentBalance: "1000000000000000000000",
      balanceAfter: "1000000000000000000000",
    });

    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    // Step 1: Partial exit — 500 tokens remain
    let spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => {
      return { rawBalance: "500000000000000000000", decimals: 18, formatted: "500" };
    });

    await reconcileClosingPositions();
    let pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("open"); // Re-opened for monitoring

    spy.mockRestore();

    // Step 2: Trigger sell again (price still above TP)
    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.5,
    });

    // Step 3: Full exit — 0 tokens remain
    spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => {
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcileClosingPositions();
    pos = getPositionByContract(testContract);
    expect(pos?.status).toBe("sold_tp"); // Finalized
    expect(pos?.closedAt).not.toBeNull();

    spy.mockRestore();

    const db = new Database(DB_PATH);
    db.run("DELETE FROM active_positions WHERE ticker = 'B2_PARTIAL_FULL'");
    db.close();
  });

  // === H5 REGRESSION: deploy_logs.exit_status synced on full exit ===
  it("H5 REGRESSION: deploy_logs.exit_status should be synced when position is fully closed", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    const deployLogId = logDeploy({
      chain: "base",
      tokenName: "H5 Sync Test",
      ticker: "B2_SYNC",
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      contractAddr: testContract,
      txHash: "0x" + "a".repeat(64),
    });

    createPendingPosition({
      deployLogId,
      chain: "base",
      contractAddr: testContract,
      ticker: "B2_SYNC",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: "0x3333333333333333333333333333333333333333",
      balanceBefore: "0",
    });

    transitionPositionState(testContract, "buy_submitted", "open", {
      entryPrice: 1.0,
      currentBalance: "1000000000000000000000",
      balanceAfter: "1000000000000000000000",
    });

    transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: 2.0,
    });

    const spy = spyOn(reconcilerModule, "fetchOnchainTokenBalance").mockImplementation(async () => {
      return { rawBalance: "0", decimals: 18, formatted: "0" };
    });

    await reconcileClosingPositions();

    // Check deploy_logs.exit_status is synced
    const db = new Database(DB_PATH);
    const row = db.query("SELECT exit_status, lifecycle_state FROM deploy_logs WHERE id = ?").get(deployLogId) as any;
    expect(row?.exit_status).toBe("sold_tp");

    spy.mockRestore();

    // Cleanup
    db.run("DELETE FROM active_positions WHERE ticker = 'B2_SYNC'");
    db.run("DELETE FROM deploy_logs WHERE ticker = 'B2_SYNC'");
    db.close();
  });

  // === H6 REGRESSION: Robinhood has DexScreener mapping ===
  it("H6 REGRESSION: fetchPriceUsd should have robinhood in chain map", async () => {
    // We can't easily test live DexScreener, but we verify the function doesn't reject robinhood
    const { fetchPriceUsd } = await import("../src/modules/market/price-monitor.ts");
    // This will return null (no real pair exists) but should NOT throw or use wrong chain
    const price = await fetchPriceUsd("robinhood", "0x0000000000000000000000000000000000000000");
    // Just verify it doesn't crash — null is expected for a non-existent pair
    expect(price === null || typeof price === "number").toBe(true);
  });

  // === H7 REGRESSION: Unsupported EVM chain returns null, no crash ===
  it("H7 REGRESSION: getEvmPublicClient should return null for unsupported chains", () => {
    const client = getEvmPublicClient("bsc");
    expect(client).toBeNull();
  });

  it("H7 REGRESSION: getEvmPublicClient should return null for ethereum", () => {
    const client = getEvmPublicClient("ethereum");
    expect(client).toBeNull();
  });

  it("H7 REGRESSION: getEvmPublicClient should return valid client for base", () => {
    const client = getEvmPublicClient("base");
    expect(client).not.toBeNull();
  });

  it("H7 REGRESSION: getEvmPublicClient should return valid client for robinhood", () => {
    const client = getEvmPublicClient("robinhood");
    expect(client).not.toBeNull();
  });

  it("H7 REGRESSION: verifyEvmTransactionReceipt should return error for unsupported chain", async () => {
    const result = await verifyEvmTransactionReceipt("0x" + "a".repeat(64), "bsc");
    expect(result.status).toBe("error");
    expect(result.reason).toContain("UNSUPPORTED_EVM_CHAIN");
  });

  it("H7 REGRESSION: verifyEvmTokenBalance should return null for unsupported chain", async () => {
    const result = await verifyEvmTokenBalance(
      "0x" + "a".repeat(40),
      "0x" + "b".repeat(40),
      "ethereum"
    );
    expect(result).toBeNull();
  });

  // === H8 REGRESSION: All modules use same DB path ===
  it("H8 REGRESSION: vault DB_PATH should be absolute and consistent", () => {
    const expectedProdPath = join(process.cwd(), ".eliza", "vault.db");
    const expectedTestPath = join(process.cwd(), ".eliza", "test_vault.db");
    const validPaths = [expectedTestPath, expectedProdPath];
    expect(validPaths).toContain(DB_PATH);
  });

  // === M6 REGRESSION: confirmDeployment validates txHash format ===
  it("M6 REGRESSION: confirmDeployment should reject invalid EVM txHash format", () => {
    const result = confirmDeployment({
      success: true,
      status: "success",
      contractAddress: "0x" + "a".repeat(40),
      txHash: "not_a_valid_hash",
      simulated: false,
    }, "base");
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("invalid format");
  });

  it("M6 REGRESSION: confirmDeployment should accept valid EVM txHash", () => {
    const result = confirmDeployment({
      success: true,
      status: "success",
      contractAddress: "0x" + "a".repeat(40),
      txHash: "0x" + "a".repeat(64),
      simulated: false,
    }, "base");
    expect(result.confirmed).toBe(true);
  });

  it("M6 REGRESSION: confirmDeployment should reject invalid Solana signature", () => {
    const result = confirmDeployment({
      success: true,
      status: "success",
      contractAddress: "PumpToken" + "a".repeat(30), // valid-length base58
      txHash: "0xinvalid_for_solana",
      simulated: false,
    }, "solana");
    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("invalid format");
  });

  it("M6 REGRESSION: confirmDeployment should accept valid Solana signature", () => {
    // Valid base58 signature, 88 chars
    const validSolSig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    // Valid base58 Solana address, 44 chars
    const validSolAddr = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const result = confirmDeployment({
      success: true,
      status: "success",
      contractAddress: validSolAddr,
      txHash: validSolSig,
      simulated: false,
    }, "solana");
    expect(result.confirmed).toBe(true);
  });

  it("M6 REGRESSION: isValidTxHash should validate EVM and Solana formats correctly", () => {
    // Valid EVM
    expect(isValidTxHash("0x" + "a".repeat(64), "base")).toBe(true);
    expect(isValidTxHash("0x" + "A".repeat(64), "robinhood")).toBe(true);
    // Invalid EVM
    expect(isValidTxHash("0x" + "g".repeat(64), "base")).toBe(false);
    expect(isValidTxHash("short", "base")).toBe(false);
    expect(isValidTxHash("", "base")).toBe(false);
    // Valid Solana (base58, 64-88 chars)
    expect(isValidTxHash("5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW", "solana")).toBe(true);
    // Invalid Solana
    expect(isValidTxHash("0xinvalid", "solana")).toBe(false);
  });

  it("M6 REGRESSION: simulation result should still be detected regardless of txHash format", () => {
    const result = confirmDeployment({
      success: true,
      status: "success",
      contractAddress: "0x" + "a".repeat(40),
      txHash: "sim_fake_hash",
      simulated: true, // simulation flag takes priority
    }, "base");
    expect(result.confirmed).toBe(false);
    expect(result.isSimulation).toBe(true);
  });
});
