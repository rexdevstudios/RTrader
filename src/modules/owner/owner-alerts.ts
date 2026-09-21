/**
 * owner-alerts.ts — V2.3 Owner Operations: Operational Notifications
 *
 * V2.3 delivery: log-only (stdout/logger). No Telegram/webhook.
 * Reads state from existing tables — no new event system.
 * Reports factual system state. No artificial urgency.
 *
 * Deduplication:
 *   In-memory Set keyed by (eventType, JSON.stringify(context)).
 *   Each unique system-state event is emitted at most once per process lifetime.
 *   On process restart the Set is cleared — already-alerted events may be re-emitted once.
 *   This is intentional and documented: persistent deduplication requires a DB table (V2.4+ scope).
 *
 * Fee status vocabulary (per V2.3 spec):
 *   detected | claimable | claimed | swept | unavailable | not_verified
 *   Provider fee adapters remain at boundary — not presented as confirmed.
 */
import { logger } from "../../logger.ts";
import {
  getPositionsByStatus,
  getClosedPositions,
  getFeeEvents,
  getTreasurySweeps,
  getAllDeployLogs,
} from "../../db/vault.ts";

// ─── Alert Types ──────────────────────────────────────────────

export type AlertEventType =
  | "deployment_confirmed"
  | "deployment_failed"
  | "position_opened"
  | "position_closed"
  | "transaction_unresolved"
  | "pnl_finalized"
  | "pnl_pending"
  | "fee_detected"
  | "fee_claimed"
  | "sweep_confirmed"
  | "sweep_failed";

export interface Alert {
  eventType: AlertEventType;
  message: string;
  context: Record<string, unknown>;
  detectedAt: string;
}

export interface AlertSummary {
  newAlerts: number;       // Alerts emitted this cycle (not previously seen)
  total: number;           // Alias for newAlerts (backward compat with tests)
  alerts: Alert[];         // Only newly emitted alerts
  checkTimestamp: string;
}

// ─── Alert State Tracking (in-memory, resets on restart) ──────
// Deduplication key: "eventType::JSON.stringify(context)"
// This key is stable for the same event state regardless of when it fires.
// On process restart all events may fire once more — this is the documented
// trade-off of in-memory dedup. Persistent dedup is out of V2.3 scope.

const emittedAlertKeys = new Set<string>();

function makeKey(eventType: string, context: Record<string, unknown>): string {
  return `${eventType}::${JSON.stringify(context)}`;
}

/**
 * Attempts to emit an alert. Returns true if this is a new (not-yet-seen) alert,
 * false if already emitted this session.
 */
function tryEmit(alert: Alert): boolean {
  const key = makeKey(alert.eventType, alert.context);
  if (emittedAlertKeys.has(key)) return false;
  emittedAlertKeys.add(key);

  switch (alert.eventType) {
    case "deployment_confirmed":
    case "position_opened":
    case "pnl_finalized":
    case "fee_claimed":
    case "sweep_confirmed":
      logger.success(`🔔 [ALERT] ${alert.message}`);
      break;
    case "deployment_failed":
    case "transaction_unresolved":
    case "sweep_failed":
      logger.warn(`🔔 [ALERT] ${alert.message}`);
      break;
    default:
      logger.info(`🔔 [ALERT] ${alert.message}`);
  }
  return true;
}

// ─── Alert Candidate Builders ─────────────────────────────────
// These functions return ALL matching candidates from current DB state.
// Deduplication is handled by tryEmit() — not here.

function buildDeploymentAlerts(): Alert[] {
  const alerts: Alert[] = [];
  const deploys = getAllDeployLogs({ limit: 50 });
  const now = new Date().toISOString();

  for (const d of deploys) {
    if (d.status === "success" && d.lifecycleState === "DEPLOY_CONFIRMED") {
      alerts.push({
        eventType: "deployment_confirmed",
        message: `Deployment confirmed: $${d.ticker} on ${d.chain} (contract: ${d.contractAddr ?? "pending"})`,
        context: { deployId: d.id, ticker: d.ticker, chain: d.chain, walletId: d.walletId },
        detectedAt: now,
      });
    }
    if (d.status === "failed") {
      alerts.push({
        eventType: "deployment_failed",
        message: `Deployment failed: $${d.ticker} on ${d.chain}. Error: ${d.errorMsg ?? "unknown"}`,
        context: { deployId: d.id, ticker: d.ticker, chain: d.chain, walletId: d.walletId, error: d.errorMsg },
        detectedAt: now,
      });
    }
  }
  return alerts;
}

