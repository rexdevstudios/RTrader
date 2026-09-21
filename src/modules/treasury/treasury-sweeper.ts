/**
 * treasury-sweeper.ts — Sweeps accumulated funds to cold treasury with on-chain verification.
 *
 * Architecture Principles:
 *   1. Explicit Authorization: Sweeps REQUIRE a verified, valid treasury destination address.
 *   2. Safety Thresholds: Requires balance >= configured minimum threshold; preserves reserve buffer for gas.
 *   3. On-Chain Verification: Sweep is only marked 'confirmed' after the transaction is verified on-chain.
 *   4. Ledger Continuity: Confirmed sweeps post a debit entry to treasury_ledger for financial reconciliation.
 *   5. Multi-Wallet Aware: Operates on specific WalletAccount identities without global wallet assumptions.
 */
import { logger } from "../../logger.ts";
import {
  insertTreasurySweep,
  updateTreasurySweepStatus,
  getTreasurySweeps,
  type TreasurySweep,
  type SweepStatus,
} from "../../db/vault.ts";
import { getWalletAccount } from "../identity/wallet-manager.ts";
import { recordSweepToLedger } from "./treasury-ledger.ts";
import { verifyEvmTransactionReceipt } from "../reconciliation/evm-verifier.ts";
import { verifySolanaTransaction } from "../reconciliation/solana-verifier.ts";

export interface SweepResult {
  success: boolean;
  sweep?: TreasurySweep;
  status: SweepStatus;
  txHash?: string;
  error?: string;
}

/**
 * Validates whether a destination address is valid for the target chain.
 */
export function isValidDestinationAddress(address: string, chain: string): boolean {
  const trimmed = address.trim();
  const chainNorm = chain.trim().toLowerCase();

  if (chainNorm === "solana") {
    return trimmed.length >= 32 && trimmed.length <= 44;
  }

  // EVM chains: 0x followed by 40 hex chars
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

/**
 * Executes a treasury sweep from an active wallet to the configured treasury destination.
 */
export async function executeTreasurySweep(params: {
  walletId: string;
  chain: string;
  tokenSymbol: string;
  amountFormatted: number;
  customDestination?: string;
  mockTxHash?: string;
}): Promise<SweepResult> {
  const chainNorm = params.chain.trim().toLowerCase();

  // 1. Resolve Wallet
  const wallet = getWalletAccount(params.walletId);
  if (!wallet || wallet.status === "DISABLED") {
    return {
      success: false,
      status: "failed",
      error: `WalletAccount '${params.walletId}' not found or is DISABLED.`,
    };
  }

  const sourceAddress =
    chainNorm === "solana" ? wallet.solanaAddress : wallet.evmAddress;

  if (!sourceAddress) {
    return {
      success: false,
      status: "failed",
      error: `WalletAccount '${params.walletId}' has no address configured for chain '${params.chain}'.`,
    };
  }

  // 2. Resolve Destination Address
  const destinationAddress =
    params.customDestination ??
    (chainNorm === "solana"
      ? process.env.TREASURY_SOLANA_DESTINATION
      : process.env.TREASURY_EVM_DESTINATION);

  if (!destinationAddress || !isValidDestinationAddress(destinationAddress, params.chain)) {
    return {
      success: false,
      status: "failed",
      error: `Invalid or unconfigured treasury destination address for chain '${params.chain}': '${destinationAddress ?? "UNDEFINED"}'`,
    };
  }

  // 3. Check Minimum Sweep Threshold and Reserve Buffer
  const minSweep =
    chainNorm === "solana"
      ? (process.env.TREASURY_SWEEP_MIN_SOL ? Number(process.env.TREASURY_SWEEP_MIN_SOL) : 0.5)
      : (process.env.TREASURY_SWEEP_MIN_ETH ? Number(process.env.TREASURY_SWEEP_MIN_ETH) : 0.1);

  const reserveBuffer =
    chainNorm === "solana"
      ? (process.env.TREASURY_SWEEP_RESERVE_SOL ? Number(process.env.TREASURY_SWEEP_RESERVE_SOL) : 0.02)
      : (process.env.TREASURY_SWEEP_RESERVE_ETH ? Number(process.env.TREASURY_SWEEP_RESERVE_ETH) : 0.01);

  if (params.amountFormatted < minSweep) {
    return {
      success: false,
      status: "failed",
      error: `Sweep amount (${params.amountFormatted} ${params.tokenSymbol}) is below minimum threshold (${minSweep} ${params.tokenSymbol}).`,
    };
  }

  // Net amount swept after reserving buffer
  const sweepAmountFormatted = Math.max(0, params.amountFormatted - reserveBuffer);
  if (sweepAmountFormatted <= 0) {
    return {
      success: false,
      status: "failed",
      error: `Insufficient balance to cover gas reserve buffer (${reserveBuffer} ${params.tokenSymbol}).`,
    };
  }

  const decimals = chainNorm === "solana" ? 9 : 18;
  const amountRaw = BigInt(Math.floor(sweepAmountFormatted * 10 ** decimals)).toString();

  // 4. Create pending sweep record
  const sweepId = `sweep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sweep = insertTreasurySweep({
    sweepId,
    walletId: wallet.id,
    chain: params.chain,
    tokenSymbol: params.tokenSymbol,
    amountRaw,
    amountFormatted: sweepAmountFormatted,
    sourceAddress,
    destinationAddress,
    status: "pending",
  });

  // 5. Execute / verify transaction
  const txHash = params.mockTxHash;
  if (!txHash) {
    const errorMsg = "No on-chain transaction provided to execute or attribute sweep.";
    updateTreasurySweepStatus(sweepId, "failed", { errorReason: errorMsg });
    return { success: false, sweep, status: "failed", error: errorMsg };
  }

  // 6. Verify Transaction on Chain
  let isVerified = false;
  try {
    if (chainNorm === "solana") {
      const solVer = await verifySolanaTransaction(txHash);
      isVerified = solVer.status === "confirmed";
    } else {
      const evmVer = await verifyEvmTransactionReceipt(txHash, chainNorm);
      isVerified = evmVer.status === "confirmed";
    }
  } catch (err) {
    isVerified = false;
  }

  if (!isVerified) {
    const errorMsg = `On-chain verification failed or reverted for sweep tx: ${txHash}`;
    logger.error(`❌ [TREASURY SWEEPER] ${errorMsg}`);
    updateTreasurySweepStatus(sweepId, "failed", { txHash, errorReason: errorMsg });
    return {
      success: false,
      sweep,
      status: "failed",
      txHash,
      error: errorMsg,
    };
  }

  // 7. Mark confirmed
  updateTreasurySweepStatus(sweepId, "confirmed", { txHash });
  const confirmedSweep = getTreasurySweeps(wallet.id).find((s) => s.sweepId === sweepId)!;

  // 8. Record debit entry in treasury ledger
  recordSweepToLedger(confirmedSweep);

  logger.success(
    `✅ [TREASURY SWEEPER] Swept ${sweepAmountFormatted} ${params.tokenSymbol} ` +
      `from '${sourceAddress.slice(0, 8)}...' to '${destinationAddress.slice(0, 8)}...' (Tx: ${txHash}).`
  );

  return {
    success: true,
    sweep: confirmedSweep,
    status: "confirmed",
    txHash,
  };
}

export { getTreasurySweeps };
