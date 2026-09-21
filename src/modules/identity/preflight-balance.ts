/**
 * preflight-balance.ts — V2.9.0 Native Balance Pre-Flight Evaluator.
 *
 * Responsibilities:
 *  - Check that the selected execution wallet holds enough native balance on each
 *    eligible chain BEFORE image generation, IPFS upload, or deployment begins.
 *  - Chain-aware: EVM (Base / Robinhood) uses viem getBalance; Solana uses
 *    Connection.getBalance (lamports). Both are strictly read-only calls.
 *  - Returns typed PreflightBalanceResult per chain so the caller can decide
 *    whether to abort, warn, or try a different wallet.
 *  - Never performs transactions, simulations with side-effects, or writes.
 *
 * Invariants:
 *  1. Read-only: No signing, no sending, no mutations.
 *  2. Fail-safe classification: RPC failure -> "rpc_failure" (NOT "insufficient").
 *  3. Missing address -> "missing_address" — wallet cannot operate on that chain.
 *  4. Threshold = 0 -> check is disabled (always returns "sufficient").
 *  5. No rotation logic: caller decides what to do on failure.
 */
import { formatEther } from "viem";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getEvmPublicClient } from "../reconciliation/evm-verifier.ts";
import { getSolanaConnection } from "../reconciliation/solana-verifier.ts";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "../evm/bankr-deployer.ts";
import { listWalletAccounts, type WalletAccount } from "./wallet-manager.ts";

// --- Types ---

export type PreflightOutcome =
  | "sufficient"
  | "insufficient_balance"
  | "missing_address"
  | "rpc_failure"
  | "unsupported_chain"
  | "disabled";

export interface PreflightBalanceResult {
  chain: string;
  outcome: PreflightOutcome;
  /** Actual balance in human-readable units (ETH or SOL). Undefined on rpc_failure. */
  actualBalance?: number;
  /** Threshold that was required. */
  requiredBalance: number;
  /** Human-readable reason for non-sufficient outcomes. */
  reason?: string;
}

// --- EVM Pre-Flight ---

/**
 * Checks native ETH balance on an EVM chain (Base or Robinhood) for a given address.
 * Returns PreflightBalanceResult with outcome classification.
 */
export async function checkEvmNativeBalance(
  chain: string,
  walletAddress: string | null | undefined,
  requiredEth: number,
  /** Optional injected client — used in tests to avoid real RPC calls. */
  _injectedClient?: { getBalance: (args: { address: string }) => Promise<bigint> } | null
): Promise<PreflightBalanceResult> {
  if (requiredEth === 0) {
    return { chain, outcome: "disabled", requiredBalance: 0 };
  }

  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return {
      chain,
      outcome: "missing_address",
      requiredBalance: requiredEth,
      reason: `No valid EVM address configured for wallet on chain '${chain}'.`,
    };
  }

  const client = _injectedClient !== undefined ? _injectedClient : getEvmPublicClient(chain);
  if (!client) {
    return {
      chain,
      outcome: "unsupported_chain",
      requiredBalance: requiredEth,
      reason: `Chain '${chain}' is not supported by EVM client.`,
    };
  }

  try {
    const rawBalance = await client.getBalance({ address: walletAddress as `0x${string}` });
    const ethBalance = parseFloat(formatEther(rawBalance as bigint));

    if (ethBalance < requiredEth) {
      return {
        chain,
        outcome: "insufficient_balance",
        actualBalance: ethBalance,
        requiredBalance: requiredEth,
        reason: `EVM balance ${ethBalance.toFixed(6)} ETH < required ${requiredEth} ETH on chain '${chain}'.`,
      };
    }

    return {
      chain,
      outcome: "sufficient",
      actualBalance: ethBalance,
      requiredBalance: requiredEth,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️  [PREFLIGHT] RPC failure checking EVM balance on '${chain}': ${sanitizeSecret(errMsg)}`);
    return {
      chain,
      outcome: "rpc_failure",
      requiredBalance: requiredEth,
      reason: `RPC_FAILURE on chain '${chain}': ${sanitizeSecret(errMsg)}`,
    };
  }
}

// --- Solana Pre-Flight ---

/**
 * Checks native SOL balance on Solana for a given address.
 * Returns PreflightBalanceResult with outcome classification.
 */
export async function checkSolanaNativeBalance(
  walletAddress: string | null | undefined,
  requiredSol: number,
  /** Optional injected connection — used in tests to avoid real RPC calls. */
  _injectedConnection?: { getBalance: (pubkey: unknown) => Promise<number> } | null
): Promise<PreflightBalanceResult> {
  const chain = "solana";

  if (requiredSol === 0) {
    return { chain, outcome: "disabled", requiredBalance: 0 };
  }

  if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44) {
    return {
      chain,
      outcome: "missing_address",
      requiredBalance: requiredSol,
      reason: "No valid Solana address configured for wallet.",
    };
  }

  try {
    const connection = _injectedConnection !== undefined ? _injectedConnection : getSolanaConnection();
    if (!connection) {
      return {
        chain,
        outcome: "rpc_failure",
        requiredBalance: requiredSol,
        reason: "Solana connection is null or unavailable.",
      };
    }
    const pubkey = new PublicKey(walletAddress);
    const lamports = await connection.getBalance(pubkey);
    const solBalance = lamports / LAMPORTS_PER_SOL;

    if (solBalance < requiredSol) {
      return {
        chain,
        outcome: "insufficient_balance",
        actualBalance: solBalance,
        requiredBalance: requiredSol,
        reason: `Solana balance ${solBalance.toFixed(6)} SOL < required ${requiredSol} SOL.`,
      };
    }

    return {
      chain,
      outcome: "sufficient",
      actualBalance: solBalance,
      requiredBalance: requiredSol,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️  [PREFLIGHT] RPC failure checking Solana balance: ${sanitizeSecret(errMsg)}`);
    return {
      chain,
      outcome: "rpc_failure",
      requiredBalance: requiredSol,
      reason: `RPC_FAILURE on Solana: ${sanitizeSecret(errMsg)}`,
    };
  }
}

