#!/usr/bin/env bun
/**
 * scripts/reconcile-fleet.ts — Background Fleet Reconciliation Worker
 *
 * Scans active token fleet across Base and Solana, verifies on-chain existence,
 * fetches DEX pool and liquidity metadata, and idempotently reconciles vault records.
 *
 * STRICT INVARIANTS:
 *  - Read-only against blockchain: performs ZERO mutating transactions or fee spends.
 *  - Concurrency safe: protected by SQLite system_locks ("reconcile_fleet_worker").
 *  - Non-blocking: DexScreener failures never throw or freeze the worker loop.
 *  - Supports both one-shot (CLI single-pass) and daemon mode (--daemon <minutes>).
 */

import * as dotenv from "dotenv";
dotenv.config();

import { logger } from "../src/logger.ts";
import { acquireLock, releaseLock } from "../src/db/vault.ts";
import {
  reconcileFleetArmada,
  type FleetReconciliationResult,
} from "../src/modules/reconciliation/onchain-reconciler.ts";
import { getProductionFleet } from "../src/modules/fleet/fleet-registry.ts";
import { checkAndDispatchFleetAlerts } from "../src/modules/fleet/fleet-alerts.ts";

export interface ReconcileArgs {
  isDaemon: boolean;
  intervalMinutes: number;
  limit: number;
  fetchDex: boolean;
}

export function parseReconcileArgs(argv: string[]): ReconcileArgs {
  let isDaemon = false;
  let intervalMinutes = 5;
  let limit = 50;
  let fetchDex = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--daemon" || arg === "-d") {
      isDaemon = true;
      const next = argv[i + 1];
      if (next && !isNaN(Number(next))) {
        intervalMinutes = Math.max(1, parseInt(next, 10));
        i++;
      }
    } else if (arg.startsWith("--interval=")) {
      const val = parseInt(arg.split("=")[1], 10);
      if (!isNaN(val)) intervalMinutes = Math.max(1, val);
    } else if (arg === "--limit" || arg === "-l") {
      const next = argv[i + 1];
      if (next && !isNaN(Number(next))) {
        limit = Math.max(1, parseInt(next, 10));
        i++;
      }
    } else if (arg === "--no-dex") {
      fetchDex = false;
    }
  }

  return { isDaemon, intervalMinutes, limit, fetchDex };
}

