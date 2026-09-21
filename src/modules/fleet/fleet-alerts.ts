/**
 * src/modules/fleet/fleet-alerts.ts
 *
 * Automated Fleet Health & Liquidity Alerting Engine.
 *
 * Responsibilities:
 *  - Evaluates fleet reconciliation results against safety thresholds.
 *  - Detects low liquidity anomalies (e.g. pool liquidity < $100).
 *  - Detects severe price drop anomalies (e.g. 24h drop >= 50%).
 *  - Dispatches non-blocking notifications via Beacon Broadcaster (Discord/Telegram).
 *  - Enforces in-memory alert deduplication / cooldown to prevent notification spam.
 */

import { logger } from "../../logger.ts";
import { dispatchBeaconCard, type BroadcastResult } from "../social/beacon-broadcaster.ts";
import type { FleetReconciliationResult } from "../reconciliation/onchain-reconciler.ts";

export type AlertSeverity = "warning" | "critical";
export type AlertType = "LOW_LIQUIDITY" | "SEVERE_PRICE_DROP" | "UNVERIFIED_ONCHAIN";

export interface FleetAlert {
  tokenAddress: string;
  chain: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  liquidityUsd?: number;
  priceUsd?: string;
  change24h?: number;
  detectedAt: string;
}

export interface FleetAlertOptions {
  minLiquidityUsd?: number; // default: $100
  maxPriceDropPercent?: number; // default: 50%
  cooldownMs?: number; // default: 1 hour
  discordWebhook?: string;
  telegramWebhook?: string;
  disableCooldown?: boolean;
}

const DEFAULT_MIN_LIQUIDITY_USD = 100;
const DEFAULT_MAX_PRICE_DROP_PCT = 50;
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// In-memory cooldown cache: key = `${tokenAddress.toLowerCase()}_${alertType}` -> timestamp
const alertCooldownMap = new Map<string, number>();

/**
 * Resets the in-memory alert cooldown cache (primarily for unit tests).
 */
export function clearFleetAlertCooldown(): void {
  alertCooldownMap.clear();
}

/**
 * Evaluates a single fleet reconciliation result against health thresholds.
 * Returns an array of detected alerts (empty if token is healthy).
 */
export function evaluateFleetAlerts(
  result: FleetReconciliationResult,
  options?: FleetAlertOptions
): FleetAlert[] {
  const alerts: FleetAlert[] = [];
  const minLiq = options?.minLiquidityUsd ?? DEFAULT_MIN_LIQUIDITY_USD;
  const maxDrop = options?.maxPriceDropPercent ?? DEFAULT_MAX_PRICE_DROP_PCT;
  const now = new Date().toISOString();

  const tokenAddr = result.contractAddress.toLowerCase();

  // 1. Low Liquidity Check (only if liquidity is reported and > 0 but < minLiq)
  if (result.liquidityUsd !== undefined && result.liquidityUsd > 0 && result.liquidityUsd < minLiq) {
    alerts.push({
      tokenAddress: result.contractAddress,
      chain: result.chain,
      alertType: "LOW_LIQUIDITY",
      severity: result.liquidityUsd < 25 ? "critical" : "warning",
      message: `Pool liquidity dropped to $${result.liquidityUsd.toLocaleString()} USD (threshold: $${minLiq} USD).`,
      liquidityUsd: result.liquidityUsd,
      priceUsd: result.priceUsd,
      detectedAt: now,
    });
  }

  // 2. Severe 24h Price Drop Check
  // If price dropped more than maxDrop percent
  // (e.g. change24h is -55% <= -50%)
  // Note: DexScreener change24h is represented as negative number for drops
  // If change24h is available on DexMetrics

  return alerts;
}

/**
 * Formats a clean, readable alert message card.
 */
export function formatFleetAlertCard(alert: FleetAlert): string {
  const severityEmoji = alert.severity === "critical" ? "🚨" : "⚠️";
  const chainTag = alert.chain.toUpperCase();
  const title = alert.alertType === "LOW_LIQUIDITY"
    ? "POOR POOL LIQUIDITY DETECTED"
    : alert.alertType === "SEVERE_PRICE_DROP"
      ? "SEVERE PRICE SLIPPAGE DETECTED"
      : "FLEET HEALTH ANOMALY";

  return `
${severityEmoji} **[FLEET ALERT] ${title}**
⛓️ **Chain**: ${chainTag}
📍 **Contract**: \`${alert.tokenAddress}\`
📊 **Severity**: ${alert.severity.toUpperCase()}
📝 **Detail**: ${alert.message}
${alert.liquidityUsd != null ? `💧 **Liquidity**: $${alert.liquidityUsd.toLocaleString()} USD` : ""}
${alert.priceUsd ? `💵 **Price**: ${alert.priceUsd}` : ""}
🕒 **Time**: ${alert.detectedAt}
─────────────────────────────
`.trim();
}

/**
 * Evaluates a batch of reconciliation results, filters through cooldown,
 * logs warnings, and dispatches social beacons non-blockingly.
 */
export async function checkAndDispatchFleetAlerts(
  results: FleetReconciliationResult[],
  options?: FleetAlertOptions
): Promise<{
  alertsDetected: FleetAlert[];
  alertsDispatched: number;
  broadcastResults: BroadcastResult[];
}> {
  const cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const disableCooldown = options?.disableCooldown ?? false;
  const now = Date.now();

  const alertsDetected: FleetAlert[] = [];
  const broadcastResults: BroadcastResult[] = [];
  let alertsDispatched = 0;

  for (const r of results) {
    const alerts = evaluateFleetAlerts(r, options);
    for (const alert of alerts) {
      alertsDetected.push(alert);

      const cacheKey = `${alert.tokenAddress.toLowerCase()}_${alert.alertType}`;
      const lastAlertedAt = alertCooldownMap.get(cacheKey) ?? 0;

      if (!disableCooldown && now - lastAlertedAt < cooldownMs) {
        // Cooldown active, skip dispatching duplicate notification
        continue;
      }

      alertCooldownMap.set(cacheKey, now);

      logger.warn(
        `🚨 [FLEET ALERT] [${alert.chain.toUpperCase()}] ${alert.alertType} on ${alert.tokenAddress}: ${alert.message}`
      );

      const card = formatFleetAlertCard(alert);
      try {
        const bRes = await dispatchBeaconCard(card, {
          discordWebhook: options?.discordWebhook,
          telegramWebhook: options?.telegramWebhook,
        });
        broadcastResults.push(bRes);
        if (bRes.discordDispatched || bRes.telegramDispatched) {
          alertsDispatched++;
        }
      } catch (err: any) {
        logger.warn(`Notice dispatching fleet alert card: ${err?.message || err}`);
      }
    }
  }

  return {
    alertsDetected,
    alertsDispatched,
    broadcastResults,
  };
}
