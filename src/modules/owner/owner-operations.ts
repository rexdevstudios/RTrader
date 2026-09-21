/**
 * owner-operations.ts — V2.3 Owner Operations: Manual Intervention Controls
 *
 * All operations:
 *   1. Validate pre-conditions using existing guards
 *   2. Execute through existing vault functions (no guard bypass)
 *   3. Record to intervention_logs (auditable)
 *   4. Return OperationResult with full context
 *
 * Confirmed scope (V2.3):
 *   - forceClosePosition: DB state-only (manual_closed). No on-chain tx fabrication.
 *   - pauseWallet / resumeWallet: Uses WalletAccount status via wallet-manager.ts
 *   - disableProviderRoute: Uses WalletProviderRoute status
 *   - retryUnresolved: Resets reconciliation_status to 'pending' for re-processing
 */
import { logger } from "../../logger.ts";
import {
  getPositionByContract,
  transitionPositionState,
  updatePositionReconciliation,
  logIntervention,
  type InterventionAction,
} from "../../db/vault.ts";
import {
  getWalletAccount,
  updateWalletStatus,
  updateProviderRouteStatus,
  getProviderRoute,
} from "../identity/wallet-manager.ts";


// ─── Result Types ─────────────────────────────────────────────

export interface OperationResult {
  success: boolean;
  action: InterventionAction;
  walletId?: string;
  contractAddr?: string;
  detail: string;
  timestamp: string;
  interventionId: number | null;
}

function recordAndReturn(
  action: InterventionAction,
  success: boolean,
  detail: string,
  opts: { walletId?: string; contractAddr?: string; deployLogId?: number }
): OperationResult {
  const requestedAt = new Date().toISOString();
  const log = logIntervention({
    action,
    initiatedBy: "owner",
    walletId: opts.walletId,
    contractAddr: opts.contractAddr,
    deployLogId: opts.deployLogId,
    requestedAt,
    result: success ? "success" : "rejected",
    resultDetail: detail,
  });

  if (success) {
    logger.success(`✅ [OWNER-OPS] ${action.toUpperCase()} — ${detail}`);
  } else {
    logger.warn(`⚠️  [OWNER-OPS] ${action.toUpperCase()} rejected — ${detail}`);
  }

  return {
    success,
    action,
    walletId: opts.walletId,
    contractAddr: opts.contractAddr,
    detail,
    timestamp: requestedAt,
    interventionId: log.id,
  };
}

// ─── Force Close Position ─────────────────────────────────────
/**
 * Administratively marks a position as 'manual_closed' in the database.
 *
 * Semantics:
 *   - DB state-only. No on-chain sell transaction is sent.
 *   - No sell tx hash, exit proceeds, or realized PnL are fabricated.
 *   - The position is treated as administratively closed.
 *   - The reconciler does NOT re-examine manual_closed positions (it only
 *     processes buy_submitted and closing). This is correct and intentional —
 *     there is no on-chain sell to verify.
 *   - reconciliation_status is set to 'pending' so that if the owner later
 *     uses retryUnresolved() the position state is clean for that path.
 */
export function forceClosePosition(contractAddr: string, reason: string): OperationResult {
  const pos = getPositionByContract(contractAddr);

  if (!pos) {
    return recordAndReturn("force_close", false, `Position not found: ${contractAddr}`, { contractAddr });
  }

  const closableStatuses = ["open", "closing", "buy_submitted"];
  if (!closableStatuses.includes(pos.status)) {
    return recordAndReturn(
      "force_close", false,
      `Position ${pos.ticker} is in non-closable status '${pos.status}'. No action taken.`,
      { contractAddr, walletId: pos.walletId ?? undefined, deployLogId: pos.deployLogId }
    );
  }

  // Transition to manual_closed — does NOT set exit proceeds, sell hash, or PnL.
  // Those require on-chain evidence which this operation does not produce.
  const transitioned = transitionPositionState(contractAddr, closableStatuses, "manual_closed", {
    exitReason: `manual_intervention: ${reason}`,
    closedAt: new Date().toISOString(),
    reconciliationStatus: "pending",
  });

  if (!transitioned) {
    return recordAndReturn(
      "force_close", false,
      `State transition failed for ${pos.ticker} (concurrent modification or guard rejection).`,
      { contractAddr, walletId: pos.walletId ?? undefined }
    );
  }

  return recordAndReturn(
    "force_close", true,
    `Position ${pos.ticker} (${contractAddr}) marked manual_closed. Reason: ${reason}. No on-chain tx sent. No PnL fabricated.`,
    { contractAddr, walletId: pos.walletId ?? undefined, deployLogId: pos.deployLogId }
  );
}