export async function runFleetReconcilePass(options?: {
  limit?: number;
  fetchDex?: boolean;
}): Promise<{
  totalFleet: number;
  reconciledCount: number;
  results: FleetReconciliationResult[];
}> {
  const lockKey = "reconcile_fleet_worker";
  const lockAcquired = acquireLock(lockKey, 300, "reconcile_worker");

  if (!lockAcquired) {
    logger.warn("⚠️  [LOCK] Reconcile fleet worker is already running in another process. Skipping iteration.");
    return { totalFleet: 0, reconciledCount: 0, results: [] };
  }

  try {
    const fleet = getProductionFleet();
    const totalFleet = fleet.all.length;

    console.log(`
=================================================================
  [+] OMNICHAIN FLEET ON-CHAIN RECONCILIATION WORKER [+]
=================================================================
  Total Monitored Fleet : ${totalFleet} token(s) (${fleet.live.length} live on-chain, ${fleet.simulated.length} simulated)
  Scan Mode             : READ-ONLY (Zero on-chain gas expenditure)
=================================================================
`);

    logger.info(`🔍 [RECONCILE] Running on-chain & DEX audit for up to ${options?.limit ?? 50} token(s)...`);

    const results = await reconcileFleetArmada({
      limit: options?.limit ?? 50,
      fetchDex: options?.fetchDex ?? true,
    });

    let updatedPools = 0;
    let promotedLifecycle = 0;

    console.log("-----------------------------------------------------------------");
    console.log("  RECONCILIATION AUDIT RESULTS");
    console.log("-----------------------------------------------------------------");

    for (const r of results) {
      if (r.poolUpdated) updatedPools++;
      if (r.lifecycleUpdated) promotedLifecycle++;

      const statusBadge = r.onChainVerified ? "✅ VERIFIED" : "⚠️ UNVERIFIED";
      const poolDisplay = r.poolId ? r.poolId.slice(0, 14) + "..." : "No Pool";
      const priceDisplay = r.priceUsd ? `$${Number(r.priceUsd).toFixed(6)}` : "Pending";
      const liqDisplay = r.liquidityUsd != null ? `$${r.liquidityUsd.toLocaleString()}` : "N/A";

      console.log(
        `  ${statusBadge} [${r.chain.toUpperCase()}] ${r.contractAddress.slice(0, 10)}... | ` +
        `Pool: ${poolDisplay} | Price: ${priceDisplay} | Liq: ${liqDisplay} | State: ${r.lifecycleState}`
      );
    }

    console.log("-----------------------------------------------------------------");
    console.log(`  Summary: ${results.length} tokens checked | ${updatedPools} pool(s) updated | ${promotedLifecycle} promoted`);

    // Automated Fleet Health & Liquidity Alerting
    try {
      const alertSummary = await checkAndDispatchFleetAlerts(results);
      if (alertSummary.alertsDetected.length > 0) {
        console.log(`  Alerts : ⚠️ ${alertSummary.alertsDetected.length} liquidity/health anomaly detected (${alertSummary.alertsDispatched} notifications sent)`);
      }
    } catch (aErr: any) {
      logger.warn(`Notice running fleet health alerts: ${aErr?.message || aErr}`);
    }

    console.log("=================================================================\n");

    return {
      totalFleet,
      reconciledCount: results.length,
      results,
    };
  } finally {
    releaseLock(lockKey);
  }
}

export async function runFleetReconcileDaemon(
  intervalMinutes = 5,
  options?: { limit?: number; fetchDex?: boolean }
): Promise<void> {
  let isRunning = true;
  let iteration = 0;

  const handleShutdown = () => {
    if (!isRunning) return;
    logger.info("\n[WORKER] Graceful shutdown signal received. Stopping fleet reconciliation daemon...");
    isRunning = false;
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  logger.info(`[DAEMON] Starting Autonomous Fleet Reconciliation Daemon (Interval: ${intervalMinutes} min)...`);
  logger.info(`[DAEMON] Press CTRL+C at any time to shut down cleanly.`);

  while (isRunning) {
    iteration++;
    const cycleTime = new Date().toISOString().slice(11, 19);
    logger.info(`\n=== [FLEET RECONCILE RUN #${iteration} @ ${cycleTime} UTC] ===`);

    try {
      await runFleetReconcilePass(options);
    } catch (err: any) {
      logger.error(`[DAEMON] Reconcile run error: ${err?.message || err}`);
    }

    if (!isRunning) break;

    const sleepSeconds = intervalMinutes * 60;
    const nextTime = new Date(Date.now() + sleepSeconds * 1000).toISOString().slice(11, 19);
    logger.info(`[DAEMON] Next reconciliation at ${nextTime} UTC (${intervalMinutes} min). Standing by...`);

    for (let s = 0; s < sleepSeconds; s++) {
      if (!isRunning) break;
      await Bun.sleep(1000);
    }
  }

  logger.info("[DAEMON] Fleet reconciliation daemon stopped gracefully. Done.");
}

if (import.meta.main) {
  const args = parseReconcileArgs(process.argv.slice(2));

  if (args.isDaemon) {
    runFleetReconcileDaemon(args.intervalMinutes, { limit: args.limit, fetchDex: args.fetchDex })
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(`Reconcile daemon fatal error: ${err?.message || err}`);
        process.exit(1);
      });
  } else {
    runFleetReconcilePass({ limit: args.limit, fetchDex: args.fetchDex })
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(`Reconcile single-pass fatal error: ${err?.message || err}`);
        process.exit(1);
      });
  }
}
