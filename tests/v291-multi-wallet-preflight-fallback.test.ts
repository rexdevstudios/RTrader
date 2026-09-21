/**
 * v291-multi-wallet-preflight-fallback.test.ts — V2.9.1 Multi-Wallet Preflight Fallback Test Suite.
 *
 * Coverage:
 *  1. First wallet insufficient, second wallet sufficient -> second wallet selected, cycle proceeds.
 *  2. First wallet missing address, second wallet sufficient -> second wallet selected.
 *  3. All wallets insufficient -> clean abort -> PREFLIGHT_ALL_WALLETS_INSUFFICIENT.
 *  4. First wallet insufficient, second also insufficient, third sufficient -> third selected.
 *  5. Solana RPC failure on first wallet -> entire cycle blocked -> no fallback to another wallet.
 *  6. EVM RPC failure -> preserve V2.9.0 warning/continue semantics -> does not trigger wallet fallback.
 *  7. Rejected wallet is not retried within the same cycle (no duplicate evaluation).
 *  8. Wallet database status is not changed by temporary insufficient balance (remains ACTIVE).
 *  9. Actual selected fallback walletId propagates into deployment lineage.
 *  10. First wallet failure does not leak credentialRef, proxyId, or provider context into fallback context.
 *  11. Candidate set is bounded: N eligible wallets -> maximum N preflight attempts.
 *  12. Existing V2.9.0 policy tests remain passing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_PATH, logDeploy, getDeployLogById } from "../src/db/vault.ts";
import {
  registerWalletAccount,
  getWalletAccount,
  registerProxyConfig,
  setWalletProviderRoute,
} from "../src/modules/identity/wallet-manager.ts";
import {
  resolveExecutableWalletForCycle,
  type ExecutionContextResolution,
} from "../src/modules/identity/execution-wallet-resolver.ts";
import {
  evaluatePreflightExecutionPolicy,
  type PreflightBalanceReport,
} from "../src/modules/identity/preflight-balance.ts";
import { resetConfig } from "../src/config.ts";

const db = new Database(DB_PATH);

const W1_ID = "v291_test_w1";
const W2_ID = "v291_test_w2";
const W3_ID = "v291_test_w3";
const P1_ID = "v291_proxy_p1";
const P2_ID = "v291_proxy_p2";

const W1_EVM = "0x1111111111111111111111111111111111111111";
const W2_EVM = "0x2222222222222222222222222222222222222222";
const W3_EVM = "0x3333333333333333333333333333333333333333";

const W1_SOL = "11111111111111111111111111111111";
const W2_SOL = "22222222222222222222222222222222";
const W3_SOL = "33333333333333333333333333333333";

beforeAll(() => {
  // Clean up any previous test artifacts
  db.run(`DELETE FROM wallet_provider_routes WHERE wallet_id IN (?, ?, ?)`, [W1_ID, W2_ID, W3_ID]);
  db.run(`DELETE FROM wallet_accounts WHERE id IN (?, ?, ?)`, [W1_ID, W2_ID, W3_ID]);
  db.run(`DELETE FROM proxy_configs WHERE id IN (?, ?)`, [P1_ID, P2_ID]);

  // Register test proxies
  registerProxyConfig({
    id: P1_ID,
    protocol: "http",
    host: "127.0.0.1",
    port: 8001,
  });

  registerProxyConfig({
    id: P2_ID,
    protocol: "http",
    host: "127.0.0.1",
    port: 8002,
  });

  // Register 3 test wallets
  registerWalletAccount({
    id: W1_ID,
    label: "V291 Test Wallet 1",
    evmAddress: W1_EVM,
    solanaAddress: W1_SOL,
    status: "ACTIVE",
  });

  registerWalletAccount({
    id: W2_ID,
    label: "V291 Test Wallet 2",
    evmAddress: W2_EVM,
    solanaAddress: W2_SOL,
    status: "ACTIVE",
  });

  registerWalletAccount({
    id: W3_ID,
    label: "V291 Test Wallet 3",
    evmAddress: W3_EVM,
    solanaAddress: W3_SOL,
    status: "ACTIVE",
  });

  // Configure distinct routes and credentials for W1 and W2
  setWalletProviderRoute(W1_ID, "bankr", {
    credentialRef: "env:BANKR_KEY_W1",
    proxyId: P1_ID,
  });
  setWalletProviderRoute(W1_ID, "basedbot", {});

  setWalletProviderRoute(W2_ID, "bankr", {
    credentialRef: "env:BANKR_KEY_W2",
    proxyId: P2_ID,
  });
  setWalletProviderRoute(W2_ID, "basedbot", {});

  setWalletProviderRoute(W3_ID, "bankr", {});
  setWalletProviderRoute(W3_ID, "basedbot", {});
});

afterAll(() => {
  db.run(`DELETE FROM deploy_logs WHERE wallet_id IN (?, ?, ?)`, [W1_ID, W2_ID, W3_ID]);
  db.run(`DELETE FROM wallet_provider_routes WHERE wallet_id IN (?, ?, ?)`, [W1_ID, W2_ID, W3_ID]);
  db.run(`DELETE FROM wallet_accounts WHERE id IN (?, ?, ?)`, [W1_ID, W2_ID, W3_ID]);
  db.run(`DELETE FROM proxy_configs WHERE id IN (?, ?)`, [P1_ID, P2_ID]);
});

beforeEach(() => {
  resetConfig();
  db.run("DELETE FROM deploy_logs WHERE wallet_id IN (?, ?, ?)", [W1_ID, W2_ID, W3_ID]);
  process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  process.env.SOLANA_PRIVATE_KEY = "3J98t1WpEZ73CNm5RzJAJTJPByKmJQfSmNeSx5wSfbRoMBKiRPFpHJH8JMmTqHM5XxCH7UrRN3g7GPiqJqxVqNV";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
  process.env.FIRECRAWL_API_KEY = "test";
  process.env.PINATA_JWT = "test";
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
});

// Helper for mocked balance reports
function mockBalanceReport(outcomes: Record<string, "sufficient" | "insufficient" | "missing_address" | "rpc_failure">) {
  return async ({ evmAddress, solanaAddress }: { evmAddress?: string | null; solanaAddress?: string | null }): Promise<PreflightBalanceReport> => {
    const isW1 = evmAddress?.toLowerCase() === W1_EVM.toLowerCase();
    const isW2 = evmAddress?.toLowerCase() === W2_EVM.toLowerCase();
    const isW3 = evmAddress?.toLowerCase() === W3_EVM.toLowerCase();

    const walletKey = isW1 ? W1_ID : isW2 ? W2_ID : isW3 ? W3_ID : "unknown";
    const status = outcomes[walletKey] ?? "sufficient";

    if (status === "sufficient") {
      return {
        passed: true,
        passedChains: ["base", "solana"],
        failedChains: [],
        rpcFailureChains: [],
        results: [
          { chain: "base", outcome: "sufficient", actualBalance: 0.5, requiredBalance: 0.055 },
          { chain: "solana", outcome: "sufficient", actualBalance: 2.0, requiredBalance: 0.06 },
        ],
      };
    }

    if (status === "insufficient") {
      return {
        passed: false,
        passedChains: ["solana"],
        failedChains: ["base"],
        rpcFailureChains: [],
        results: [
          { chain: "base", outcome: "insufficient_balance", actualBalance: 0.001, requiredBalance: 0.055, reason: "Insufficient ETH" },
          { chain: "solana", outcome: "sufficient", actualBalance: 2.0, requiredBalance: 0.06 },
        ],
      };
    }

    if (status === "missing_address") {
      return {
        passed: false,
        passedChains: [],
        failedChains: ["base"],
        rpcFailureChains: [],
        results: [
          { chain: "base", outcome: "missing_address", requiredBalance: 0.055, reason: "Missing EVM address" },
        ],
      };
    }

    if (status === "rpc_failure") {
      return {
        passed: true,
        passedChains: [],
        failedChains: [],
        rpcFailureChains: ["solana"],
        results: [
          { chain: "solana", outcome: "rpc_failure", requiredBalance: 0.06, reason: "RPC timeout on Solana" },
        ],
      };
    }

    return {
      passed: true,
      passedChains: [],
      failedChains: [],
      rpcFailureChains: [],
      results: [],
    };
  };
}

describe("V2.9.1 — Multi-Wallet Preflight Fallback & Starvation Prevention", () => {
  // 1. First wallet insufficient, second wallet sufficient -> second wallet selected
  it("1. selects second wallet when first wallet has insufficient balance", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "sufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.success).toBe(true);
    expect(resolution.operatorWallet?.id).toBe(W2_ID);
    expect(resolution.attempts).toBe(2);
    expect(resolution.evaluatedWalletIds).toEqual([W1_ID, W2_ID]);
  });

  // 2. First wallet missing address, second wallet sufficient -> second wallet selected
  it("2. selects second wallet when first wallet has missing address", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "missing_address",
      [W2_ID]: "sufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.success).toBe(true);
    expect(resolution.operatorWallet?.id).toBe(W2_ID);
    expect(resolution.attempts).toBe(2);
  });

  // 3. All wallets insufficient -> clean abort -> PREFLIGHT_ALL_WALLETS_INSUFFICIENT
  it("3. cleanly aborts with PREFLIGHT_ALL_WALLETS_INSUFFICIENT when all wallets fail", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "insufficient",
      [W3_ID]: "insufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID, W3_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.success).toBe(false);
    expect(resolution.rejectionReason).toBe("PREFLIGHT_ALL_WALLETS_INSUFFICIENT");
    expect(resolution.attempts).toBe(3);
    expect(resolution.evaluatedWalletIds.sort()).toEqual([W1_ID, W2_ID, W3_ID].sort());
  });

  // 4. First insufficient, second also insufficient, third sufficient -> third selected
  it("4. iterates through multiple underfunded candidates until funded wallet is found", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "insufficient",
      [W3_ID]: "sufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID, W3_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.success).toBe(true);
    expect(resolution.operatorWallet?.id).toBe(W3_ID);
    expect(resolution.attempts).toBe(3);
    expect(resolution.evaluatedWalletIds).toEqual([W1_ID, W2_ID, W3_ID]);
  });

  // 5. Solana RPC failure on first wallet -> entire cycle blocked -> no fallback to another wallet
  it("5. hard blocks on Solana RPC failure without attempting other wallets", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "rpc_failure",
      [W2_ID]: "sufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["solana"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.success).toBe(false);
    expect(resolution.rejectionReason).toBe("PREFLIGHT_SOLANA_RPC_FAILURE");
    // Strictly no fallback when infrastructure failure occurs
    expect(resolution.attempts).toBe(1);
    expect(resolution.evaluatedWalletIds).toEqual([W1_ID]);
  });

  // 6. EVM RPC failure -> preserve V2.9.0 warning/continue semantics -> does not trigger wallet fallback
  it("6. preserves warning/continue on EVM RPC failure without triggering fallback", async () => {
    const evmRpcEvaluator = async () => ({
      passed: true,
      passedChains: [],
      failedChains: [],
      rpcFailureChains: ["base"],
      results: [
        { chain: "base", outcome: "rpc_failure" as const, requiredBalance: 0.055, reason: "EVM RPC down" },
      ],
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evmRpcEvaluator,
    });

    expect(resolution.success).toBe(true);
    expect(resolution.operatorWallet?.id).toBe(W1_ID);
    expect(resolution.attempts).toBe(1);
    expect(resolution.policyDecision?.warningChains).toContain("base");
  });

  // 7. Rejected wallet is not retried within the same cycle
  it("7. does not retry previously rejected wallets in the same cycle", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "insufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    // Each wallet must be evaluated exactly once
    const uniqueIds = new Set(resolution.evaluatedWalletIds);
    expect(uniqueIds.size).toBe(resolution.evaluatedWalletIds.length);
    expect(resolution.attempts).toBe(2);
  });

  // 8. Wallet database status is not changed by temporary insufficient balance
  it("8. preserves ACTIVE database status for wallets that failed balance preflight", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "sufficient",
    });

    await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    const w1 = getWalletAccount(W1_ID);
    expect(w1?.status).toBe("ACTIVE");
  });

  // 9. Actual selected fallback walletId propagates into deployment lineage
  it("9. propagates fallback walletId into deployment lineage", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "sufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.success).toBe(true);
    const selectedWalletId = resolution.operatorWallet!.id;

    // Simulate downstream logDeploy in index.ts
    const deployLogId = logDeploy({
      chain: "base",
      tokenName: "Lineage Test Token",
      ticker: "LIN",
      status: "pending",
      lifecycleState: "DEPLOY_SUBMITTED",
      walletId: selectedWalletId,
      proxyId: resolution.bankrContext?.proxy?.id,
    });

    const row = db
      .query("SELECT wallet_id, proxy_id FROM deploy_logs WHERE id = ?")
      .get(deployLogId) as { wallet_id: string; proxy_id: string };

    expect(row.wallet_id).toBe(W2_ID);
    expect(row.proxy_id).toBe(P2_ID);
  });

  // 10. First wallet failure does not leak its: credentialRef, proxyId, provider context into fallback
  it("10. does not leak first wallet's credentials, proxy, or context into fallback context", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "sufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.operatorWallet?.id).toBe(W2_ID);
    // Strict isolation: must match W2's configuration, NOT W1
    expect(resolution.bankrContext?.credentialRef).toBe("env:BANKR_KEY_W2");
    expect(resolution.bankrContext?.proxy?.id).toBe(P2_ID);
    expect(resolution.operatorWallet?.evmAddress).toBe(W2_EVM.toLowerCase());
  });

  // 11. Candidate set is bounded: N eligible wallets -> maximum N preflight attempts
  it("11. strictly bounds evaluations to N attempts for N candidates", async () => {
    const evaluator = mockBalanceReport({
      [W1_ID]: "insufficient",
      [W2_ID]: "insufficient",
    });

    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: "bankr",
      targetChains: ["base"],
      minEth: 0.055,
      minSol: 0.06,
      telegramBotTokenPresent: true,
      initialCandidateWalletIds: [W1_ID, W2_ID],
      balanceEvaluator: evaluator,
    });

    expect(resolution.attempts).toBe(2);
    expect(resolution.evaluatedWalletIds).toHaveLength(2);
  });

  // 12. Existing V2.9.0 policy tests remain passing
  it("12. preserves V2.9.0 Policy C decision rules", () => {
    const solanaRpcReport: PreflightBalanceReport = {
      passed: true,
      passedChains: [],
      failedChains: [],
      rpcFailureChains: ["solana"],
      results: [{ chain: "solana", outcome: "rpc_failure", requiredBalance: 0.06, reason: "Solana RPC down" }],
    };

    const decision = evaluatePreflightExecutionPolicy(solanaRpcReport);
    expect(decision.canProceed).toBe(false);
    expect(decision.action).toBe("BLOCK_SOLANA_RPC_FAILURE");
    expect(decision.rejectionReason).toBe("PREFLIGHT_SOLANA_RPC_FAILURE");
  });
});
