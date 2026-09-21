/**
 * execution-wallet-resolver.ts — Multi-Wallet Preflight Fallback & Starvation Prevention (V2.9.1)
 *
 * Responsibilities:
 *  - Orchestrates capability-aware wallet selection, operational readiness, and native balance
 *    pre-flight evaluation into a fault-tolerant, bounded resolution loop.
 *  - Prevents underfunded active wallets from causing head-of-line blocking / cycle starvation.
 *  - If an active wallet fails balance preflight (wallet-specific: insufficient_balance or missing_address),
 *    it is excluded for the CURRENT CYCLE ONLY, and the resolver selects from the remaining eligible candidates.
 *  - If an infrastructure failure occurs (Solana RPC failure), immediately aborts the entire cycle
 *    (Policy C: network error is not wallet-specific; no other wallet could deploy on Solana).
 *  - Rejection reasons are deterministic:
 *      * PREFLIGHT_ALL_WALLETS_INSUFFICIENT — when all eligible candidates lack native balance
 *      * PREFLIGHT_SOLANA_RPC_FAILURE — when Solana RPC is unreachable
 *      * ReadinessAction (e.g. ABORT_ROUTE_UNUSABLE) — when readiness gate fails
 *
 * Invariants:
 *  1. Bounded: Evaluates at most N eligible candidate wallets per cycle (no infinite retry).
 *  2. Non-Mutating: Never alters wallet DB status (ACTIVE/PAUSED/DISABLED) due to transient balance deficiencies.
 *  3. Non-Incrementing: Never increments or modifies deployment history for a wallet that failed preflight.
 *  4. Strict Lineage: The winning fallback wallet fully owns the downstream execution context (operatorWallet,
 *     bankrContext, basedbotContext, readinessDecision, walletId, proxyId, credentialRef).
 *  5. Zero Credential Leakage: Credentials and secrets are never logged.
 */
import { logger } from "../../logger.ts";
import {
  selectExecutionWallet,
  resolveOperationalContext,
  listWalletAccounts,
  bootstrapDefaultWallet,
  autoFailoverUnhealthyRoutes,
  probeAndResupplyQuarantinedPool,
  listProxyConfigs,
  type WalletAccount,
  type OperationalContext,
  type SupportedProvider,
} from "./wallet-manager.ts";
import {
  evaluateExecutionReadiness,
  type ExecutionReadinessDecision,
} from "./execution-readiness.ts";
import {
  evaluatePreflightBalance,
  evaluatePreflightExecutionPolicy,
  type PreflightBalanceReport,
  type PreflightPolicyDecision,
} from "./preflight-balance.ts";

export interface ExecutionContextResolution {
  success: boolean;
  operatorWallet?: WalletAccount;
  bankrContext?: OperationalContext;
  basedbotContext?: OperationalContext;
  readinessDecision?: ExecutionReadinessDecision;
  balanceReport?: PreflightBalanceReport;
  policyDecision?: PreflightPolicyDecision;
  rejectionReason?: string;
  evaluatedWalletIds: string[];
  attempts: number;
}

export interface ResolveExecutableWalletOptions {
  requiredProvider: SupportedProvider;
  targetChains: string[];
  minEth: number;
  minSol: number;
  telegramBotTokenPresent: boolean;
  /** Optional initial candidate wallet IDs (defaults to all ACTIVE wallets in vault). */
  initialCandidateWalletIds?: string[];
  /** Optional injectable balance evaluator for deterministic testing without real RPCs. */
  balanceEvaluator?: (options: {
    eligibleChains: string[];
    evmAddress?: string | null;
    solanaAddress?: string | null;
    minEth: number;
    minSol: number;
  }) => Promise<PreflightBalanceReport>;
}

/**
 * Resolves an authoritative, executable wallet and operational context for the current cycle.
 * Iteratively attempts legitimately eligible wallets until one passes native balance pre-flight,
 * an infrastructure failure occurs, or all candidates are exhausted.
 */
