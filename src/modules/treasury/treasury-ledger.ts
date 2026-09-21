/**
 * treasury-ledger.ts — Immutable Treasury Ledger & Financial Accounting Record.
 *
 * Architecture Principles:
 *   1. Accounting Lineage: Wallet -> Fee Event -> Claim Transaction -> Treasury -> Realized PnL.
 *   2. Strict Audit Trail: Every balance change has a corresponding tx_hash and source reference.
 *   3. Double-Entry Directionality: Distinguishes 'credit' (inflow: fees, realized PnL) and 'debit' (outflow: sweeps).
 *   4. Strict Idempotency: All ledger insertions use unique entry_ids to prevent double-counting.
 *   5. Multi-Wallet Aware: Balances and entries are queryable by wallet_id or platform-wide.
 */
import {
  insertTreasuryLedgerEntry,
  getTreasuryLedgerEntries,
  getTreasurySummaryByWallet,
  type TreasuryLedgerEntry,
  type TreasuryLedgerInput,
  type TreasuryBalanceSummary,
  type FeeEvent,
  type ActivePosition,
  type TreasurySweep,
} from "../../db/vault.ts";
import { logger } from "../../logger.ts";

/**
 * Safely converts a float amount to a raw BigInt string representation with the given decimals.
 * Uses string manipulation instead of `Math.floor(n * 10**decimals)` to avoid IEEE-754 precision loss
 * when decimals > 15 (e.g., 10**18 exceeds Number.MAX_SAFE_INTEGER).
 *
 * Limits to 15 significant digits (JavaScript's reliable float precision) before padding.
 */
export function floatToRawBigIntString(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "0";
  if (amount === 0) return "0";

  // Use toPrecision(15) to get reliable significant digits, then parse
  const precise = amount.toPrecision(15); // e.g., 0.05 → "0.0500000000000000"
  const [intPart, fracPart = ""] = precise.split(".");
  // Pad or truncate fractional part to exact decimals length
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const raw = intPart + paddedFrac;
  // Remove leading zeros but keep at least "0"
  const trimmed = raw.replace(/^0+/, "") || "0";
  return trimmed;
}

/**
 * Posts a credit entry to the treasury ledger when a creator fee is verified claimed on-chain.
 */
export function recordFeeClaimedToLedger(
  feeEvent: FeeEvent,
  claimTxHash: string
): TreasuryLedgerEntry {
  const entryId = `tr_fee_${feeEvent.id}_claim`;

  const input: TreasuryLedgerInput = {
    entryId,
    walletId: feeEvent.walletId,
    chain: feeEvent.chain,
    eventType: "fee_claimed",
    tokenSymbol: feeEvent.tokenSymbol,
    amountRaw: feeEvent.amountRaw,
    amountFormatted: feeEvent.amountFormatted,
    direction: "credit",
    sourceRefType: "fee_event",
    sourceRefId: String(feeEvent.id),
    txHash: claimTxHash,
    beneficiaryAddress: feeEvent.beneficiaryAddress,
    status: "confirmed",
    reconciliationNotes: `Creator fee claimed from source '${feeEvent.source}' (event #${feeEvent.id})`,
  };

  const entry = insertTreasuryLedgerEntry(input);
  logger.success(
    `🏛️  [TREASURY LEDGER] Credited +${entry.amountFormatted} ${entry.tokenSymbol} ` +
      `to wallet '${entry.walletId}' (Tx: ${claimTxHash.slice(0, 10)}...). Entry: ${entry.entryId}`
  );
  return entry;
}

/**
 * Posts an entry to the treasury ledger when an active position is closed and its Realized PnL is calculated.
 *
 * Rules:
 *  - Only positions with pnlStatus 'calculated' are eligible (exact proceeds data available).
 *  - Positive PnL → credit (net trading earnings).
 *  - Negative PnL → debit (realized loss). Omitting losses would create profit-only accounting.
 *  - Zero PnL → no entry (no financial impact to record).
 */