// --- Multi-Chain Pre-Flight ---

export interface PreflightBalanceReport {
  passed: boolean;
  /** Chains that passed or were skipped/disabled. */
  passedChains: string[];
  /** Chains that failed with insufficient balance or missing address. */
  failedChains: string[];
  /** Chains where RPC was unreachable (non-blocking by design). */
  rpcFailureChains: string[];
  results: PreflightBalanceResult[];
}

/**
 * Evaluates native balance for all eligible chains against configured thresholds.
 * RPC failures are recorded but do NOT block execution by default (the provider API
 * will surface a more authoritative failure if the wallet truly cannot operate).
 *
 * @param options.eligibleChains  - chains returned by the readiness decision
 * @param options.evmAddress      - resolved EVM wallet address (from operatorWallet)
 * @param options.solanaAddress   - resolved Solana wallet address (from operatorWallet)
 * @param options.minEth          - PREFLIGHT_MIN_BALANCE_ETH from config
 * @param options.minSol          - PREFLIGHT_MIN_BALANCE_SOL from config
 */
export async function evaluatePreflightBalance(options: {
  eligibleChains: string[];
  evmAddress?: string | null;
  solanaAddress?: string | null;
  minEth: number;
  minSol: number;
}): Promise<PreflightBalanceReport> {
  const { eligibleChains, evmAddress, solanaAddress, minEth, minSol } = options;
  const results: PreflightBalanceResult[] = [];

  for (const rawChain of eligibleChains) {
    const chain = rawChain.trim().toLowerCase();

    if (chain === "solana") {
      const result = await checkSolanaNativeBalance(solanaAddress, minSol);
      results.push(result);
    } else if (chain === "base" || chain === "robinhood") {
      const result = await checkEvmNativeBalance(chain, evmAddress, minEth);
      results.push(result);
    } else {
      // Unsupported chains pass pre-flight (rejected later by deployer)
      results.push({ chain, outcome: "unsupported_chain", requiredBalance: 0 });
    }
  }

  const passedChains: string[] = [];
  const failedChains: string[] = [];
  const rpcFailureChains: string[] = [];

  for (const r of results) {
    if (r.outcome === "sufficient" || r.outcome === "disabled" || r.outcome === "unsupported_chain") {
      passedChains.push(r.chain);
    } else if (r.outcome === "rpc_failure") {
      rpcFailureChains.push(r.chain);
    } else {
      // insufficient_balance | missing_address → hard fail
      failedChains.push(r.chain);
    }
  }

  return {
    passed: failedChains.length === 0,
    passedChains,
    failedChains,
    rpcFailureChains,
    results,
  };
}

// ─── Pre-Flight Policy C Evaluator ───────────────────────────

