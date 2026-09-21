/**
 * onchain-reconciler.ts — Orchestrator for On-Chain Evidence Verification & PnL Accounting.
 *
 * Core Principles:
 *   1. Blockchain -> Reconciler -> Database (strictly READ-ONLY against blockchain).
 *      The reconciler NEVER issues buy, sell, swap, deploy, or transfer transactions.
 *   2. Monotonic Evidence Progression:
 *      unknown / unresolved (rank 1) -> balance_delta_only (rank 2) -> transaction_verified (rank 3).
 *      Stronger evidence is NEVER overwritten by weaker evidence.
 *   3. Realized PnL is based on actual proceeds and allocated entry cost:
 *      realizedPnL = netExitProceeds - allocatedEntryCost.
 *      If exact execution proceeds or cost basis are missing, flags as PNL_PENDING (no fabricated PnL).
 */
import { logger } from "../../logger.ts";
import axios from "axios";
import { getConfig } from "../../config.ts";
import { evaluateBuyLifecycle, evaluateExitLifecycle } from "./lifecycle-policy.ts";
import {
  acquireLock,
  releaseLock,
  getPositionsByStatus,
  getPositionByContract,
  updatePositionReconciliation,
  transitionPositionState,
  getUnreconciledDeployments,
  updateDeployLifecycle,
  getDeployLogByContract,
  getAllDeployLogs,
  type ActivePosition,
} from "../../db/vault.ts";
import { recordRealizedPnlToLedger } from "../treasury/treasury-ledger.ts";

function parseTimestamp(ts: string | null | undefined): number {
  if (!ts) return Date.now();
  const formatted = ts.includes("T") ? (ts.endsWith("Z") ? ts : `${ts}Z`) : `${ts.replace(" ", "T")}Z`;
  const parsed = new Date(formatted).getTime();
  return isNaN(parsed) ? Date.now() : parsed;
}
import {
  verifyEvmTransactionReceipt,
  verifyEvmDeploymentAttribution,
  verifyEvmTransactionAttribution,
  verifyEvmTokenBalance,
  verifyEvmContractExists,
  deriveEvmAddress,
  calculateEvmDeploymentCost,
} from "./evm-verifier.ts";
import {
  verifySolanaTransaction,
  verifySolanaTransactionAttribution,
  verifySolanaTokenBalance,
  verifySolanaAccountExists,
  deriveSolanaAddress,
} from "./solana-verifier.ts";

export type ReconciliationStatus = "confirmed" | "pending" | "not_found" | "unknown" | "error" | "failed";

export interface ReconciliationResult {
  status: ReconciliationStatus;
  chain: "base" | "robinhood" | "solana";
  contractAddress?: string;
  transactionHash?: string;
  walletAddress?: string;
  tokenBalance?: string;
  nativeBalance?: string;
  observedAt: string;
  reason?: string;
  attributionStatus?: "transaction_verified" | "balance_delta_only" | "unresolved";
}

export interface PnlCalculationInput {
  entryAmountTokens: bigint;
  exitAmountTokens: bigint;
  entryCostNative?: number;
  entryCostUsd?: number;
  exitProceedsNative?: number;
  exitProceedsUsd?: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  entryFees?: number;
  exitFees?: number;
}

export interface PnlCalculationResult {
  pnlStatus: "calculated" | "pnl_pending" | "unverified";
  realizedPnl?: number;
  realizedPnlPercent?: number;
  priceReturnPercent?: number;
  allocatedEntryCost?: number;
  netExitProceeds?: number;
  tokensRemaining?: bigint;
  isPartialExit: boolean;
  reason?: string;
}

/**
 * Pure Realized PnL calculation adhering to institutional accounting standards:
 *   realizedPnL = netExitProceeds - allocatedEntryCost
 */