export function recordRealizedPnlToLedger(
  position: ActivePosition
): TreasuryLedgerEntry | null {
  if (position.pnlStatus !== "calculated") {
    logger.warn(
      `⚠️  [TREASURY LEDGER] Position for $${position.ticker} cannot be posted to ledger: pnlStatus is '${position.pnlStatus}' (requires 'calculated').`
    );
    return null;
  }

  const pnl = position.realizedPnl ?? 0;
  if (pnl === 0) {
    logger.info(
      `ℹ️  [TREASURY LEDGER] Position for $${position.ticker} closed with zero PnL. No treasury entry required.`
    );
    return null;
  }

  const walletId = position.walletId ?? "default-operator";
  const chain = position.chain;
  const tokenSymbol = chain.toLowerCase() === "solana" ? "SOL" : "ETH";
  const entryId = `tr_pnl_${position.id}_close`;

  // Use absolute value for amount; direction indicates credit/debit
  const absPnl = Math.abs(pnl);
  const direction = pnl > 0 ? "credit" : "debit";

  // M2 FIX: Convert float to raw BigInt safely without IEEE-754 precision loss.
  // Using string manipulation instead of Math.floor(n * 10**18) which overflows Number.MAX_SAFE_INTEGER.
  const decimals = chain.toLowerCase() === "solana" ? 9 : 18;
  const amountRaw = floatToRawBigIntString(absPnl, decimals);

  const input: TreasuryLedgerInput = {
    entryId,
    walletId,
    chain,
    eventType: "realized_pnl_credited",
    tokenSymbol,
    amountRaw,
    amountFormatted: absPnl,
    direction: direction as "credit" | "debit",
    sourceRefType: "active_position",
    sourceRefId: String(position.id),
    txHash: position.sellTxHash ?? undefined,
    beneficiaryAddress: position.walletAddress ?? undefined,
    status: "confirmed",
    reconciliationNotes: `Realized PnL ${pnl > 0 ? "profit" : "loss"} from position #${position.id} ($${position.ticker}): ${pnl > 0 ? "+" : ""}${pnl.toFixed(6)}`,
  };

  const entry = insertTreasuryLedgerEntry(input);
  const symbol = pnl > 0 ? "+" : "-";
  logger.success(
    `🏛️  [TREASURY LEDGER] ${pnl > 0 ? "Credited" : "Debited"} ${symbol}${absPnl.toFixed(6)} ${entry.tokenSymbol} ` +
      `from $${position.ticker} to wallet '${walletId}'. Entry: ${entry.entryId}`
  );
  return entry;
}

/**
 * Posts a debit entry to the treasury ledger when a treasury sweep is confirmed on-chain.
 */
export function recordSweepToLedger(sweep: TreasurySweep): TreasuryLedgerEntry {
  const entryId = `tr_sweep_${sweep.sweepId}_debit`;

  const input: TreasuryLedgerInput = {
    entryId,
    walletId: sweep.walletId,
    chain: sweep.chain,
    eventType: "treasury_sweep",
    tokenSymbol: sweep.tokenSymbol,
    amountRaw: sweep.amountRaw,
    amountFormatted: sweep.amountFormatted,
    direction: "debit",
    sourceRefType: "treasury_sweep",
    sourceRefId: sweep.sweepId,
    txHash: sweep.txHash ?? undefined,
    beneficiaryAddress: sweep.sourceAddress,
    destinationAddress: sweep.destinationAddress,
    status: "confirmed",
    reconciliationNotes: `Sweep #${sweep.id} transferred to cold treasury '${sweep.destinationAddress}'`,
  };

  const entry = insertTreasuryLedgerEntry(input);
  logger.info(
    `🏛️  [TREASURY LEDGER] Debited -${entry.amountFormatted} ${entry.tokenSymbol} ` +
      `from wallet '${entry.walletId}' for sweep to '${sweep.destinationAddress}'. Entry: ${entry.entryId}`
  );
  return entry;
}

export interface GasSponsorshipRecordParams {
  deployLogId: number;
  chain: string;
  tokenSymbol: string;
  networkGasCostEth: number;
  relayerAddress: string;
  txHash: string;
  walletId?: string;
}

/**
 * Posts a gas sponsorship entry to the treasury ledger when a deployment transaction
 * is verified to be 100% gas-sponsored by the Bankr relayer.
 *
 * Rules:
 *  - Recorded as eventType: "gas_sponsorship", direction: "credit".
 *  - Tracked as operational cost savings (does NOT inflate withdrawable net treasury cash).
 *  - Strict idempotency via unique entryId `tr_sponsor_deploy_${deployLogId}`.
 */
export function recordGasSponsorshipToLedger(
  params: GasSponsorshipRecordParams
): TreasuryLedgerEntry {
  const entryId = `tr_sponsor_deploy_${params.deployLogId}`;
  const walletId = params.walletId ?? "default-operator";
  const decimals = 18;
  const amountRaw = floatToRawBigIntString(params.networkGasCostEth, decimals);

  const input: TreasuryLedgerInput = {
    entryId,
    walletId,
    chain: params.chain,
    eventType: "gas_sponsorship",
    tokenSymbol: params.tokenSymbol,
    amountRaw,
    amountFormatted: params.networkGasCostEth,
    direction: "credit",
    sourceRefType: "deploy_log",
    sourceRefId: String(params.deployLogId),
    txHash: params.txHash,
    beneficiaryAddress: params.relayerAddress,
    status: "confirmed",
    reconciliationNotes: `Gas sponsored 100% by Bankr relayer '${params.relayerAddress}' for deploy log #${params.deployLogId}. Saved ${params.networkGasCostEth.toFixed(6)} ${params.tokenSymbol}`,
  };

  const entry = insertTreasuryLedgerEntry(input);
  logger.success(
    `⛽ [TREASURY LEDGER] Recorded gas sponsorship: saved ${params.networkGasCostEth.toFixed(6)} ${entry.tokenSymbol} ` +
      `via relayer '${params.relayerAddress.slice(0, 10)}...' (Deploy #${params.deployLogId}). Entry: ${entry.entryId}`
  );
  return entry;
}

export {
  getTreasurySummaryByWallet,
  getTreasurySummaryByWallet as getTreasuryBalanceSummary,
  getTreasuryLedgerEntries,
};