export type PreflightPolicyAction =
  | "PROCEED"
  | "BLOCK_INSUFFICIENT_BALANCE"
  | "BLOCK_SOLANA_RPC_FAILURE";

export interface PreflightPolicyDecision {
  canProceed: boolean;
  action: PreflightPolicyAction;
  rejectionReason?: "PREFLIGHT_BALANCE_INSUFFICIENT" | "PREFLIGHT_SOLANA_RPC_FAILURE";
  warningChains: string[];
  reasons: string[];
}

/**
 * Pure, deterministic execution policy evaluator implementing Policy C.
 *
 * Invariants:
 *  - V2.9.0-INV-1: rpc_failure is unknown balance state, NOT insufficient balance.
 *  - V2.9.0-INV-2: For EVM/Bankr, local RPC failure does not imply Bankr execution infrastructure
 *    is unavailable (Bankr manages signing/submission independently). Local EVM RPC failure is warning-only.
 *  - V2.9.0-INV-3: For Solana/PumpFun, the exact same SOLANA_RPC_URL is required by both preflight
 *    and the PumpFun deployment path (funding disposable wallet via SOL transfer).
 *  - V2.9.0-INV-4: Preflight must prevent predictable downstream side-effects (logo gen, IPFS upload)
 *    when the execution path itself depends on the unavailable RPC.
 */
export function evaluatePreflightExecutionPolicy(
  report: PreflightBalanceReport
): PreflightPolicyDecision {
  // 1. Hard block on insufficient balance or missing wallet address
  if (report.failedChains.length > 0) {
    const reasons = report.results
      .filter((r) => r.outcome === "insufficient_balance" || r.outcome === "missing_address")
      .map((r) => r.reason ?? `${r.chain}: ${r.outcome}`);

    const evmRpcWarnings = report.rpcFailureChains.filter((c) => c !== "solana");

    return {
      canProceed: false,
      action: "BLOCK_INSUFFICIENT_BALANCE",
      rejectionReason: "PREFLIGHT_BALANCE_INSUFFICIENT",
      warningChains: evmRpcWarnings,
      reasons,
    };
  }

  // 2. Hard block on Solana RPC failure (V2.9.0-INV-3 & INV-4)
  const solanaRpcFails = report.rpcFailureChains.filter((c) => c === "solana");
  const evmRpcWarnings = report.rpcFailureChains.filter((c) => c !== "solana");

  if (solanaRpcFails.length > 0) {
    const solanaReasons = report.results
      .filter((r) => r.chain === "solana" && r.outcome === "rpc_failure")
      .map((r) => `Solana RPC failure: ${r.reason ?? "unreachable"}`);

    return {
      canProceed: false,
      action: "BLOCK_SOLANA_RPC_FAILURE",
      rejectionReason: "PREFLIGHT_SOLANA_RPC_FAILURE",
      warningChains: evmRpcWarnings,
      reasons: solanaReasons.length > 0
        ? solanaReasons
        : ["Solana RPC is unreachable; cannot verify native balance or fund deployment wallet."],
    };
  }

  // 3. Warning-only for EVM RPC failure (V2.9.0-INV-2)
  const reasons: string[] = [];
  if (evmRpcWarnings.length > 0) {
    reasons.push(
      `EVM RPC unreachable for [${evmRpcWarnings.join(", ")}]; continuing because Bankr manages execution infrastructure independently.`
    );
  }

  return {
    canProceed: true,
    action: "PROCEED",
    warningChains: evmRpcWarnings,
    reasons,
  };
}

// ─── Multi-Account Balance Scanning & Starvation Evaluation ──────────────────

export interface WalletBalanceEvaluation {
  walletId: string;
  label: string;
  status: string;
  evmAddress?: string;
  solanaAddress?: string;
  evmBalance: number | null;
  solanaBalance: number | null;
  evmSufficient: boolean;
  solanaSufficient: boolean;
  isStarving: boolean;
  deficitEth: number;
  deficitSol: number;
  starvingReasons: string[];
}

export interface MultiWalletBalanceReport {
  timestamp: string;
  totalScanned: number;
  healthyCount: number;
  starvingCount: number;
  minEthThreshold: number;
  minSolThreshold: number;
  evaluations: WalletBalanceEvaluation[];
  starvingWallets: WalletBalanceEvaluation[];
}