export function calculateRealizedPnl(input: PnlCalculationInput): PnlCalculationResult {
  const {
    entryAmountTokens,
    exitAmountTokens,
    entryCostNative,
    exitProceedsNative,
    entryPriceUsd,
    exitPriceUsd,
    entryFees = 0,
    exitFees = 0,
  } = input;

  const isPartialExit = exitAmountTokens < entryAmountTokens;
  const tokensRemaining =
    entryAmountTokens > exitAmountTokens ? entryAmountTokens - exitAmountTokens : 0n;

  // Compute price return if prices are available
  let priceReturnPercent: number | undefined;
  if (entryPriceUsd !== undefined && entryPriceUsd > 0 && exitPriceUsd !== undefined) {
    priceReturnPercent = ((exitPriceUsd - entryPriceUsd) / entryPriceUsd) * 100;
  }

  // To calculate definitive realized PnL, we need actual proceeds and cost basis
  if (exitProceedsNative !== undefined && entryCostNative !== undefined && entryCostNative > 0) {
    // Allocation ratio for partial or full fill: (exitAmountTokens / entryAmountTokens)
    const ratio =
      entryAmountTokens > 0n ? Number(exitAmountTokens) / Number(entryAmountTokens) : 1;
    const allocatedCost = entryCostNative * ratio + entryFees * ratio;
    const netProceeds = exitProceedsNative - exitFees;
    const realizedPnl = netProceeds - allocatedCost;
    const realizedPnlPercent = allocatedCost > 0 ? (realizedPnl / allocatedCost) * 100 : 0;

    return {
      pnlStatus: "calculated",
      realizedPnl,
      realizedPnlPercent,
      priceReturnPercent,
      allocatedEntryCost: allocatedCost,
      netExitProceeds: netProceeds,
      tokensRemaining,
      isPartialExit,
    };
  }

  // If actual execution proceeds are missing, we MUST NOT invent a fictitious realized PnL
  return {
    pnlStatus: "pnl_pending",
    priceReturnPercent,
    tokensRemaining,
    isPartialExit,
    reason: "Exact execution proceeds or cost basis missing from on-chain transaction data",
  };
}

/**
 * Universal token balance reader across EVM and Solana.
 */
export async function fetchOnchainTokenBalance(
  chain: string,
  contractAddress: string,
  walletAddress: string
): Promise<{ rawBalance: string; decimals: number; formatted: string } | null> {
  const normalized = chain.trim().toLowerCase();

  if (normalized === "solana") {
    const sol = await verifySolanaTokenBalance(contractAddress, walletAddress);
    if (!sol) return null;
    return {
      rawBalance: sol.rawBalance,
      decimals: sol.decimals,
      formatted: sol.uiAmountString,
    };
  }

  // EVM chains: base, robinhood
  const evm = await verifyEvmTokenBalance(contractAddress, walletAddress, normalized);
  if (!evm) return null;
  return {
    rawBalance: evm.rawBalance.toString(),
    decimals: evm.decimals,
    formatted: evm.formattedBalance,
  };
}

/**
 * Resolves the primary wallet address for the given chain.
 */
export function getWalletAddressForChain(chain: string): string | null {
  const normalized = chain.trim().toLowerCase();
  if (normalized === "solana") {
    return deriveSolanaAddress();
  }
  return deriveEvmAddress();
}

/**
 * Reconciles unresolved / submitted deployments with on-chain receipts and attribution logs.
 */
