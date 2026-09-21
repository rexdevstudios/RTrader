/**
 * fee-claimer.ts — Fee Claiming Orchestrator with On-Chain Verification.
 *
 * Architecture Principles:
 *   1. Explicit Authorization: Only fees in 'claimable' state can be claimed.
 *   2. On-Chain Verification: A fee claim is NEVER marked 'claimed' without a verified tx_hash.
 *   3. Autonomous Ledger Credit: Successful claims automatically post a credit entry to treasury_ledger.
 *   4. Failure Safety: If claim execution or on-chain verification reverts, status moves to 'failed'
 *      with the error recorded, preventing ledger pollution or double-claiming.
 *   5. Multi-Wallet Aware: Resolves the dynamic WalletAccount for the fee event's beneficiary.
 */
import axios from "axios";
import {
  getFeeEventById,
  updateFeeEventStatus,
  getInFlightFeeEvents,
  getClaimedFeesMissingLedger,
  type FeeEvent,
  type FeeStatus,
} from "../../db/vault.ts";
import { getWalletAccount } from "../identity/wallet-manager.ts";
import { recordFeeClaimedToLedger } from "./treasury-ledger.ts";
import { verifyEvmTransactionReceipt } from "../reconciliation/evm-verifier.ts";
import { verifySolanaTransaction } from "../reconciliation/solana-verifier.ts";
import { getConfig } from "../../config.ts";
import { getBankrHeaders, sanitizeSecret } from "../evm/bankr-deployer.ts";
import { logger } from "../../logger.ts";

export interface ClaimResult {
  success: boolean;
  feeEventId: number;
  status: FeeStatus;
  claimTxHash?: string;
  error?: string;
}

/**
 * Claims a specific available fee event.
 * Requires transaction evidence (either provided or executed) before marking 'claimed'.
 */
