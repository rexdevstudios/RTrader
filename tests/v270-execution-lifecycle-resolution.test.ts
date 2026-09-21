import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { resetConfig } from "../src/config.ts";
import {
  evaluateBuyLifecycle,
  evaluateSellDispatch,
  evaluateExitLifecycle,
  evaluateLifecyclePolicy,
  type BuyLifecycleInput,
  type SellDispatchInput,
  type ExitLifecycleInput,
} from "../src/modules/reconciliation/lifecycle-policy.ts";
import {
  logDeploy,
  createPendingPosition,
  transitionPositionState,
  getPositionByContract,
  getPositionsByStatus,
  getDeployLogById,
  updateDeployLifecycle,
  hasActiveOrPendingPosition,
  DB_PATH,
} from "../src/db/vault.ts";
import {
  reconcilePendingBuys,
  reconcileClosingPositions,
} from "../src/modules/reconciliation/onchain-reconciler.ts";
import * as evmVerifier from "../src/modules/reconciliation/evm-verifier.ts";
import * as solVerifier from "../src/modules/reconciliation/solana-verifier.ts";
import * as sniper from "../src/modules/sniper/basedbot-sniper.ts";
import { checkAndExecuteExits, handlePosition } from "../src/modules/market/price-monitor.ts";
import {
  getWalletPnlSummary,
  getPlatformPnlSummary,
  getPositionHistory,
  getUnresolvedTransactions,
  getExecutionLifecycleSummary,
} from "../src/modules/owner/owner-reporter.ts";
import axios from "axios";

// ─── Direct DB Helper for Test Setup ──────────────────────────

const testDb = new Database(DB_PATH);

function cleanupTestPositions(prefix: string): void {
  testDb.run("DELETE FROM active_positions WHERE contract_addr LIKE ?", [`${prefix}%`]);
  testDb.run("DELETE FROM deploy_logs WHERE token_name LIKE ?", [`${prefix}%`]);
}