export async function reconcileDeployments(): Promise<void> {
  const unresolved = getUnreconciledDeployments();
  if (unresolved.length === 0) return;

  logger.info(`🔍 [RECONCILER] Reconciling ${unresolved.length} unresolved deployment(s)...`);

  for (const dep of unresolved) {
    if (!dep.txHash) continue;

    const chain = dep.chain.toLowerCase();

    if (chain === "solana") {
      const ver = await verifySolanaTransactionAttribution(dep.txHash, dep.contractAddr);
      if (dep.id !== undefined && ver.status === "confirmed") {
        updateDeployLifecycle(dep.id, "DEPLOY_CONFIRMED", {
          status: "success",
          attributionStatus: "transaction_verified",
          attributionReason: "Solana transaction signature confirmed on cluster",
        });
        logger.success(`✅ [RECONCILER] Deployment $${dep.ticker} on SOLANA CONFIRMED on-chain.`);
      } else if (dep.id !== undefined && ver.status === "failed") {
        updateDeployLifecycle(dep.id, "FAILED", {
          status: "failed",
          errorMsg: ver.reason || "Solana transaction failed on-chain",
          attributionStatus: "unresolved",
        });
        logger.error(`❌ [RECONCILER] Deployment $${dep.ticker} on SOLANA FAILED on-chain.`);
      } else {
        logger.info(`⏳ [RECONCILER] Deployment $${dep.ticker} on SOLANA remains ${ver.status.toUpperCase()} (${ver.reason ?? "waiting"}).`);
      }
    } else {
      // EVM Deployment Attribution (Base / Robinhood)
      const ver = await verifyEvmDeploymentAttribution(dep.txHash, dep.contractAddr, chain);

      if (dep.id !== undefined && ver.status === "confirmed") {
        let deployCost = 0.0;
        let gasNote = "";
        if (ver.receipt) {
          const operatorAddr = getWalletAddressForChain(chain);
          const gasVer = calculateEvmDeploymentCost(ver.receipt, operatorAddr, chain);
          deployCost = gasVer.deployerGasCostEth;
          gasNote = ` [${gasVer.summary}]`;
        }

        updateDeployLifecycle(dep.id, "DEPLOY_CONFIRMED", {
          status: "success",
          deployCost,
          attributionStatus: "transaction_verified",
          attributionReason: `EVM receipt confirmed with attribution: ${ver.attributionType}${gasNote}`,
        });
        logger.success(`✅ [RECONCILER] Deployment $${dep.ticker} on ${chain.toUpperCase()} CONFIRMED via ${ver.attributionType}.${gasNote}`);
      } else if (dep.id !== undefined && (ver.status === "unresolved" || ver.status === "mismatch")) {
        // Receipt succeeded but does NOT attribute to expected token address -> DO NOT promote to DEPLOY_CONFIRMED
        updateDeployLifecycle(dep.id, "UNRESOLVED_UNKNOWN", {
          status: "unknown",
          errorMsg: ver.reason,
          attributionStatus: "unresolved",
          attributionReason: ver.reason,
        });
        logger.warn(`⚠️  [RECONCILER] Deployment $${dep.ticker} on ${chain.toUpperCase()} cannot be attributed: ${ver.reason}.`);
      } else if (dep.id !== undefined && ver.status === "failed") {
        updateDeployLifecycle(dep.id, "FAILED", {
          status: "failed",
          errorMsg: ver.reason || "On-chain transaction reverted",
          attributionStatus: "unresolved",
        });
        logger.error(`❌ [RECONCILER] Deployment $${dep.ticker} on ${chain.toUpperCase()} FAILED on-chain.`);
      } else {
        logger.info(`⏳ [RECONCILER] Deployment $${dep.ticker} on ${chain.toUpperCase()} remains ${ver.status.toUpperCase()} (${ver.reason ?? "waiting"}).`);
      }
    }
  }
}

/**
 * Reconciles BUY_SUBMITTED positions: moves to POSITION_OPEN ONLY when wallet
 * balance delta is strictly positive (currentRaw > beforeRaw).
 * Distinguishes 'transaction_verified' vs 'balance_delta_only' attribution.
 */