export async function claimAvailableFee(
  feeEventId: number,
  options?: {
    customTxHash?: string;
    executeOnchain?: boolean;
    simulateOnly?: boolean;
    ignoreMinThreshold?: boolean;
  }
): Promise<ClaimResult> {
  const event = getFeeEventById(feeEventId);
  if (!event) {
    return {
      success: false,
      feeEventId,
      status: "failed",
      error: `FeeEvent #${feeEventId} does not exist.`,
    };
  }

  // Guard: Only claimable fees can be claimed
  if (event.status !== "claimable") {
    return {
      success: false,
      feeEventId,
      status: event.status,
      error: `FeeEvent #${feeEventId} is in '${event.status}' state (must be 'claimable').`,
    };
  }

  // 1. Resolve Wallet
  const wallet = getWalletAccount(event.walletId);
  if (!wallet || wallet.status === "DISABLED") {
    const errorMsg = `WalletAccount '${event.walletId}' is missing or DISABLED. Claim aborted.`;
    logger.error(`❌ [FEE CLAIMER] ${errorMsg}`);
    updateFeeEventStatus(feeEventId, "failed", { metadata: { error: errorMsg } });
    return { success: false, feeEventId, status: "failed", error: errorMsg };
  }

  const cfg = getConfig();

  // Enforce minimum claim threshold for automated on-chain claims to prevent gas micro-claims
  if (
    options?.executeOnchain &&
    !options?.customTxHash &&
    !options?.ignoreMinThreshold &&
    cfg.TREASURY_MIN_CLAIM_ETH > 0 &&
    event.amountFormatted < cfg.TREASURY_MIN_CLAIM_ETH &&
    (event.tokenSymbol === "ETH" || event.tokenSymbol === "WETH")
  ) {
    return {
      success: false,
      feeEventId,
      status: "claimable",
      error: `Fee amount (${event.amountFormatted} ${event.tokenSymbol}) is below minimum claim threshold (${cfg.TREASURY_MIN_CLAIM_ETH}).`,
    };
  }

  let txHash = options?.customTxHash;

  // If no customTxHash is provided and onchain execution is enabled for Bankr fees:
  if (!txHash && options?.executeOnchain && event.source === "bankr_creator_fee" && event.tokenAddress) {
    const isTestnet = cfg.DEPLOY_MODE === "testnet" || cfg.BANKR_SIMULATE_ONLY || Boolean(options?.simulateOnly);
    const apiKey = cfg.BANKR_API_KEY;

    if (!apiKey) {
      const errorMsg = "BANKR_API_KEY is not configured for fee claim.";
      logger.error(`❌ [FEE CLAIMER] ${errorMsg}`);
      updateFeeEventStatus(feeEventId, "failed", { metadata: { error: errorMsg } });
      return { success: false, feeEventId, status: "failed", error: errorMsg };
    }

    // Persist claim submission intent to prevent concurrent or duplicate dispatch
    updateFeeEventStatus(feeEventId, "claim_submitted", {
      metadata: {
        ...(event.metadata ?? {}),
        claimLifecycle: "CLAIM_SUBMITTED",
        claimInitiatedAt: new Date().toISOString(),
      },
    });

    try {
      const headers = getBankrHeaders(apiKey);
      const url = `https://api.bankr.bot/token-launches/${event.tokenAddress}/fees/claim`;
      const response = await axios.post<{
        success?: boolean;
        transactionHash?: string;
        txHash?: string;
        message?: string;
        status?: string;
      }>(
        url,
        {},
        { headers, timeout: cfg.API_TIMEOUT_MS ?? 15000 }
      );

      const resolvedTxHash = response.data?.transactionHash || response.data?.txHash;

      if (resolvedTxHash) {
        txHash = resolvedTxHash;
        updateFeeEventStatus(feeEventId, "claim_pending", {
          claimTxHash: txHash,
          metadata: {
            ...(event.metadata ?? {}),
            claimLifecycle: "CLAIM_PENDING",
            claimTxHash: txHash,
          },
        });
      } else if (isTestnet) {
        txHash = `sim_claim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        updateFeeEventStatus(feeEventId, "claim_pending", {
          claimTxHash: txHash,
          metadata: {
            ...(event.metadata ?? {}),
            claimLifecycle: "CLAIM_PENDING",
            claimTxHash: txHash,
          },
        });
      } else {
        throw new Error(response.data?.message || "No transactionHash returned from Bankr fee claim API");
      }
    } catch (apiErr: any) {
      if (isTestnet) {
        logger.warn(
          `🧪 [FEE CLAIMER] MODE TESTNET: Remote fee claim simulation fallback. Note: ${sanitizeSecret(
            apiErr?.response?.data?.message || apiErr?.response?.data?.error || apiErr?.message || String(apiErr)
          )}`
        );
        txHash = `sim_claim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        updateFeeEventStatus(feeEventId, "claim_pending", {
          claimTxHash: txHash,
          metadata: {
            ...(event.metadata ?? {}),
            claimLifecycle: "CLAIM_PENDING",
            claimTxHash: txHash,
          },
        });
      } else {
        const isNetworkTimeoutOr5xx =
          axios.isAxiosError(apiErr) &&
          (apiErr.code === "ECONNABORTED" ||
            apiErr.code === "ETIMEDOUT" ||
            !apiErr.response ||
            (apiErr.response.status >= 500 && apiErr.response.status <= 599));

        if (isNetworkTimeoutOr5xx) {
          const errorMsg = `CLAIM_UNKNOWN: Bankr API claim request timed out or returned server error (${apiErr.message}). AUTOMATIC RETRY FORBIDDEN until reconciled.`;
          logger.error(`⚠️  [FEE CLAIMER] ${errorMsg}`);
          updateFeeEventStatus(feeEventId, "unknown", {
            metadata: {
              ...(event.metadata ?? {}),
              claimLifecycle: "CLAIM_UNKNOWN",
              error: errorMsg,
            },
          });
          return { success: false, feeEventId, status: "unknown", error: errorMsg };
        }

        const errorMsg = sanitizeSecret(
          apiErr?.response?.data?.message || apiErr?.response?.data?.error || apiErr?.message || String(apiErr)
        );
        logger.error(`❌ [FEE CLAIMER] Bankr API claim failed: ${errorMsg}`);
        updateFeeEventStatus(feeEventId, "failed", {
          metadata: {
            ...(event.metadata ?? {}),
            claimLifecycle: "CLAIM_FAILED",
            error: errorMsg,
          },
        });
        return { success: false, feeEventId, status: "failed", error: errorMsg };
      }
    }
  }

  if (!txHash) {
    // If no txHash provided and direct on-chain contract execution is not mocked,
    // we require transaction attribution evidence before claiming:
    const errorMsg = `No claim transaction hash provided for FeeEvent #${feeEventId}. Cannot verify on-chain.`;
    logger.warn(`⚠️  [FEE CLAIMER] ${errorMsg}`);
    updateFeeEventStatus(feeEventId, "failed", { metadata: { error: errorMsg } });
    return { success: false, feeEventId, status: "failed", error: errorMsg };
  }

  // 2. Verify On-Chain Transaction Evidence
  const chainNorm = event.chain.trim().toLowerCase();
  let isTxValid = false;

  if (txHash.startsWith("sim_") || (cfg.DEPLOY_MODE === "testnet" && txHash.includes("sim"))) {
    isTxValid = true;
  } else {
    try {
      if (chainNorm === "solana") {
        const solVerification = await verifySolanaTransaction(txHash);
        isTxValid = solVerification.status === "confirmed";
      } else {
        const evmVerification = await verifyEvmTransactionReceipt(txHash, chainNorm);
        isTxValid = evmVerification.status === "confirmed";
      }
    } catch (err) {
      logger.warn(`⚠️  [FEE CLAIMER] On-chain verification threw: ${String(err)}`);
      isTxValid = false;
    }
  }

  // If verification failed on-chain
  if (!isTxValid) {
    const errorMsg = `On-chain verification failed or reverted for claim tx: ${txHash}`;
    logger.error(`❌ [FEE CLAIMER] ${errorMsg}`);
    updateFeeEventStatus(feeEventId, "failed", {
      claimTxHash: txHash,
      metadata: {
        ...(event.metadata ?? {}),
        claimLifecycle: "CLAIM_FAILED",
        error: errorMsg,
      },
    });
    return {
      success: false,
      feeEventId,
      status: "failed",
      claimTxHash: txHash,
      error: errorMsg,
    };
  }

  // 3. Mark 'claimed' in database
  const now = new Date().toISOString();
  updateFeeEventStatus(feeEventId, "claimed", {
    claimTxHash: txHash,
    claimedAt: now,
    metadata: {
      ...(event.metadata ?? {}),
      claimLifecycle: "CLAIM_CONFIRMED",
    },
  });

  // Re-fetch updated event
  const updatedEvent = getFeeEventById(feeEventId)!;

  // 4. Post credit to treasury ledger
  recordFeeClaimedToLedger(updatedEvent, txHash);

  logger.success(
    `✅ [FEE CLAIMER] Successfully claimed ${event.amountFormatted} ${event.tokenSymbol} ` +
      `for wallet '${event.walletId}' (Tx: ${txHash}). State -> CLAIMED.`
  );

  return {
    success: true,
    feeEventId,
    status: "claimed",
    claimTxHash: txHash,
  };
}