export async function resolveExecutableWalletForCycle(
  options: ResolveExecutableWalletOptions
): Promise<ExecutionContextResolution> {
  const {
    requiredProvider,
    targetChains,
    minEth,
    minSol,
    telegramBotTokenPresent,
    initialCandidateWalletIds,
    balanceEvaluator = evaluatePreflightBalance,
  } = options;

  // 0. Proactive Pre-Flight Proxy Pool Resupply Sync
  try {
    const activeHealthyCount = listProxyConfigs("ACTIVE").filter(
      (p) => p.healthStatus === "available"
    ).length;

    if (activeHealthyCount < 2) {
      const resupply = await probeAndResupplyQuarantinedPool({
        minActiveThreshold: 2,
        timeoutMs: 5000,
      });
      if (resupply.resuppliedCount > 0) {
        logger.info(
          `🔄 [PRE-DEPLOY] Proactive pool resupply memulihkan ${resupply.resuppliedCount} proxy cadangan dari karantina: [${resupply.resuppliedIds.join(", ")}]`
        );
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️ [PRE-DEPLOY] Proactive pool resupply notice: ${err?.message || err}`);
  }

  // 1. Build initial candidate wallet set
  let candidateWalletIds: string[] = initialCandidateWalletIds
    ? [...initialCandidateWalletIds]
    : listWalletAccounts("ACTIVE").map((w) => w.id);

  if (candidateWalletIds.length === 0) {
    candidateWalletIds = [bootstrapDefaultWallet().id];
  }

  const evaluatedWalletIds: string[] = [];
  const maxAttempts = candidateWalletIds.length;

  for (let attempt = 0; attempt < maxAttempts && candidateWalletIds.length > 0; attempt++) {
    // 2. Select wallet using capability-aware distribution
    const operatorWallet = selectExecutionWallet({
      requiredProvider,
      targetChains,
      candidateWalletIds,
    });

    evaluatedWalletIds.push(operatorWallet.id);

    // 3. Resolve operational contexts for this specific wallet
    let bankrContext = resolveOperationalContext(operatorWallet.id, "bankr");
    let basedbotContext = resolveOperationalContext(operatorWallet.id, "basedbot");

    // Pre-Deploy Auto-Failover Gate: If bankrContext is unusable due to unhealthy proxy,
    // trigger autoFailoverUnhealthyRoutes() and re-resolve bankrContext before evaluating readiness!
    if (!bankrContext.isUsable && bankrContext.proxy && bankrContext.proxy.healthStatus !== "available") {
      logger.warn(
        `⚠️ [PRE-DEPLOY] Wallet '${operatorWallet.id}' proxy '${bankrContext.proxy.id}' tidak sehat (${bankrContext.proxy.healthStatus}). Mencoba auto-failover ke proxy cadangan...`
      );
      await autoFailoverUnhealthyRoutes();
      bankrContext = resolveOperationalContext(operatorWallet.id, "bankr");
    }

    // 4. Evaluate operational readiness
    const readinessDecision = evaluateExecutionReadiness({
      operatorWallet,
      bankrContext,
      basedbotContext,
      eligibleChains: targetChains,
      telegramBotTokenPresent,
    });

    if (!readinessDecision.ready) {
      logger.warn(
        `⛔ [PRE-FLIGHT] Deployment dibatalkan: ${readinessDecision.action} — ` +
          readinessDecision.reasons.join("; ")
      );
      return {
        success: false,
        operatorWallet,
        bankrContext,
        basedbotContext,
        readinessDecision,
        rejectionReason: readinessDecision.action,
        evaluatedWalletIds,
        attempts: attempt + 1,
      };
    }

    // 5. Native balance pre-flight evaluation
    const balanceReport = await balanceEvaluator({
      eligibleChains: readinessDecision.executableChains,
      evmAddress: operatorWallet.evmAddress,
      solanaAddress: operatorWallet.solanaAddress,
      minEth,
      minSol,
    });

    // 6. Policy C evaluation
    const policyDecision = evaluatePreflightExecutionPolicy(balanceReport);

    // 7. Check for infrastructure failure (Solana RPC failure) -> HARD BLOCK
    if (policyDecision.action === "BLOCK_SOLANA_RPC_FAILURE") {
      logger.warn(
        `⛔ [PREFLIGHT-BALANCE] Deployment dibatalkan: Solana RPC tidak dapat dijangkau — ` +
          policyDecision.reasons.join("; ")
      );
      return {
        success: false,
        operatorWallet,
        bankrContext,
        basedbotContext,
        readinessDecision,
        balanceReport,
        policyDecision,
        rejectionReason: "PREFLIGHT_SOLANA_RPC_FAILURE",
        evaluatedWalletIds,
        attempts: attempt + 1,
      };
    }

    // 8. Check for wallet-specific failure (insufficient balance or missing address)
    if (policyDecision.action === "BLOCK_INSUFFICIENT_BALANCE") {
      logger.warn(
        `⚠️  [PREFLIGHT-BALANCE] Saldo native tidak mencukupi untuk wallet '${operatorWallet.id}'. ` +
          `Detail: ${policyDecision.reasons.join("; ")}. Mengevaluasi wallet eligible berikutnya...`
      );

      // Exclude this wallet from candidate set for CURRENT CYCLE ONLY (in-memory)
      candidateWalletIds = candidateWalletIds.filter((id) => id !== operatorWallet.id);

      if (candidateWalletIds.length === 0) {
        break;
      }
      continue;
    }

    // 9. Wallet successfully passed preflight (PROCEED)
    if (policyDecision.warningChains.length > 0) {
      logger.warn(
        `⚠️  [PREFLIGHT-BALANCE] RPC EVM tidak dapat dijangkau untuk chain: [${policyDecision.warningChains.join(", ")}]. ` +
          `Bankr mengelola signing secara independen; eksekusi dilanjutkan.`
      );
    }

    if (balanceReport.passedChains.length > 0) {
      logger.info(
        `✅ [PREFLIGHT-BALANCE] Saldo native wallet '${operatorWallet.id}' mencukupi ` +
          `untuk chain: [${balanceReport.passedChains.join(", ")}]`
      );
    }

    return {
      success: true,
      operatorWallet,
      bankrContext,
      basedbotContext,
      readinessDecision,
      balanceReport,
      policyDecision,
      evaluatedWalletIds,
      attempts: attempt + 1,
    };
  }

  // All eligible candidate wallets were evaluated and failed balance preflight
  const details = `Semua wallet yang eligible ([${evaluatedWalletIds.join(", ")}]) gagal native balance preflight.`;
  logger.warn(`⛔ [PREFLIGHT-BALANCE] ${details} Siklus dibatalkan sebelum asset generation.`);

  return {
    success: false,
    rejectionReason: "PREFLIGHT_ALL_WALLETS_INSUFFICIENT",
    evaluatedWalletIds,
    attempts: evaluatedWalletIds.length,
  };
}