export async function reconcilePendingBuys(): Promise<void> {
  const pendingBuys = getPositionsByStatus("buy_submitted");
  if (pendingBuys.length === 0) return;

  logger.info(`🔍 [RECONCILER] Checking token balances for ${pendingBuys.length} pending buy(s)...`);

  for (const pos of pendingBuys) {
    const walletAddr = pos.walletAddress || getWalletAddressForChain(pos.chain);
    if (!walletAddr) {
      logger.warn(`⚠️  [RECONCILER] No wallet address for position $${pos.ticker}. Skipping.`);
      continue;
    }

    const bal = await fetchOnchainTokenBalance(pos.chain, pos.contractAddr, walletAddr);
    if (!bal) {
      logger.warn(`⚠️  [RECONCILER] Could not read balance for $${pos.ticker} on ${pos.chain}.`);
      continue;
    }

    const beforeRaw = BigInt(pos.balanceBefore || "0");
    const currentRaw = BigInt(bal.rawBalance || "0");

    // Invariant: buy confirmation requires strict net inflow (currentRaw > beforeRaw)
    const hasBalanceIncrease = currentRaw > beforeRaw;

    const cfg = getConfig();
    const buyTimeoutMs = (cfg.BUY_CONFIRMATION_TIMEOUT_MINUTES ?? 15) * 60 * 1000;
    const createdAtMs = pos.createdAt ? parseTimestamp(pos.createdAt) : (pos.updatedAt ? parseTimestamp(pos.updatedAt) : Date.now());
    const elapsedMs = Math.max(0, Date.now() - createdAtMs);

    const buyEval = evaluateBuyLifecycle({
      status: pos.status,
      hasBalanceIncrease,
      elapsedMs,
      timeoutMs: buyTimeoutMs,
    });

    if (buyEval.action === "CONFIRM_BUY") {
      const delta = currentRaw - beforeRaw;

      // Determine attribution evidence: transaction_verified or balance_delta_only
      let attrStatus: "transaction_verified" | "balance_delta_only" = "balance_delta_only";
      let attrReason = "Token balance increased without buy transaction hash (BasedBot Telegram dispatch)";

      if (pos.buyTxHash) {
        if (pos.chain.toLowerCase() === "solana") {
          const solAttr = await verifySolanaTransactionAttribution(pos.buyTxHash, pos.contractAddr, walletAddr);
          if (solAttr.status === "confirmed") {
            attrStatus = "transaction_verified";
            attrReason = "Buy transaction signature confirmed on Solana cluster";
          }
        } else {
          const evmAttr = await verifyEvmTransactionAttribution(pos.buyTxHash, pos.contractAddr, walletAddr, pos.chain);
          // M7 FIX: Require both token transfer AND wallet involvement for transaction_verified.
          // A confirmed receipt alone is insufficient — unrelated transactions could share the same block.
          if (evmAttr.status === "confirmed" && (evmAttr.tokenTransferred || evmAttr.walletInvolved)) {
            attrStatus = "transaction_verified";
            attrReason = `Buy tx confirmed on EVM (token: ${evmAttr.tokenTransferred}, wallet: ${evmAttr.walletInvolved})`;
          } else if (evmAttr.status === "confirmed") {
            attrReason = "Buy tx receipt confirmed but token/wallet involvement not verified in logs";
          }
        }
      }

      const opened = transitionPositionState(pos.contractAddr, "buy_submitted", "open", {
        reconciliationStatus: "confirmed",
        currentBalance: bal.rawBalance,
        balanceAfter: bal.rawBalance,
        attributionStatus: attrStatus,
        attributionReason: attrReason,
        pnlStatus: "pnl_pending",
      });

      if (opened) {
        updatePositionReconciliation(pos.contractAddr, {
          lastReconciledAt: new Date().toISOString(),
          walletAddress: walletAddr,
          tokenDecimals: bal.decimals,
        });

        logger.success(
          `✅ [RECONCILER] Buy confirmed on-chain for $${pos.ticker}! ` +
            `Balance delta: +${delta.toString()} raw (${bal.formatted}). Attribution: ${attrStatus}. State -> POSITION_OPEN.`
        );
      }
    } else if (buyEval.action === "TIMEOUT_BUY") {
      const timedOut = transitionPositionState(pos.contractAddr, "buy_submitted", "buy_timeout", {
        reconciliationStatus: "failed",
        attributionStatus: "unresolved",
        attributionReason: "BUY_CONFIRMATION_TIMEOUT: confirmation window expired without balance evidence",
        closedAt: new Date().toISOString(),
      });

      if (timedOut) {
        if (pos.deployLogId) {
          try {
            updateDeployLifecycle(pos.deployLogId, "POSITION_ABORTED", {
              exitStatus: "buy_timeout",
              errorMsg: "Buy confirmation window expired without balance evidence",
            });
          } catch (err) {
            logger.warn(`⚠️  [RECONCILER] Could not sync deploy_logs for buy_timeout: ${String(err)}`);
          }
        }
        logger.warn(
          `⏱️  [RECONCILER] Buy confirmation window expired for $${pos.ticker} ` +
            `(${Math.round(elapsedMs / 1000)}s >= ${Math.round(buyTimeoutMs / 1000)}s). State -> BUY_TIMEOUT.`
        );
      }
    } else {
      // Balance has not increased: keep in BUY_SUBMITTED (unconfirmed) within timeout window
      logger.info(
        `⏳ [RECONCILER] Buy for $${pos.ticker} unconfirmed on-chain (${Math.round(elapsedMs / 1000)}s < ${Math.round(buyTimeoutMs / 1000)}s). ` +
          `Balance: ${currentRaw.toString()} (Baseline: ${beforeRaw.toString()}). Remains BUY_SUBMITTED.`
      );
    }
  }
}