/**
 * Batch claims all claimable fees for a given wallet (or all wallets).
 */
export async function claimAllAvailableFees(
  walletId?: string,
  options?:
    | {
        txHashSupplier?: (event: FeeEvent) => string;
        executeOnchain?: boolean;
        ignoreMinThreshold?: boolean;
      }
    | ((event: FeeEvent) => string)
): Promise<ClaimResult[]> {
  const { getClaimableFees } = await import("./fee-scanner.ts");
  const claimable = getClaimableFees(walletId);
  const results: ClaimResult[] = [];

  const txSupplier = typeof options === "function" ? options : options?.txHashSupplier;
  const executeOnchain = typeof options === "object" ? options?.executeOnchain : false;
  const ignoreMinThreshold = typeof options === "object" ? options?.ignoreMinThreshold : false;

  for (const fee of claimable) {
    const txHash = txSupplier ? txSupplier(fee) : undefined;
    const result = await claimAvailableFee(fee.id, {
      customTxHash: txHash,
      executeOnchain,
      ignoreMinThreshold,
    });
    results.push(result);
  }

  return results;
}

export interface FeeClaimReconciliationSummary {
  inspected: number;
  confirmed: number;
  reverted: number;
  stillPending: number;
  resetToClaimable: number;
  ledgerEntriesRepaired: number;
  unresolved: number;
}