function buildPositionAlerts(): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  // Opened positions
  for (const p of getPositionsByStatus(["open"])) {
    alerts.push({
      eventType: "position_opened",
      message: `Position opened: $${p.ticker} on ${p.chain} (${p.attributionStatus ?? "unresolved"} attribution)`,
      context: { contractAddr: p.contractAddr, ticker: p.ticker, chain: p.chain, walletId: p.walletId },
      detectedAt: now,
    });
  }

  // Recently closed positions (within 24h)
  for (const p of getClosedPositions()) {
    if (!p.closedAt) continue;
    if (Date.now() - new Date(p.closedAt).getTime() > 24 * 60 * 60 * 1000) continue;
    alerts.push({
      eventType: "position_closed",
      message: `Position closed: $${p.ticker} on ${p.chain} via ${p.exitReason ?? "unknown"}. PnL: ${
        p.pnlStatus === "calculated" ? `${(p.realizedPnl ?? 0).toFixed(6)}` : "pending"
      }`,
      context: { contractAddr: p.contractAddr, ticker: p.ticker, exitReason: p.exitReason, pnlStatus: p.pnlStatus, realizedPnl: p.realizedPnl },
      detectedAt: now,
    });
  }

  // Unresolved transactions — only genuinely unresolved.
  // 'pending' is the normal initial reconciliation_status for every new position,
  // so it is NOT included here to avoid false positives.
  for (const p of getPositionsByStatus(["buy_submitted", "closing"]).filter(
    p => p.reconciliationStatus === "unresolved" || p.attributionStatus === "unresolved"
  )) {
    alerts.push({
      eventType: "transaction_unresolved",
      message: `Transaction unresolved: $${p.ticker} on ${p.chain} — status '${p.status}', reconciliation: ${p.reconciliationStatus ?? "pending"}`,
      context: { contractAddr: p.contractAddr, ticker: p.ticker, status: p.status, reconciliationStatus: p.reconciliationStatus },
      detectedAt: now,
    });
  }

  return alerts;
}

function buildPnlAlerts(): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  for (const p of getClosedPositions()) {
    // pnl_finalized: only when pnl_status === 'calculated' AND realizedPnl is confirmed present
    // Never use price_return_percent as monetary PnL
    if (p.pnlStatus === "calculated" && p.realizedPnl != null) {
      alerts.push({
        eventType: "pnl_finalized",
        message: `PnL finalized: $${p.ticker} ${p.realizedPnl >= 0 ? "+" : ""}${p.realizedPnl.toFixed(6)} (${p.chain})`,
        context: { contractAddr: p.contractAddr, ticker: p.ticker, realizedPnl: p.realizedPnl, chain: p.chain },
        detectedAt: now,
      });
    }
    // H3: BasedBot pnl_pending — reported as-is, never converted to realized PnL.
    // Alert only after >2h to avoid noise on fast-resolving cases.
    if (p.pnlStatus === "pnl_pending" && p.closedAt) {
      if (Date.now() - new Date(p.closedAt).getTime() > 2 * 60 * 60 * 1000) {
        alerts.push({
          eventType: "pnl_pending",
          message: `PnL pending >2h: $${p.ticker} on ${p.chain}. Attribution: ${p.attributionStatus ?? "unresolved"}. Proceeds not yet confirmed.`,
          context: { contractAddr: p.contractAddr, ticker: p.ticker, closedAt: p.closedAt, attributionStatus: p.attributionStatus },
          detectedAt: now,
        });
      }
    }
  }
  return alerts;
}

function buildFeeAlerts(): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  for (const f of getFeeEvents()) {
    if (f.status === "detected") {
      alerts.push({
        eventType: "fee_detected",
        message: `Fee detected: ${f.amountFormatted} ${f.tokenSymbol} via ${f.source} on ${f.chain} (wallet: ${f.walletId})`,
        context: { feeId: f.id, source: f.source, amount: f.amountFormatted, tokenSymbol: f.tokenSymbol, chain: f.chain, walletId: f.walletId },
        detectedAt: now,
      });
    }
    if (f.status === "claimed") {
      alerts.push({
        eventType: "fee_claimed",
        message: `Fee claimed: ${f.amountFormatted} ${f.tokenSymbol} on ${f.chain} (tx: ${f.claimTxHash ?? "pending"})`,
        context: { feeId: f.id, amount: f.amountFormatted, tokenSymbol: f.tokenSymbol, claimTxHash: f.claimTxHash },
        detectedAt: now,
      });
    }
  }
  return alerts;
}

function buildSweepAlerts(): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  for (const s of getTreasurySweeps()) {
    if (s.status === "confirmed") {
      alerts.push({
        eventType: "sweep_confirmed",
        message: `Treasury sweep confirmed: ${s.amountFormatted} ${s.tokenSymbol} on ${s.chain} → ${s.destinationAddress.slice(0, 10)}... (tx: ${s.txHash ?? "pending"})`,
        context: { sweepId: s.sweepId, amount: s.amountFormatted, tokenSymbol: s.tokenSymbol, txHash: s.txHash },
        detectedAt: now,
      });
    }
    if (s.status === "failed") {
      alerts.push({
        eventType: "sweep_failed",
        message: `Treasury sweep failed: ${s.amountFormatted} ${s.tokenSymbol} on ${s.chain}. Reason: ${s.errorReason ?? "unknown"}`,
        context: { sweepId: s.sweepId, amount: s.amountFormatted, errorReason: s.errorReason },
        detectedAt: now,
      });
    }
  }
  return alerts;
}

// ─── Main Alert Check ─────────────────────────────────────────

export function checkAndEmitAlerts(): AlertSummary {
  const checkTimestamp = new Date().toISOString();

  const candidates: Alert[] = [
    ...buildDeploymentAlerts(),
    ...buildPositionAlerts(),
    ...buildPnlAlerts(),
    ...buildFeeAlerts(),
    ...buildSweepAlerts(),
  ];

  // tryEmit returns true only for newly emitted (not-yet-seen) alerts
  const newAlerts = candidates.filter(alert => tryEmit(alert));

  return {
    newAlerts: newAlerts.length,
    total: newAlerts.length,
    alerts: newAlerts,
    checkTimestamp,
  };
}

/** Reset alert state — used in tests to clear deduplication cache */
export function resetAlertState(): void {
  emittedAlertKeys.clear();
}