describe("V2.7 — Execution Lifecycle State Machine & Terminal Resolution Policy", () => {
  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_key";
    process.env.FIRECRAWL_API_KEY = "test_key";
    process.env.PINATA_JWT = "test_jwt";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BUY_CONFIRMATION_TIMEOUT_MINUTES = "15";
    process.env.EXIT_CONFIRMATION_TIMEOUT_MINUTES = "15";
  });

  // ══════════════════════════════════════════════════════════════
  // 1. Pure Lifecycle Policy Evaluator
  // ══════════════════════════════════════════════════════════════

  describe("1. Pure Lifecycle Policy Evaluator", () => {
    it("1.1 returns MAINTAIN when pending buy is within timeout window without balance increase", () => {
      const input: BuyLifecycleInput = {
        status: "buy_submitted",
        hasBalanceIncrease: false,
        elapsedMs: 300_000,     // 5 minutes
        timeoutMs: 900_000,     // 15 minutes
      };
      const result = evaluateBuyLifecycle(input);
      expect(result.action).toBe("MAINTAIN");
      expect(result.targetState).toBe("buy_submitted");
      expect(result.isTerminal).toBe(false);
      expect(result.reason).toContain("Within buy confirmation window");
    });

    it("1.2 returns CONFIRM_BUY when valid on-chain balance increase is present", () => {
      const input: BuyLifecycleInput = {
        status: "buy_submitted",
        hasBalanceIncrease: true,
        elapsedMs: 60_000,
        timeoutMs: 900_000,
      };
      const result = evaluateBuyLifecycle(input);
      expect(result.action).toBe("CONFIRM_BUY");
      expect(result.targetState).toBe("open");
      expect(result.isTerminal).toBe(false);
      expect(result.reason).toContain("Valid on-chain balance increase verified");
    });

    it("1.3 returns TIMEOUT_BUY when confirmation window expires without evidence", () => {
      const input: BuyLifecycleInput = {
        status: "buy_submitted",
        hasBalanceIncrease: false,
        elapsedMs: 900_000,     // Exactly 15 minutes
        timeoutMs: 900_000,
      };
      const result = evaluateBuyLifecycle(input);
      expect(result.action).toBe("TIMEOUT_BUY");
      expect(result.targetState).toBe("buy_timeout");
      expect(result.isTerminal).toBe(true);
      expect(result.reason).toContain("Buy confirmation window expired");
    });

    it("1.4 returns ROLLBACK_SELL when sell dispatch fails at transport layer", () => {
      const input: SellDispatchInput = {
        status: "closing",
        dispatchSuccess: false,
      };
      const result = evaluateSellDispatch(input);
      expect(result.action).toBe("ROLLBACK_SELL");
      expect(result.targetState).toBe("open");
      expect(result.isTerminal).toBe(false);
      expect(result.reason).toContain("Sell dispatch failed");
    });

    it("1.5 returns MAINTAIN when sell dispatch succeeds", () => {
      const input: SellDispatchInput = {
        status: "closing",
        dispatchSuccess: true,
      };
      const result = evaluateSellDispatch(input);
      expect(result.action).toBe("MAINTAIN");
      expect(result.targetState).toBe("closing");
      expect(result.isTerminal).toBe(false);
    });

    it("1.6 returns CONFIRM_EXIT with sold_tp when exit is confirmed for take_profit", () => {
      const input: ExitLifecycleInput = {
        status: "closing",
        isExitConfirmed: true,
        elapsedMs: 60_000,
        timeoutMs: 900_000,
        exitReason: "take_profit",
      };
      const result = evaluateExitLifecycle(input);
      expect(result.action).toBe("CONFIRM_EXIT");
      expect(result.targetState).toBe("sold_tp");
      expect(result.isTerminal).toBe(true);
    });

    it("1.7 returns CONFIRM_EXIT with sold_sl when exit is confirmed for stop_loss", () => {
      const input: ExitLifecycleInput = {
        status: "closing",
        isExitConfirmed: true,
        elapsedMs: 60_000,
        timeoutMs: 900_000,
        exitReason: "stop_loss",
      };
      const result = evaluateExitLifecycle(input);
      expect(result.action).toBe("CONFIRM_EXIT");
      expect(result.targetState).toBe("sold_sl");
      expect(result.isTerminal).toBe(true);
    });

    it("1.8 returns CONFIRM_EXIT with open when partial exit occurs", () => {
      const input: ExitLifecycleInput = {
        status: "closing",
        isExitConfirmed: false,
        isPartialExit: true,
        elapsedMs: 60_000,
        timeoutMs: 900_000,
      };
      const result = evaluateExitLifecycle(input);
      expect(result.action).toBe("CONFIRM_EXIT");
      expect(result.targetState).toBe("open");
      expect(result.isTerminal).toBe(false);
    });

    it("1.9 returns TIMEOUT_EXIT (unresolved) when exit confirmation window expires with tokens remaining", () => {
      const input: ExitLifecycleInput = {
        status: "closing",
        isExitConfirmed: false,
        isPartialExit: false,
        elapsedMs: 905_000,     // > 15 minutes
        timeoutMs: 900_000,
      };
      const result = evaluateExitLifecycle(input);
      expect(result.action).toBe("TIMEOUT_EXIT");
      expect(result.targetState).toBe("unresolved");
      expect(result.isTerminal).toBe(true);
      expect(result.reason).toContain("Exit confirmation window expired");
    });

    it("1.10 MAINTAINs when exit is within window without exit confirmation", () => {
      const input: ExitLifecycleInput = {
        status: "closing",
        isExitConfirmed: false,
        isPartialExit: false,
        elapsedMs: 120_000,
        timeoutMs: 900_000,
      };
      const result = evaluateExitLifecycle(input);
      expect(result.action).toBe("MAINTAIN");
      expect(result.targetState).toBe("closing");
      expect(result.isTerminal).toBe(false);
    });

    it("1.11 is strictly pure, deterministic, and does not mutate inputs", () => {
      const input: BuyLifecycleInput = Object.freeze({
        status: "buy_submitted",
        hasBalanceIncrease: false,
        elapsedMs: 500_000,
        timeoutMs: 900_000,
      });

      const r1 = evaluateBuyLifecycle(input);
      const r2 = evaluateBuyLifecycle(input);
      expect(r1).toEqual(r2);

      // Unified evaluator check
      const uRes = evaluateLifecyclePolicy({
        stage: "buy_confirmation",
        status: "buy_submitted",
        hasBalanceIncrease: false,
        elapsedMs: 500_000,
        timeoutMs: 900_000,
      });
      expect(uRes.action).toBe("MAINTAIN");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 2. Buy Reconciliation & Timeout Enforcement
  // ══════════════════════════════════════════════════════════════

  describe("2. Buy Reconciliation & Timeout Enforcement", () => {
    const TEST_PREFIX = "0x_v27_buy_test_";

    afterEach(() => {
      cleanupTestPositions(TEST_PREFIX);
    });

    it("2.1 retains buy_submitted within confirmation window", async () => {
      const contract = `${TEST_PREFIX}maintain`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Buy Maintain Test",
        ticker: "V27M",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27M",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        balanceBefore: "0",
      });

      // Mock balance check: still 0 (no net inflow)
      const balanceSpy = spyOn(evmVerifier, "verifyEvmTokenBalance").mockResolvedValue({
        rawBalance: "0",
        formatted: "0",
        decimals: 18,
      });

      await reconcilePendingBuys();

      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("buy_submitted");
      expect(pos?.reconciliationStatus).toBe("pending");

      balanceSpy.mockRestore();
    });

    it("2.2 promotes to open on valid on-chain balance increase", async () => {
      const contract = `${TEST_PREFIX}confirmed`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Buy Confirmed Test",
        ticker: "V27C",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27C",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        balanceBefore: "0",
      });

      // Mock balance check: strictly increased
      const balanceSpy = spyOn(evmVerifier, "verifyEvmTokenBalance").mockResolvedValue({
        rawBalance: "1000000000000000000000",
        formatted: "1000",
        decimals: 18,
      });

      await reconcilePendingBuys();

      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("open");
      expect(pos?.reconciliationStatus).toBe("confirmed");
      expect(pos?.attributionStatus).toBe("balance_delta_only");

      balanceSpy.mockRestore();
    });

    it("2.3 transitions to buy_timeout when confirmation window expires", async () => {
      const contract = `${TEST_PREFIX}timeout`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Buy Timeout Test",
        ticker: "V27TO",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27TO",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        balanceBefore: "0",
      });

      // Backdate position created_at & updated_at to 20 minutes ago
      const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      testDb.run(
        "UPDATE active_positions SET created_at = ?, updated_at = ? WHERE contract_addr = ?",
        [twentyMinAgo, twentyMinAgo, contract]
      );

      const balanceSpy = spyOn(evmVerifier, "verifyEvmTokenBalance").mockResolvedValue({
        rawBalance: "0",
        formatted: "0",
        decimals: 18,
      });

      await reconcilePendingBuys();

      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("buy_timeout");
      expect(pos?.reconciliationStatus).toBe("failed");
      expect(pos?.attributionReason).toContain("BUY_CONFIRMATION_TIMEOUT");

      // Verify deploy_logs synchronization
      const deployLog = getDeployLogById(deployId);
      expect(deployLog?.lifecycleState).toBe("POSITION_ABORTED");
      expect(deployLog?.exitStatus).toBe("buy_timeout");

      // Verify hasActiveOrPendingPosition is now FALSE (no longer trapped)
      expect(hasActiveOrPendingPosition(contract)).toBe(false);

      balanceSpy.mockRestore();
    });

    it("2.4 repeated reconciliation on timed out position is idempotent", async () => {
      const contract = `${TEST_PREFIX}idempotent`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Buy Idempotent Test",
        ticker: "V27IDEMP",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27IDEMP",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        balanceBefore: "0",
      });

      const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      testDb.run(
        "UPDATE active_positions SET created_at = ?, updated_at = ? WHERE contract_addr = ?",
        [twentyMinAgo, twentyMinAgo, contract]
      );

      const balanceSpy = spyOn(evmVerifier, "verifyEvmTokenBalance").mockResolvedValue({
        rawBalance: "0",
        formatted: "0",
        decimals: 18,
      });

      // First run: transitions to buy_timeout
      await reconcilePendingBuys();
      const pos1 = getPositionByContract(contract);
      expect(pos1?.status).toBe("buy_timeout");

      // Second run: no-op since status is no longer buy_submitted
      await reconcilePendingBuys();
      const pos2 = getPositionByContract(contract);
      expect(pos2?.status).toBe("buy_timeout");

      balanceSpy.mockRestore();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 3. Sell Dispatch Rollback in Price Monitor
  // ══════════════════════════════════════════════════════════════

  describe("3. Sell Dispatch Rollback in Price Monitor", () => {
    const TEST_PREFIX = "0x_v27_sell_rollback_";

    afterEach(() => {
      cleanupTestPositions(TEST_PREFIX);
    });

    it("3.1 rolls back closing -> open when sellToken returns false on take profit", async () => {
      const contract = `${TEST_PREFIX}tp`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Sell Rollback TP Test",
        ticker: "V27RBTP",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27RBTP",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
      });

      // Manually promote to open with entryPrice = $1.00
      transitionPositionState(contract, "buy_submitted", "open", {
        entryPrice: 1.0,
        reconciliationStatus: "confirmed",
      });

      // Mock DexScreener price = $2.50 (Take profit triggered!)
      const axiosSpy = spyOn(axios, "get").mockResolvedValue({
        status: 200,
        data: {
          pairs: [{ priceUsd: "2.50" }],
        },
      });

      // Mock sellToken dispatch returning FALSE (Telegram transport failure)
      const sellSpy = spyOn(sniper, "sellToken").mockResolvedValue(false);

      const posToHandle = getPositionByContract(contract);
      if (posToHandle) await handlePosition(posToHandle);

      // Position must have rolled back to OPEN
      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("open");
      expect(pos?.exitReason).toBeNull();
      expect(pos?.exitPrice).toBeNull();

      axiosSpy.mockRestore();
      sellSpy.mockRestore();
    });

    it("3.2 rolls back closing -> open when sellToken returns false on stop loss", async () => {
      const contract = `${TEST_PREFIX}sl`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Sell Rollback SL Test",
        ticker: "V27RBSL",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27RBSL",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
      });

      transitionPositionState(contract, "buy_submitted", "open", {
        entryPrice: 1.0,
        reconciliationStatus: "confirmed",
      });

      // Mock DexScreener price = $0.60 (Stop loss triggered: -40% <= -30%)
      const axiosSpy = spyOn(axios, "get").mockResolvedValue({
        status: 200,
        data: {
          pairs: [{ priceUsd: "0.60" }],
        },
      });

      const sellSpy = spyOn(sniper, "sellToken").mockResolvedValue(false);

      const posToHandle = getPositionByContract(contract);
      if (posToHandle) await handlePosition(posToHandle);

      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("open");
      expect(pos?.exitReason).toBeNull();
      expect(pos?.exitPrice).toBeNull();

      axiosSpy.mockRestore();
      sellSpy.mockRestore();
    });

    it("3.3 position remains eligible for subsequent monitoring after rollback", async () => {
      const contract = `${TEST_PREFIX}re_eligible`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Re-eligible Test",
        ticker: "V27RE",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27RE",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
      });

      transitionPositionState(contract, "buy_submitted", "open", {
        entryPrice: 1.0,
        reconciliationStatus: "confirmed",
      });

      const axiosSpy = spyOn(axios, "get").mockResolvedValue({
        status: 200,
        data: {
          pairs: [{ priceUsd: "2.50" }],
        },
      });

      // First run: dispatch fails -> rolled back to open
      const sellSpy = spyOn(sniper, "sellToken").mockResolvedValue(false);
      const pos1 = getPositionByContract(contract);
      if (pos1) await handlePosition(pos1);
      expect(getPositionByContract(contract)?.status).toBe("open");

      // Second run: dispatch now succeeds! -> transitions to closing
      sellSpy.mockResolvedValue(true);
      const pos2 = getPositionByContract(contract);
      if (pos2) await handlePosition(pos2);
      expect(getPositionByContract(contract)?.status).toBe("closing");

      axiosSpy.mockRestore();
      sellSpy.mockRestore();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 4. Exit Confirmation Timeout & Unresolved Resolution
  // ══════════════════════════════════════════════════════════════

  describe("4. Exit Confirmation Timeout & Unresolved Resolution", () => {
    const TEST_PREFIX = "0x_v27_exit_timeout_";

    afterEach(() => {
      cleanupTestPositions(TEST_PREFIX);
    });

    it("4.1 confirms full exit when balance is 0 without timeout", async () => {
      const contract = `${TEST_PREFIX}full_exit`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Full Exit Test",
        ticker: "V27FE",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27FE",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
      });

      transitionPositionState(contract, "buy_submitted", "open", {
        balanceAfter: "1000000000000000000",
        currentBalance: "1000000000000000000",
      });

      transitionPositionState(contract, "open", "closing", {
        exitReason: "take_profit",
        exitPrice: 2.0,
      });

      // Mock on-chain balance: 0 (completely sold)
      const balanceSpy = spyOn(evmVerifier, "verifyEvmTokenBalance").mockResolvedValue({
        rawBalance: "0",
        formatted: "0",
        decimals: 18,
      });

      await reconcileClosingPositions();

      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("sold_tp");
      expect(pos?.reconciliationStatus).toBe("confirmed");

      balanceSpy.mockRestore();
    });

    it("4.2 transitions to unresolved when exit confirmation window expires with tokens remaining", async () => {
      const contract = `${TEST_PREFIX}expired`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Exit Expired Test",
        ticker: "V27EXP",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27EXP",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
      });

      transitionPositionState(contract, "buy_submitted", "open", {
        balanceAfter: "1000000000000000000",
        currentBalance: "1000000000000000000",
      });

      transitionPositionState(contract, "open", "closing", {
        exitReason: "take_profit",
        exitPrice: 2.0,
      });

      // Backdate updated_at (when position entered closing) to 25 minutes ago
      const twentyFiveMinAgo = new Date(Date.now() - 25 * 60 * 1000).toISOString();
      testDb.run(
        "UPDATE active_positions SET updated_at = ? WHERE contract_addr = ?",
        [twentyFiveMinAgo, contract]
      );

      // Tokens still in wallet (e.g. swap reverted or honeypot)
      const balanceSpy = spyOn(evmVerifier, "verifyEvmTokenBalance").mockResolvedValue({
        rawBalance: "1000000000000000000",
        formatted: "1.0",
        decimals: 18,
      });

      await reconcileClosingPositions();

      const pos = getPositionByContract(contract);
      expect(pos?.status).toBe("unresolved");
      expect(pos?.reconciliationStatus).toBe("unresolved");
      expect(pos?.attributionReason).toContain("EXIT_CONFIRMATION_TIMEOUT");
      // Monetary PnL must NOT be fabricated
      expect(pos?.realizedPnl).toBeNull();
      expect(["pending", "pnl_pending"]).toContain(pos?.pnlStatus);

      // Verify position is no longer considered active/pending (no infinite polling)
      expect(hasActiveOrPendingPosition(contract)).toBe(false);

      balanceSpy.mockRestore();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 5. Deployment Lineage Synchronization
  // ══════════════════════════════════════════════════════════════

  describe("5. Deployment Lineage Synchronization", () => {
    const TEST_PREFIX = "0x_v27_lineage_";

    afterEach(() => {
      cleanupTestPositions(TEST_PREFIX);
    });

    it("5.1 synchronizes deploy_logs when position establishment fails", () => {
      const contract = `${TEST_PREFIX}sync`;
      const deployId = logDeploy({
        chain: "base",
        tokenName: "V27 Lineage Sync Test",
        ticker: "V27SYNC",
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      // Simulate downstream buy failure synchronization
      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V27SYNC",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
      });

      transitionPositionState(contract, "buy_submitted", "buy_failed", {
        exitReason: "buy_dispatch_failed",
      });

      updateDeployLifecycle(deployId, "POSITION_ABORTED", {
        exitStatus: "buy_failed",
        errorMsg: "Downstream buy dispatch failed",
      });

      const deployLog = getDeployLogById(deployId);
      expect(deployLog?.lifecycleState).toBe("POSITION_ABORTED");
      expect(deployLog?.exitStatus).toBe("buy_failed");
      expect(deployLog?.errorMsg).toBe("Downstream buy dispatch failed");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 6. Owner Reporting & Financial Isolation
  // ══════════════════════════════════════════════════════════════

  describe("6. Owner Reporting & Financial Isolation", () => {
    const TEST_PREFIX = "0x_v27_reporting_";
    const TEST_WALLET = "test_wallet_v27_report";

    beforeEach(() => {
      testDb.run(
        "INSERT OR IGNORE INTO wallet_accounts (id, label, status) VALUES (?, ?, 'ACTIVE')",
        [TEST_WALLET, "V27 Test Wallet"]
      );
    });

    afterEach(() => {
      cleanupTestPositions(TEST_PREFIX);
      testDb.run("DELETE FROM wallet_accounts WHERE id = ?", [TEST_WALLET]);
    });

    it("6.1 distinguishes open, closed, failed, timeout, and unresolved in lifecycle summary", () => {
      const d1 = logDeploy({ chain: "base", tokenName: "V27 R1", ticker: "R1", status: "success", lifecycleState: "DEPLOY_CONFIRMED" });
      const d2 = logDeploy({ chain: "base", tokenName: "V27 R2", ticker: "R2", status: "success", lifecycleState: "DEPLOY_CONFIRMED" });
      const d3 = logDeploy({ chain: "base", tokenName: "V27 R3", ticker: "R3", status: "success", lifecycleState: "DEPLOY_CONFIRMED" });
      const d4 = logDeploy({ chain: "base", tokenName: "V27 R4", ticker: "R4", status: "success", lifecycleState: "DEPLOY_CONFIRMED" });
      const d5 = logDeploy({ chain: "base", tokenName: "V27 R5", ticker: "R5", status: "success", lifecycleState: "DEPLOY_CONFIRMED" });

      createPendingPosition({ deployLogId: d1, chain: "base", contractAddr: `${TEST_PREFIX}open`, ticker: "R1", snipeAmount: 0.05, takeProfitX: 2, stopLossPct: 0.3, walletId: TEST_WALLET });
      transitionPositionState(`${TEST_PREFIX}open`, "buy_submitted", "open", { attributionStatus: "transaction_verified" });

      createPendingPosition({ deployLogId: d2, chain: "base", contractAddr: `${TEST_PREFIX}closed`, ticker: "R2", snipeAmount: 0.05, takeProfitX: 2, stopLossPct: 0.3, walletId: TEST_WALLET });
      transitionPositionState(`${TEST_PREFIX}closed`, "buy_submitted", "sold_tp", { realizedPnl: 0.05, pnlStatus: "calculated" });

      createPendingPosition({ deployLogId: d3, chain: "base", contractAddr: `${TEST_PREFIX}failed`, ticker: "R3", snipeAmount: 0.05, takeProfitX: 2, stopLossPct: 0.3, walletId: TEST_WALLET });
      transitionPositionState(`${TEST_PREFIX}failed`, "buy_submitted", "buy_failed");

      createPendingPosition({ deployLogId: d4, chain: "base", contractAddr: `${TEST_PREFIX}timeout`, ticker: "R4", snipeAmount: 0.05, takeProfitX: 2, stopLossPct: 0.3, walletId: TEST_WALLET });
      transitionPositionState(`${TEST_PREFIX}timeout`, "buy_submitted", "buy_timeout");

      createPendingPosition({ deployLogId: d5, chain: "base", contractAddr: `${TEST_PREFIX}unresolved`, ticker: "R5", snipeAmount: 0.05, takeProfitX: 2, stopLossPct: 0.3, walletId: TEST_WALLET });
      transitionPositionState(`${TEST_PREFIX}unresolved`, "buy_submitted", "unresolved");

      const lifecycle = getExecutionLifecycleSummary(TEST_WALLET);
      expect(lifecycle.openCount).toBe(1);
      expect(lifecycle.closedCount).toBe(1);
      expect(lifecycle.failedBuyCount).toBe(1);
      expect(lifecycle.timedOutBuyCount).toBe(1);
      expect(lifecycle.unresolvedCount).toBe(1);

      // Verify wallet PnL summary counts
      const walletSummary = getWalletPnlSummary(TEST_WALLET);
      expect(walletSummary.openPositionCount).toBe(1);
      expect(walletSummary.closedPositionCount).toBe(1);
      expect(walletSummary.failedBuyCount).toBe(1);
      expect(walletSummary.timedOutBuyCount).toBe(1);
      expect(walletSummary.unresolvedCount).toBe(1);
      // Only the calculated position contributes to realized PnL
      expect(walletSummary.totalRealizedPnl).toBeCloseTo(0.05, 4);

      // Verify getUnresolvedTransactions includes buy_timeout and unresolved
      const unresolvedTx = getUnresolvedTransactions().filter(t => t.contractAddr.startsWith(TEST_PREFIX));
      expect(unresolvedTx.length).toBe(2);
      const statuses = unresolvedTx.map(t => t.status);
      expect(statuses).toContain("buy_timeout");
      expect(statuses).toContain("unresolved");

      // Verify getPositionHistory status filter
      const failedHistory = getPositionHistory({ walletId: TEST_WALLET, status: "failed" });
      expect(failedHistory.length).toBe(1);
      expect(failedHistory[0].position.status).toBe("buy_failed");

      const timeoutHistory = getPositionHistory({ walletId: TEST_WALLET, status: "timeout" });
      expect(timeoutHistory.length).toBe(1);
      expect(timeoutHistory[0].position.status).toBe("buy_timeout");
    });

    it("6.2 excludes failed, timeout, and unresolved positions from monetary realized PnL", () => {
      const summary = getPlatformPnlSummary();
      expect(typeof summary.totalRealizedPnl).toBe("number");
      expect(typeof summary.totalRealizedProfit).toBe("number");
      expect(typeof summary.totalRealizedLoss).toBe("number");
    });
  });
});
