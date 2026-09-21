/**
 * v290-preflight-balance.test.ts — V2.9.0 Native Balance Pre-Flight Test Suite.
 *
 * Coverage:
 *  1. checkEvmNativeBalance — sufficient, insufficient, missing address, rpc_failure, disabled, unsupported chain
 *  2. checkSolanaNativeBalance — sufficient, insufficient, missing address, rpc_failure, disabled
 *  3. evaluatePreflightBalance — multi-chain aggregation, pass/fail logic, rpc non-blocking
 *  4. Config threshold defaults — PREFLIGHT_MIN_BALANCE_ETH, PREFLIGHT_MIN_BALANCE_SOL
 *  5. V2.8 regression boundary — existing APIs unaffected
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  checkEvmNativeBalance,
  checkSolanaNativeBalance,
  evaluatePreflightBalance,
  evaluatePreflightExecutionPolicy,
  type PreflightBalanceReport,
} from "../src/modules/identity/preflight-balance.ts";
import { resetConfig, getConfig } from "../src/config.ts";

const TEST_EVM_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TEST_SOL_ADDRESS = "So11111111111111111111111111111111111111112";
const INVALID_EVM = "not-an-address";
const INVALID_SOL = "tooshort";

// Inject mock EVM client: balance in wei (bigint)
function evmClient(balanceWei: bigint) {
  return { getBalance: async (_: unknown) => balanceWei };
}

// Inject mock Solana connection: balance in lamports
function solConn(lamports: number) {
  return { getBalance: async (_: unknown) => lamports };
}

// Inject failing client (simulates RPC unreachable)
const failEvmClient = { getBalance: async (_: unknown) => { throw new Error("connection refused"); } };
const failSolConn = { getBalance: async (_: unknown) => { throw new Error("RPC timeout"); } };

// Inject null client (simulates unsupported chain from getEvmPublicClient)
const nullEvmClient = null;

beforeEach(() => {
  resetConfig();
  process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  process.env.SOLANA_PRIVATE_KEY = "3J98t1WpEZ73CNm5RzJAJTJPByKmJQfSmNeSx5wSfbRoMBKiRPFpHJH8JMmTqHM5XxCH7UrRN3g7GPiqJqxVqNV";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
  process.env.FIRECRAWL_API_KEY = "test";
  process.env.PINATA_JWT = "test";
  process.env.PREFLIGHT_MIN_BALANCE_ETH = "0.055";
  process.env.PREFLIGHT_MIN_BALANCE_SOL = "0.06";
});

afterEach(() => {
  resetConfig();
  delete process.env.PREFLIGHT_MIN_BALANCE_ETH;
  delete process.env.PREFLIGHT_MIN_BALANCE_SOL;
});

// ══════════════════════════════════════════════════════════════
// 1. EVM Native Balance Check
// ══════════════════════════════════════════════════════════════

describe("V2.9.0 — Native Balance Pre-Flight", () => {
  describe("1. EVM Native Balance Check", () => {
    it("1.1 returns sufficient when balance >= threshold", async () => {
      // 0.1 ETH = 100_000_000_000_000_000 wei
      const result = await checkEvmNativeBalance("base", TEST_EVM_ADDRESS, 0.055, evmClient(100_000_000_000_000_000n));
      expect(result.outcome).toBe("sufficient");
      expect(result.actualBalance).toBeGreaterThanOrEqual(0.055);
      expect(result.chain).toBe("base");
    });

    it("1.2 returns insufficient_balance when balance < threshold", async () => {
      // 0.01 ETH = 10_000_000_000_000_000 wei
      const result = await checkEvmNativeBalance("base", TEST_EVM_ADDRESS, 0.055, evmClient(10_000_000_000_000_000n));
      expect(result.outcome).toBe("insufficient_balance");
      expect(result.actualBalance).toBeLessThan(0.055);
      expect(result.reason).toBeDefined();
    });

    it("1.3 returns missing_address for invalid EVM address", async () => {
      const result = await checkEvmNativeBalance("base", INVALID_EVM, 0.055, evmClient(100n));
      expect(result.outcome).toBe("missing_address");
      expect(result.reason).toBeDefined();
    });

    it("1.4 returns missing_address for null/undefined address", async () => {
      const r1 = await checkEvmNativeBalance("base", null, 0.055, evmClient(100n));
      const r2 = await checkEvmNativeBalance("base", undefined, 0.055, evmClient(100n));
      expect(r1.outcome).toBe("missing_address");
      expect(r2.outcome).toBe("missing_address");
    });

    it("1.5 returns disabled when threshold is 0", async () => {
      const result = await checkEvmNativeBalance("base", TEST_EVM_ADDRESS, 0, evmClient(0n));
      expect(result.outcome).toBe("disabled");
    });

    it("1.6 returns rpc_failure on network error (NOT insufficient)", async () => {
      const result = await checkEvmNativeBalance("base", TEST_EVM_ADDRESS, 0.055, failEvmClient);
      expect(result.outcome).toBe("rpc_failure");
      expect(result.actualBalance).toBeUndefined();
    });

    it("1.7 returns unsupported_chain when injected client is null", async () => {
      const result = await checkEvmNativeBalance("bsc", TEST_EVM_ADDRESS, 0.055, nullEvmClient);
      expect(result.outcome).toBe("unsupported_chain");
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 2. Solana Native Balance Check
  // ══════════════════════════════════════════════════════════════

  describe("2. Solana Native Balance Check", () => {
    it("2.1 returns sufficient when balance >= threshold", async () => {
      // 0.1 SOL = 100_000_000 lamports
      const result = await checkSolanaNativeBalance(TEST_SOL_ADDRESS, 0.06, solConn(100_000_000));
      expect(result.outcome).toBe("sufficient");
      expect(result.actualBalance).toBeGreaterThanOrEqual(0.06);
      expect(result.chain).toBe("solana");
    });

    it("2.2 returns insufficient_balance when balance < threshold", async () => {
      // 0.01 SOL = 10_000_000 lamports
      const result = await checkSolanaNativeBalance(TEST_SOL_ADDRESS, 0.06, solConn(10_000_000));
      expect(result.outcome).toBe("insufficient_balance");
      expect(result.actualBalance).toBeLessThan(0.06);
      expect(result.reason).toBeDefined();
    });

    it("2.3 returns missing_address for short/invalid Solana address", async () => {
      const r1 = await checkSolanaNativeBalance(INVALID_SOL, 0.06, solConn(0));
      const r2 = await checkSolanaNativeBalance(null, 0.06, solConn(0));
      const r3 = await checkSolanaNativeBalance(undefined, 0.06, solConn(0));
      expect(r1.outcome).toBe("missing_address");
      expect(r2.outcome).toBe("missing_address");
      expect(r3.outcome).toBe("missing_address");
    });

    it("2.4 returns disabled when threshold is 0", async () => {
      const result = await checkSolanaNativeBalance(TEST_SOL_ADDRESS, 0, solConn(0));
      expect(result.outcome).toBe("disabled");
    });

    it("2.5 returns rpc_failure on network error (NOT insufficient)", async () => {
      const result = await checkSolanaNativeBalance(TEST_SOL_ADDRESS, 0.06, failSolConn);
      expect(result.outcome).toBe("rpc_failure");
      expect(result.actualBalance).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 3. Multi-Chain evaluatePreflightBalance aggregation
  // ══════════════════════════════════════════════════════════════

  describe("3. Multi-Chain evaluatePreflightBalance Aggregation", () => {
    it("3.1 passes when all thresholds are disabled (0)", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: [],
        evmAddress: TEST_EVM_ADDRESS,
        solanaAddress: TEST_SOL_ADDRESS,
        minEth: 0,
        minSol: 0,
      });
      expect(report.passed).toBe(true);
      expect(report.failedChains).toHaveLength(0);
    });

    it("3.2 fails when EVM address is missing for base chain (with threshold > 0)", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: ["base"],
        evmAddress: null,
        solanaAddress: null,
        minEth: 0.055,
        minSol: 0,
      });
      expect(report.passed).toBe(false);
      expect(report.failedChains).toContain("base");
    });

    it("3.3 fails when Solana address is missing for solana chain (with threshold > 0)", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: ["solana"],
        evmAddress: null,
        solanaAddress: null,
        minEth: 0,
        minSol: 0.06,
      });
      expect(report.passed).toBe(false);
      expect(report.failedChains).toContain("solana");
    });

    it("3.4 thresholds=0 on both chains always passes regardless of address", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: ["base", "solana"],
        evmAddress: null,
        solanaAddress: null,
        minEth: 0,
        minSol: 0,
      });
      expect(report.passed).toBe(true);
      expect(report.rpcFailureChains).toHaveLength(0);
    });

    it("3.5 unsupported chains are non-blocking (passed through)", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: ["bsc", "ethereum"],
        evmAddress: TEST_EVM_ADDRESS,
        solanaAddress: null,
        minEth: 0.055,
        minSol: 0.06,
      });
      // bsc and ethereum are unsupported_chain -> go to passedChains
      expect(report.passed).toBe(true);
      expect(report.passedChains).toContain("bsc");
      expect(report.passedChains).toContain("ethereum");
    });

    it("3.6 handles solana failing on invalid address", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: ["solana"],
        evmAddress: TEST_EVM_ADDRESS,
        solanaAddress: INVALID_SOL,
        minEth: 0,
        minSol: 0.06,
      });
      expect(report.passed).toBe(false);
      expect(report.failedChains).toContain("solana");
    });

    it("3.7 empty eligible chains always passes", async () => {
      const report = await evaluatePreflightBalance({
        eligibleChains: [],
        evmAddress: null,
        solanaAddress: null,
        minEth: 0.055,
        minSol: 0.06,
      });
      expect(report.passed).toBe(true);
      expect(report.failedChains).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 4. Config threshold defaults
  // ══════════════════════════════════════════════════════════════

  describe("4. Config Threshold Defaults", () => {
    it("4.1 PREFLIGHT_MIN_BALANCE_ETH defaults to 0.055", () => {
      delete process.env.PREFLIGHT_MIN_BALANCE_ETH;
      resetConfig();
      const cfg = getConfig();
      expect(cfg.PREFLIGHT_MIN_BALANCE_ETH).toBe(0.055);
    });

    it("4.2 PREFLIGHT_MIN_BALANCE_SOL defaults to 0.06", () => {
      delete process.env.PREFLIGHT_MIN_BALANCE_SOL;
      resetConfig();
      const cfg = getConfig();
      expect(cfg.PREFLIGHT_MIN_BALANCE_SOL).toBe(0.06);
    });

    it("4.3 thresholds can be overridden via env", () => {
      process.env.PREFLIGHT_MIN_BALANCE_ETH = "0.1";
      process.env.PREFLIGHT_MIN_BALANCE_SOL = "0.5";
      resetConfig();
      const cfg = getConfig();
      expect(cfg.PREFLIGHT_MIN_BALANCE_ETH).toBe(0.1);
      expect(cfg.PREFLIGHT_MIN_BALANCE_SOL).toBe(0.5);
    });

    it("4.4 setting threshold to 0 disables the check", () => {
      process.env.PREFLIGHT_MIN_BALANCE_ETH = "0";
      process.env.PREFLIGHT_MIN_BALANCE_SOL = "0";
      resetConfig();
      const cfg = getConfig();
      expect(cfg.PREFLIGHT_MIN_BALANCE_ETH).toBe(0);
      expect(cfg.PREFLIGHT_MIN_BALANCE_SOL).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 5. V2.8 Regression Boundary
  // ══════════════════════════════════════════════════════════════

  describe("5. V2.8 Regression Boundary", () => {
    it("5.1 resolveCredential is still exported from wallet-manager", async () => {
      const { resolveCredential } = await import("../src/modules/identity/wallet-manager.ts");
      expect(typeof resolveCredential).toBe("function");
    });

    it("5.2 selectExecutionWallet is still exported from wallet-manager", async () => {
      const { selectExecutionWallet } = await import("../src/modules/identity/wallet-manager.ts");
      expect(typeof selectExecutionWallet).toBe("function");
    });

    it("5.3 evaluateExecutionReadiness is still exported from execution-readiness", async () => {
      const { evaluateExecutionReadiness } = await import("../src/modules/identity/execution-readiness.ts");
      expect(typeof evaluateExecutionReadiness).toBe("function");
    });

    it("5.4 evaluatePreflightBalance does not mutate wallet state", async () => {
      const { listWalletAccounts } = await import("../src/modules/identity/wallet-manager.ts");
      const before = listWalletAccounts().length;

      await evaluatePreflightBalance({
        eligibleChains: ["base", "solana"],
        evmAddress: null,
        solanaAddress: null,
        minEth: 0,
        minSol: 0,
      });

      const after = listWalletAccounts().length;
      expect(after).toBe(before);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 6. Pre-Flight Execution Policy (Policy C — Chain-Differentiated RPC Failure Semantics)
  // ══════════════════════════════════════════════════════════════

  describe("6. Pre-Flight Execution Policy (Policy C)", () => {
    it("6.1 Solana rpc_failure → BLOCK with PREFLIGHT_SOLANA_RPC_FAILURE", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: [],
        failedChains: [],
        rpcFailureChains: ["solana"],
        results: [
          {
            chain: "solana",
            outcome: "rpc_failure",
            requiredBalance: 0.06,
            reason: "RPC_FAILURE on Solana: connection timeout",
          },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(false);
      expect(decision.action).toBe("BLOCK_SOLANA_RPC_FAILURE");
      expect(decision.rejectionReason).toBe("PREFLIGHT_SOLANA_RPC_FAILURE");
      expect(decision.reasons.some((r) => r.includes("Solana RPC"))).toBe(true);

      // Strict distinction: unknown balance is NOT insufficient balance
      expect(decision.action).not.toBe("BLOCK_INSUFFICIENT_BALANCE");
      expect(decision.rejectionReason).not.toBe("PREFLIGHT_BALANCE_INSUFFICIENT");
    });

    it("6.2 EVM rpc_failure → CONTINUE with warning", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: [],
        failedChains: [],
        rpcFailureChains: ["base"],
        results: [
          {
            chain: "base",
            outcome: "rpc_failure",
            requiredBalance: 0.055,
            reason: "RPC_FAILURE on chain 'base': connection refused",
          },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.rejectionReason).toBeUndefined();
      expect(decision.warningChains).toContain("base");
      expect(decision.reasons.some((r) => r.includes("EVM RPC unreachable"))).toBe(true);
    });

    it("6.3 Solana rpc_failure + EVM sufficient → BLOCK", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: ["base"],
        failedChains: [],
        rpcFailureChains: ["solana"],
        results: [
          {
            chain: "base",
            outcome: "sufficient",
            actualBalance: 0.1,
            requiredBalance: 0.055,
          },
          {
            chain: "solana",
            outcome: "rpc_failure",
            requiredBalance: 0.06,
            reason: "RPC_FAILURE on Solana: timeout",
          },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(false);
      expect(decision.action).toBe("BLOCK_SOLANA_RPC_FAILURE");
      expect(decision.rejectionReason).toBe("PREFLIGHT_SOLANA_RPC_FAILURE");
    });

    it("6.4 EVM rpc_failure + Solana sufficient → CONTINUE", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: ["solana"],
        failedChains: [],
        rpcFailureChains: ["base"],
        results: [
          {
            chain: "base",
            outcome: "rpc_failure",
            requiredBalance: 0.055,
            reason: "RPC_FAILURE on chain 'base': timeout",
          },
          {
            chain: "solana",
            outcome: "sufficient",
            actualBalance: 1.0,
            requiredBalance: 0.06,
          },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.warningChains).toContain("base");
      expect(decision.rejectionReason).toBeUndefined();
    });

    it("6.5 EVM rpc_failure + Solana rpc_failure → BLOCK because Solana is unsafe to continue", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: [],
        failedChains: [],
        rpcFailureChains: ["base", "solana"],
        results: [
          {
            chain: "base",
            outcome: "rpc_failure",
            requiredBalance: 0.055,
            reason: "RPC_FAILURE on base: timeout",
          },
          {
            chain: "solana",
            outcome: "rpc_failure",
            requiredBalance: 0.06,
            reason: "RPC_FAILURE on Solana: timeout",
          },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(false);
      expect(decision.action).toBe("BLOCK_SOLANA_RPC_FAILURE");
      expect(decision.rejectionReason).toBe("PREFLIGHT_SOLANA_RPC_FAILURE");
      expect(decision.warningChains).toContain("base");
    });

    it("6.6 insufficient_balance remains BLOCK", () => {
      const report: PreflightBalanceReport = {
        passed: false,
        passedChains: [],
        failedChains: ["base"],
        rpcFailureChains: [],
        results: [
          {
            chain: "base",
            outcome: "insufficient_balance",
            actualBalance: 0.01,
            requiredBalance: 0.055,
            reason: "EVM balance 0.010000 ETH < required 0.055 ETH on chain 'base'.",
          },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(false);
      expect(decision.action).toBe("BLOCK_INSUFFICIENT_BALANCE");
      expect(decision.rejectionReason).toBe("PREFLIGHT_BALANCE_INSUFFICIENT");
    });

    it("6.7 sufficient remains PROCEED", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: ["base", "solana"],
        failedChains: [],
        rpcFailureChains: [],
        results: [
          { chain: "base", outcome: "sufficient", actualBalance: 0.2, requiredBalance: 0.055 },
          { chain: "solana", outcome: "sufficient", actualBalance: 2.0, requiredBalance: 0.06 },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.warningChains).toHaveLength(0);
      expect(decision.rejectionReason).toBeUndefined();
    });

    it("6.8 disabled preflight remains PROCEED", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: ["base", "solana"],
        failedChains: [],
        rpcFailureChains: [],
        results: [
          { chain: "base", outcome: "disabled", requiredBalance: 0 },
          { chain: "solana", outcome: "disabled", requiredBalance: 0 },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.warningChains).toHaveLength(0);
    });

    it("6.9 unsupported chain remains PROCEED", () => {
      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: ["bsc"],
        failedChains: [],
        rpcFailureChains: [],
        results: [
          { chain: "bsc", outcome: "unsupported_chain", requiredBalance: 0 },
        ],
      };

      const decision = evaluatePreflightExecutionPolicy(report);
      expect(decision.canProceed).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.warningChains).toHaveLength(0);
    });

    it("6.10 verify asset generation is NOT reached when Solana rpc_failure blocks", () => {
      // Simulate the exact runtime sequence of index.ts lines 350-390
      let assetGenerationExecuted = false;
      const generateAssetsMock = () => { assetGenerationExecuted = true; };

      const report: PreflightBalanceReport = {
        passed: true,
        passedChains: [],
        failedChains: [],
        rpcFailureChains: ["solana"],
        results: [
          {
            chain: "solana",
            outcome: "rpc_failure",
            requiredBalance: 0.06,
            reason: "RPC_FAILURE on Solana: timeout",
          },
        ],
      };

      const policyDecision = evaluatePreflightExecutionPolicy(report);
      let earlyReturned = false;

      // Pipeline guard: identical to src/index.ts
      if (!policyDecision.canProceed) {
        earlyReturned = true;
      } else {
        generateAssetsMock();
      }

      expect(earlyReturned).toBe(true);
      expect(assetGenerationExecuted).toBe(false);
      expect(policyDecision.rejectionReason).toBe("PREFLIGHT_SOLANA_RPC_FAILURE");
    });
  });
});