/**
 * Reconciles POSITION_CLOSING positions: moves to closed ONLY when token balance
 * is verified to have exited on-chain (full or partial exit).
 */
export async function reconcileClosingPositions(): Promise<void> {
  const closingPositions = getPositionsByStatus("closing");
  if (closingPositions.length === 0) return;

  logger.info(`🔍 [RECONCILER] Checking exit evidence for ${closingPositions.length} closing position(s)...`);

  for (const pos of closingPositions) {
    const walletAddr = pos.walletAddress || getWalletAddressForChain(pos.chain);
    if (!walletAddr) continue;

    const bal = await fetchOnchainTokenBalance(pos.chain, pos.contractAddr, walletAddr);
    if (!bal) continue;

    const currentRaw = BigInt(bal.rawBalance || "0");
    const entryRaw = BigInt(pos.balanceAfter || pos.currentBalance || "0");

    // Consider exited if balance is 0 or less than 1% of entry (dust threshold)
    const dustThreshold = entryRaw > 100n ? entryRaw / 100n : 0n;
    const isExited = currentRaw <= dustThreshold;
    const isPartialExit = !isExited && currentRaw < entryRaw;

    if (isExited || isPartialExit) {
      const finalExitStatus = pos.exitReason === "stop_loss" ? "sold_sl" : "sold_tp";
      const exitAmountTokens = isExited ? entryRaw : entryRaw - currentRaw;

      // Determine sell transaction attribution
      let attrStatus: "transaction_verified" | "balance_delta_only" = "balance_delta_only";
      let attrReason = "Exit verified by token balance reduction without direct sell tx hash";

      if (pos.sellTxHash) {
        if (pos.chain.toLowerCase() === "solana") {
          const solAttr = await verifySolanaTransactionAttribution(pos.sellTxHash, pos.contractAddr, walletAddr);
          if (solAttr.status === "confirmed") {
            attrStatus = "transaction_verified";
            attrReason = "Sell transaction signature confirmed on Solana cluster";
          }
        } else {
          const evmAttr = await verifyEvmTransactionAttribution(pos.sellTxHash, pos.contractAddr, walletAddr, pos.chain);
          // M7 FIX: Require token/wallet involvement for transaction_verified
          if (evmAttr.status === "confirmed" && (evmAttr.tokenTransferred || evmAttr.walletInvolved)) {
            attrStatus = "transaction_verified";
            attrReason = `Sell tx confirmed on EVM (token: ${evmAttr.tokenTransferred}, wallet: ${evmAttr.walletInvolved})`;
          } else if (evmAttr.status === "confirmed") {
            attrReason = "Sell tx receipt confirmed but token/wallet involvement not verified in logs";
          }
        }
      }

      // Calculate Realized PnL using institutional formula
      const pnlRes = calculateRealizedPnl({
        entryAmountTokens: entryRaw,
        exitAmountTokens,
        entryCostNative: pos.entryCostRaw ? parseFloat(pos.entryCostRaw) : pos.snipeAmount,
        exitProceedsNative: pos.exitProceedsRaw ? parseFloat(pos.exitProceedsRaw) : undefined,
        entryPriceUsd: pos.entryPrice ?? undefined,
        exitPriceUsd: pos.exitPrice ?? undefined,
        entryFees: pos.entryFeeRaw ? parseFloat(pos.entryFeeRaw) : 0,
        exitFees: pos.exitFeeRaw ? parseFloat(pos.exitFeeRaw) : (pos.fees ?? 0),
      });

      // Fallback: if proceeds were not explicitly set, calculate based on exitPrice if available
      let definitivePnl = pnlRes.realizedPnl;
      let definitivePnlPercent = pnlRes.realizedPnlPercent;
      let pnlStatus = pnlRes.pnlStatus;

      if (definitivePnl === undefined && pos.entryPrice && pos.exitPrice) {
        // NOTE: When exitProceedsNative is unavailable (BasedBot fire-and-forget),
        // we cannot calculate monetary realized PnL. priceReturnPercent is still
        // available from the primary formula if entry/exit prices exist.
        // We do NOT fabricate a PnL figure from mismatched dimensional units.
      }

      // H4 FIX: Partial exits transition back to 'open' for continued price monitoring.
      // Full exits transition to final exit status (sold_tp / sold_sl).
      const targetState = isExited ? finalExitStatus : "open";

      const closed = transitionPositionState(
        pos.contractAddr,
        "closing",
        targetState,
        {
          closedAt: isExited ? new Date().toISOString() : undefined,
          reconciliationStatus: "confirmed",
          attributionStatus: attrStatus,
          attributionReason: attrReason,
          realizedPnl: definitivePnl,
          realizedPnlPercent: definitivePnlPercent,
          priceReturnPercent: pnlRes.priceReturnPercent,
          pnlStatus,
          currentBalance: bal.rawBalance,
        }
      );

      if (closed) {
        updatePositionReconciliation(pos.contractAddr, {
          lastReconciledAt: new Date().toISOString(),
        });

        // H5 FIX: Sync deploy_logs.exit_status when position is fully closed
        if (isExited && pos.deployLogId) {
          try {
            updateDeployLifecycle(pos.deployLogId, "POSITION_CLOSED", {
              exitStatus: finalExitStatus,
            });
          } catch (err) {
            logger.warn(`⚠️  [RECONCILER] Could not sync deploy_logs.exit_status: ${String(err)}`);
          }
        }

        // V2.2 Treasury Lineage: Post verified realized PnL (profit or loss) to treasury ledger
        if (isExited && pnlStatus === "calculated" && definitivePnl !== undefined && definitivePnl !== 0) {
          try {
            const updatedPos = getPositionByContract(pos.contractAddr);
            if (updatedPos) {
              recordRealizedPnlToLedger(updatedPos);
            }
          } catch (err) {
            logger.warn(`⚠️  [RECONCILER] Could not post realized PnL to treasury ledger: ${String(err)}`);
          }
        }

        logger.success(
          `🏁 [RECONCILER] Exit verified on-chain for $${pos.ticker} (${isExited ? "FULL" : "PARTIAL"})! ` +
            `Tokens remaining: ${bal.formatted}. State -> ${isExited ? finalExitStatus.toUpperCase() : "OPEN (re-monitoring)"} ` +
            `(${definitivePnl !== undefined ? `PnL: ${definitivePnl >= 0 ? "+" : ""}${definitivePnl.toFixed(4)}` : "PnL: PENDING"}).`
        );
      }
    } else {
      const cfg = getConfig();
      const exitTimeoutMs = (cfg.EXIT_CONFIRMATION_TIMEOUT_MINUTES ?? 15) * 60 * 1000;
      const closingStartedAtMs = pos.updatedAt ? parseTimestamp(pos.updatedAt) : Date.now();
      const elapsedMs = Math.max(0, Date.now() - closingStartedAtMs);

      const exitEval = evaluateExitLifecycle({
        status: pos.status,
        isExitConfirmed: false,
        isPartialExit: false,
        elapsedMs,
        timeoutMs: exitTimeoutMs,
        exitReason: pos.exitReason ?? undefined,
      });

      if (exitEval.action === "TIMEOUT_EXIT") {
        const timedOut = transitionPositionState(pos.contractAddr, "closing", "unresolved", {
          reconciliationStatus: "unresolved",
          attributionStatus: "unresolved",
          attributionReason: "EXIT_CONFIRMATION_TIMEOUT: tokens remain on-chain after exit confirmation window",
        });

        if (timedOut) {
          logger.warn(
            `⏱️  [RECONCILER] Exit confirmation window expired for $${pos.ticker} ` +
              `(${Math.round(elapsedMs / 1000)}s >= ${Math.round(exitTimeoutMs / 1000)}s). ` +
              `Tokens remaining: ${bal.formatted}. State -> UNRESOLVED. Requires operator investigation.`
          );
        }
      } else {
        logger.info(
          `⏳ [RECONCILER] Exit for $${pos.ticker} not yet confirmed on-chain (${Math.round(elapsedMs / 1000)}s < ${Math.round(exitTimeoutMs / 1000)}s). ` +
            `Tokens remaining: ${bal.formatted}. Remains POSITION_CLOSING.`
        );
      }
    }
  }
}