export interface ScanAllWalletBalancesOptions {
  minEth?: number;
  minSol?: number;
  wallets?: WalletAccount[];
  onlyActive?: boolean;
  /** Optional injected EVM client for deterministic testing */
  injectedEvmClient?: { getBalance: (args: { address: string }) => Promise<bigint> } | null;
  /** Optional injected Solana connection for deterministic testing */
  injectedSolanaConnection?: { getBalance: (pubkey: unknown) => Promise<number> } | null;
}

/**
 * Scans on-chain native balances across all operator wallets (Base L2 & Solana),
 * evaluating each against configured minimum balance thresholds (minEth, minSol).
 * Returns an aggregated report detailing healthy vs underfunded (starving) accounts.
 */
export async function scanAllWalletBalances(
  options?: ScanAllWalletBalancesOptions
): Promise<MultiWalletBalanceReport> {
  const minEth = options?.minEth ?? 0.055;
  const minSol = options?.minSol ?? 0.06;
  const onlyActive = options?.onlyActive ?? true;

  let rawWallets = options?.wallets;
  if (!rawWallets) {
    try {
      rawWallets = listWalletAccounts();
    } catch {
      rawWallets = [];
    }
  }

  const targetWallets = onlyActive
    ? rawWallets.filter((w) => w.status === "ACTIVE")
    : rawWallets;

  const evaluations: WalletBalanceEvaluation[] = [];

  for (const w of targetWallets) {
    const starvingReasons: string[] = [];
    let evmBalance: number | null = null;
    let solanaBalance: number | null = null;
    let evmSufficient = true;
    let solanaSufficient = true;
    let deficitEth = 0;
    let deficitSol = 0;

    // 1. Check EVM (Base L2) if address is configured
    if (w.evmAddress) {
      const evmRes = await checkEvmNativeBalance(
        "base",
        w.evmAddress,
        minEth,
        options?.injectedEvmClient
      );
      if (evmRes.actualBalance !== undefined) {
        evmBalance = evmRes.actualBalance;
        if (evmBalance < minEth) {
          evmSufficient = false;
          deficitEth = Math.max(0, minEth - evmBalance);
          starvingReasons.push(
            `Base L2: ${evmBalance.toFixed(6)} ETH < min ${minEth} ETH (defisit -${deficitEth.toFixed(6)} ETH)`
          );
        }
      } else if (evmRes.outcome === "rpc_failure") {
        starvingReasons.push(`Base L2: Node RPC tidak merespons`);
      } else if (evmRes.outcome === "missing_address" || evmRes.outcome === "insufficient_balance") {
        evmSufficient = false;
        deficitEth = minEth;
        starvingReasons.push(`Base L2: Alamat tidak valid atau saldo 0 ETH`);
      }
    }

    // 2. Check Solana if address is configured
    if (w.solanaAddress) {
      const solRes = await checkSolanaNativeBalance(
        w.solanaAddress,
        minSol,
        options?.injectedSolanaConnection
      );
      if (solRes.actualBalance !== undefined) {
        solanaBalance = solRes.actualBalance;
        if (solanaBalance < minSol) {
          solanaSufficient = false;
          deficitSol = Math.max(0, minSol - solanaBalance);
          starvingReasons.push(
            `Solana: ${solanaBalance.toFixed(6)} SOL < min ${minSol} SOL (defisit -${deficitSol.toFixed(6)} SOL)`
          );
        }
      } else if (solRes.outcome === "rpc_failure") {
        starvingReasons.push(`Solana: Node RPC tidak merespons`);
      } else if (solRes.outcome === "missing_address" || solRes.outcome === "insufficient_balance") {
        solanaSufficient = false;
        deficitSol = minSol;
        starvingReasons.push(`Solana: Alamat tidak valid atau saldo 0 SOL`);
      }
    }

    const isStarving = !evmSufficient || !solanaSufficient;

    evaluations.push({
      walletId: w.id,
      label: w.label,
      status: w.status,
      evmAddress: w.evmAddress ?? undefined,
      solanaAddress: w.solanaAddress ?? undefined,
      evmBalance,
      solanaBalance,
      evmSufficient,
      solanaSufficient,
      isStarving,
      deficitEth,
      deficitSol,
      starvingReasons,
    });
  }

  const starvingWallets = evaluations.filter((e) => e.isStarving);
  const healthyCount = evaluations.length - starvingWallets.length;

  return {
    timestamp: new Date().toISOString(),
    totalScanned: evaluations.length,
    healthyCount,
    starvingCount: starvingWallets.length,
    minEthThreshold: minEth,
    minSolThreshold: minSol,
    evaluations,
    starvingWallets,
  };
}