// ─── Pause / Resume Wallet ────────────────────────────────────

export function pauseWallet(walletId: string, reason: string): OperationResult {
  const wallet = getWalletAccount(walletId);

  if (!wallet) {
    return recordAndReturn("pause_wallet", false, `Wallet '${walletId}' not found.`, { walletId });
  }

  if (wallet.status === "PAUSED") {
    return recordAndReturn("pause_wallet", false, `Wallet '${walletId}' is already PAUSED.`, { walletId });
  }

  if (wallet.status === "DISABLED") {
    return recordAndReturn("pause_wallet", false, `Wallet '${walletId}' is DISABLED — cannot pause a disabled wallet.`, { walletId });
  }

  updateWalletStatus(walletId, "PAUSED");

  return recordAndReturn(
    "pause_wallet", true,
    `Wallet '${wallet.label}' paused. Reason: ${reason}. No new deployments or buys will be routed to this wallet.`,
    { walletId }
  );
}

export function resumeWallet(walletId: string, reason: string): OperationResult {
  const wallet = getWalletAccount(walletId);

  if (!wallet) {
    return recordAndReturn("resume_wallet", false, `Wallet '${walletId}' not found.`, { walletId });
  }

  if (wallet.status === "ACTIVE") {
    return recordAndReturn("resume_wallet", false, `Wallet '${walletId}' is already ACTIVE.`, { walletId });
  }

  if (wallet.status === "DISABLED") {
    return recordAndReturn("resume_wallet", false, `Wallet '${walletId}' is DISABLED — cannot resume a disabled wallet without admin action.`, { walletId });
  }

  updateWalletStatus(walletId, "ACTIVE");

  return recordAndReturn(
    "resume_wallet", true,
    `Wallet '${wallet.label}' resumed to ACTIVE. Reason: ${reason}.`,
    { walletId }
  );
}

// ─── Disable Provider Route ───────────────────────────────────

export function disableProviderRoute(walletId: string, provider: string, reason: string): OperationResult {
  const route = getProviderRoute(walletId, provider as any);

  if (!route) {
    return recordAndReturn(
      "disable_route", false,
      `Route not found: wallet '${walletId}' provider '${provider}'.`,
      { walletId }
    );
  }

  if (route.status === "DISABLED") {
    return recordAndReturn("disable_route", false, `Route ${provider} for wallet '${walletId}' is already DISABLED.`, { walletId });
  }

  updateProviderRouteStatus(walletId, provider as any, "DISABLED");

  return recordAndReturn(
    "disable_route", true,
    `Provider route '${provider}' for wallet '${walletId}' disabled. Reason: ${reason}.`,
    { walletId }
  );
}

// ─── Retry Unresolved ─────────────────────────────────────────
/**
 * Resets reconciliation_status to 'pending' so the reconciler re-processes
 * this position on its next cycle. Does not create new transactions.
 */
export function retryUnresolved(contractAddr: string, reason: string): OperationResult {
  const pos = getPositionByContract(contractAddr);

  if (!pos) {
    return recordAndReturn("retry_unresolved", false, `Position not found: ${contractAddr}`, { contractAddr });
  }

  const retryableStatuses = ["open", "buy_submitted", "closing"];
  if (!retryableStatuses.includes(pos.status)) {
    return recordAndReturn(
      "retry_unresolved", false,
      `Position ${pos.ticker} status '${pos.status}' is not retryable.`,
      { contractAddr, walletId: pos.walletId ?? undefined }
    );
  }

  // Reset reconciliation_status to 'pending' — reconciler picks it up next cycle
  updatePositionReconciliation(contractAddr, {
    reconciliationStatus: "pending",
    lastReconciledAt: new Date().toISOString(),
  });

  return recordAndReturn(
    "retry_unresolved", true,
    `Position ${pos.ticker} (${contractAddr}) queued for re-reconciliation. Reason: ${reason}.`,
    { contractAddr, walletId: pos.walletId ?? undefined, deployLogId: pos.deployLogId }
  );
}