/**
 * Main reconciliation loop: runs sequentially with strict mutual exclusion lock.
 */
export async function runOnchainReconciliation(): Promise<void> {
  // Concurrency Guard: strictly one reconciler worker active at any time
  if (!acquireLock("onchain_reconciler", 300)) {
    logger.warn("⚠️  [LOCK] Reconciler is already running. Skipping this iteration.");
    return;
  }

  try {
    await reconcileDeployments();
    await reconcilePendingBuys();
    await reconcileClosingPositions();
    await reconcileFleetArmada();
  } catch (err) {
    logger.error(`❌ [RECONCILER] Error during reconciliation cycle: ${String(err)}`);
  } finally {
    releaseLock("onchain_reconciler");
  }
}

export interface FleetReconciliationResult {
  contractAddress: string;
  chain: string;
  onChainVerified: boolean;
  onChainStatus: "confirmed" | "not_found" | "unknown";
  onChainDetails?: string;
  poolId?: string;
  liquidityUsd?: number;
  priceUsd?: string;
  dexId?: string;
  lifecycleState: string;
  poolUpdated: boolean;
  lifecycleUpdated: boolean;
  reconciledAt: string;
}

/**
 * Reconciles a deployed token contract with direct on-chain state and DEX liquidity metadata.
 * - Validates contract existence on-chain (EVM bytecode / Solana account).
 * - Queries DEX pool/pair metadata (DexScreener API) in a non-blocking read-only manner.
 * - Idempotently updates pool_id and promotes lifecycle_state if newly confirmed.
 * - Strictly READ-ONLY: performs ZERO on-chain state mutations or transactions.
 */