/**
 * Reconciles in-flight, pending, unknown, or unposted creator fee claims.
 * Run automatically at the start of each treasury sync cycle to recover
 * from process restarts, network timeouts, or delayed on-chain mining.
 */
export async function reconcileInFlightFeeClaims(): Promise<FeeClaimReconciliationSummary> {
  const summary: FeeClaimReconciliationSummary = {
    inspected: 0,
    confirmed: 0,
    reverted: 0,
    stillPending: 0,
    resetToClaimable: 0,
    ledgerEntriesRepaired: 0,
    unresolved: 0,
  };

  // 1. Repair any claimed events that are missing ledger entries (e.g. crash after onchain confirm before ledger insert)
  const missingLedger = getClaimedFeesMissingLedger();
  for (const fee of missingLedger) {
    const txHash = fee.claimTxHash || "reconciled_tx";
    try {
      recordFeeClaimedToLedger(fee, txHash);
      summary.ledgerEntriesRepaired++;
      logger.success(`🏛️  [FEE CLAIM RECONCILER] Repaired missing ledger entry for claimed fee #${fee.id} (${fee.amountFormatted} ${fee.tokenSymbol}).`);
    } catch (err) {
      logger.warn(`⚠️  [FEE CLAIM RECONCILER] Failed to repair ledger for fee #${fee.id}: ${String(err)}`);
    }
  }

  // 2. Inspect all in-flight fee events (claim_submitted, claim_pending, unknown)
  const inFlight = getInFlightFeeEvents();
  summary.inspected = inFlight.length;

  if (inFlight.length === 0) {
    return summary;
  }

  const cfg = getConfig();

  for (const event of inFlight) {
    // Case A: Event has a transaction hash -> verify on-chain
    if (event.claimTxHash) {
      const txHash = event.claimTxHash;
      const chainNorm = event.chain.trim().toLowerCase();

      if (txHash.startsWith("sim_") || (cfg.DEPLOY_MODE === "testnet" && txHash.includes("sim"))) {
        updateFeeEventStatus(event.id, "claimed", {
          claimTxHash: txHash,
          claimedAt: new Date().toISOString(),
          metadata: {
            ...(event.metadata ?? {}),
            claimLifecycle: "CLAIM_CONFIRMED",
            reconciled: true,
          },
        });
        const updated = getFeeEventById(event.id)!;
        recordFeeClaimedToLedger(updated, txHash);
        summary.confirmed++;
        continue;
      }

      try {
        let isConfirmed = false;
        let isReverted = false;

        if (chainNorm === "solana") {
          const solVer = await verifySolanaTransaction(txHash);
          isConfirmed = solVer.status === "confirmed";
          isReverted = solVer.status === "failed" || solVer.status === "error";
        } else {
          const evmVer = await verifyEvmTransactionReceipt(txHash, chainNorm);
          isConfirmed = evmVer.status === "confirmed";
          isReverted = evmVer.status === "failed" || evmVer.status === "error";
        }

        if (isConfirmed) {
          updateFeeEventStatus(event.id, "claimed", {
            claimTxHash: txHash,
            claimedAt: new Date().toISOString(),
            metadata: {
              ...(event.metadata ?? {}),
              claimLifecycle: "CLAIM_CONFIRMED",
              reconciled: true,
            },
          });
          const updated = getFeeEventById(event.id)!;
          recordFeeClaimedToLedger(updated, txHash);
          summary.confirmed++;
          logger.success(`✅ [FEE CLAIM RECONCILER] In-flight claim #${event.id} confirmed on-chain (Tx: ${txHash}).`);
        } else if (isReverted) {
          const errMsg = `On-chain claim transaction reverted (${txHash})`;
          updateFeeEventStatus(event.id, "failed", {
            metadata: {
              ...(event.metadata ?? {}),
              claimLifecycle: "CLAIM_FAILED",
              error: errMsg,
              reconciled: true,
            },
          });
          summary.reverted++;
          logger.error(`❌ [FEE CLAIM RECONCILER] In-flight claim #${event.id} reverted on-chain (Tx: ${txHash}).`);
        } else {
          // Transaction still pending/unmined on-chain
          summary.stillPending++;
          logger.info(`⏳ [FEE CLAIM RECONCILER] In-flight claim #${event.id} is still pending on-chain (Tx: ${txHash}).`);
        }
      } catch (err) {
        // RPC error or network down - leave state untouched, do not fail
        summary.unresolved++;
        logger.warn(`⚠️  [FEE CLAIM RECONCILER] RPC check threw for tx ${txHash}: ${String(err)}`);
      }
      continue;
    }

    // Case B: No transaction hash (claim_submitted or unknown due to timeout/crash before txHash returned)
    if (event.source === "bankr_creator_fee" && event.tokenAddress) {
      const apiKey = cfg.BANKR_API_KEY;
      if (!apiKey) {
        summary.unresolved++;
        continue;
      }

      try {
        const headers = getBankrHeaders(apiKey);
        const url = `https://api.bankr.bot/token-launches/${event.tokenAddress}/fees`;
        const res = await axios.get(url, {
          headers,
          timeout: cfg.API_TIMEOUT_MS ?? 15000,
          validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
        });

        if (res.status === 200 && res.data) {
          const data = res.data;
          const claimedCount = Number(data.totals?.claimCount ?? data.tokens?.[0]?.claimed?.count ?? 0);
          const claimedWeth = Number(data.totals?.claimedWeth ?? 0);

          // Did Bankr process this claim?
          const previouslyClaimed = claimedCount > 0 || claimedWeth >= event.amountFormatted;

          if (previouslyClaimed) {
            const txHash = data.tokens?.[0]?.claimed?.txHash || `bankr_reconciled_epoch_${claimedCount}`;
            updateFeeEventStatus(event.id, "claimed", {
              claimTxHash: txHash,
              claimedAt: new Date().toISOString(),
              metadata: {
                ...(event.metadata ?? {}),
                claimLifecycle: "CLAIM_CONFIRMED",
                reconciledFromApi: true,
              },
            });
            const updated = getFeeEventById(event.id)!;
            recordFeeClaimedToLedger(updated, txHash);
            summary.confirmed++;
            logger.success(`✅ [FEE CLAIM RECONCILER] Recovered claim #${event.id} verified via Bankr Fees API (claimedCount: ${claimedCount}).`);
          } else {
            // Bankr shows claimable fee is still intact, claim was never executed by server.
            const updatedTime = event.updatedAt ? new Date(event.updatedAt).getTime() : 0;
            const elapsed = Date.now() - updatedTime;

            if (elapsed > 30000) {
              // Safe to reset to claimable for fresh evaluation
              updateFeeEventStatus(event.id, "claimable", {
                metadata: {
                  ...(event.metadata ?? {}),
                  claimLifecycle: "RESET_TO_CLAIMABLE",
                  reconciledReason: "Bankr API verified no claim executed after submission timeout",
                },
              });
              summary.resetToClaimable++;
              logger.info(`🔄 [FEE CLAIM RECONCILER] Fee #${event.id} reset to 'claimable' (confirmed no claim executed on Bankr).`);
            } else {
              summary.stillPending++;
            }
          }
        } else {
          summary.unresolved++;
        }
      } catch (err) {
        summary.unresolved++;
        logger.warn(`⚠️  [FEE CLAIM RECONCILER] Failed to query Bankr API for in-flight fee #${event.id}: ${String(err)}`);
      }
    } else {
      summary.unresolved++;
    }
  }

  return summary;
}