export async function reconcileFleetOnChain(
  tokenAddress: string,
  chain: string,
  options?: {
    customClient?: any;
    customConnection?: any;
    fetchDex?: boolean;
    dexTimeoutMs?: number;
  }
): Promise<FleetReconciliationResult> {
  const normChain = chain.trim().toLowerCase();
  const existingLog = getDeployLogByContract(tokenAddress);
  const reconciledAt = new Date().toISOString();

  let onChainVerified = false;
  let onChainStatus: "confirmed" | "not_found" | "unknown" = "unknown";
  let onChainDetails: string | undefined;

  if (normChain === "solana") {
    const solRes = await verifySolanaAccountExists(tokenAddress, options?.customConnection);
    onChainVerified = solRes.exists;
    onChainStatus = solRes.status;
    onChainDetails = solRes.reason;
  } else {
    // EVM: base, robinhood
    const evmRes = await verifyEvmContractExists(tokenAddress, normChain, options?.customClient);
    onChainVerified = evmRes.exists;
    onChainStatus = evmRes.status;
    onChainDetails = evmRes.reason;
  }

  // Query DEX metadata (read-only)
  let poolId = existingLog?.poolId ?? undefined;
  let liquidityUsd: number | undefined;
  let priceUsd: string | undefined;
  let dexId: string | undefined;

  if (options?.fetchDex !== false) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const timeout = options?.dexTimeoutMs ?? 4000;
      const res = await axios.get(url, {
        timeout,
        headers: { Accept: "application/json" },
        validateStatus: (s) => s === 200,
      });

      if (res.data && Array.isArray(res.data.pairs) && res.data.pairs.length > 0) {
        const primaryPair = res.data.pairs[0];
        if (primaryPair.pairAddress) {
          poolId = primaryPair.pairAddress;
        }
        if (primaryPair.dexId) {
          dexId = primaryPair.dexId;
        }
        if (primaryPair.liquidity?.usd != null) {
          liquidityUsd = Number(primaryPair.liquidity.usd);
        }
        if (primaryPair.priceUsd) {
          priceUsd = primaryPair.priceUsd;
        }
      }
    } catch {
      // Non-blocking DEX metadata retrieval failure (DexScreener offline or rate-limited)
    }
  }

  let poolUpdated = false;
  let lifecycleUpdated = false;
  let currentLifecycle = existingLog?.lifecycleState ?? "DEPLOY_SUBMITTED";

  if (existingLog && existingLog.id) {
    const extraUpdates: Parameters<typeof updateDeployLifecycle>[2] = {};

    // 1. Update pool_id if newly discovered
    if (poolId && (!existingLog.poolId || existingLog.poolId !== poolId)) {
      extraUpdates.poolId = poolId;
      poolUpdated = true;
    }

    // 2. Promote to DEPLOY_CONFIRMED if on-chain existence is verified and state was pending
    if (
      onChainVerified &&
      (currentLifecycle === "DEPLOY_SUBMITTED" || currentLifecycle === "UNRESOLVED_UNKNOWN")
    ) {
      currentLifecycle = "DEPLOY_CONFIRMED";
      extraUpdates.status = "success";
      extraUpdates.attributionStatus = "transaction_verified";
      extraUpdates.attributionReason = onChainDetails ?? "On-chain contract existence verified by reconciler";
      lifecycleUpdated = true;
    }

    if (poolUpdated || lifecycleUpdated) {
      updateDeployLifecycle(existingLog.id, currentLifecycle, extraUpdates);
      logger.info(
        `🔄 [RECONCILER] Updated fleet record for $${existingLog.ticker} (${tokenAddress}): ` +
          `Lifecycle=${currentLifecycle}${poolUpdated ? `, PoolId=${poolId}` : ""}`
      );
    }

    // Non-blocking dual-write of DEX telemetry to Neon PostgreSQL (per-token database)
    if (existingLog.ticker && (priceUsd != null || liquidityUsd != null)) {
      try {
        const { recordTokenTelemetry } = await import("../../db/neon-vault.ts");
        recordTokenTelemetry(existingLog.ticker, {
          contractAddr: tokenAddress,
          priceUsd: priceUsd ? parseFloat(priceUsd) : undefined,
          liquidityUsd: liquidityUsd,
        }).catch(() => {});
      } catch {
        /* non-blocking */
      }
    }
  }

  return {
    contractAddress: tokenAddress,
    chain: normChain,
    onChainVerified,
    onChainStatus,
    onChainDetails,
    poolId,
    liquidityUsd,
    priceUsd,
    dexId,
    lifecycleState: currentLifecycle,
    poolUpdated,
    lifecycleUpdated,
    reconciledAt,
  };
}

/**
 * Iterates through all production fleet tokens with contract addresses and reconciles them.
 */
export async function reconcileFleetArmada(options?: {
  limit?: number;
  fetchDex?: boolean;
}): Promise<FleetReconciliationResult[]> {
  const logs = getAllDeployLogs({ limit: options?.limit ?? 50 });
  const results: FleetReconciliationResult[] = [];

  for (const log of logs) {
    if (!log.contractAddr || log.contractAddr.length < 20) continue;
    // Skip simulated test fixtures
    if (log.contractAddr.startsWith("pump_sim_") || log.contractAddr.startsWith("0xsim_")) continue;

    try {
      const res = await reconcileFleetOnChain(log.contractAddr, log.chain, {
        fetchDex: options?.fetchDex ?? true,
      });
      results.push(res);
    } catch (err) {
      logger.warn(`⚠️  [RECONCILER] Error reconciling fleet token ${log.contractAddr}: ${String(err)}`);
    }
  }

  return results;
}
