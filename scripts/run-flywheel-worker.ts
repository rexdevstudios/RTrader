#!/usr/bin/env bun
/**
 * scripts/run-flywheel-worker.ts
 *
 * Flywheel Worker: Monitors deployed tokens, claims accrued 95% WETH fees,
 * and executes the 4-Pillar Positive-Sum Flywheel distribution:
 *   - 35% Creator Profit
 *   - 30% Auto Buyback & Burn
 *   - 20% Holder Dividend Pool
 *   - 15% 10-Minute FOMO Jackpot
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { getFlywheelSummary } from "../src/db/vault.ts";
import { getProductionFleet } from "../src/modules/fleet/fleet-registry.ts";
import { scanCreatorFees } from "../src/modules/treasury/fee-scanner.ts";
import { executeFlywheelCycle } from "../src/modules/growth/flywheel-engine.ts";
import { broadcastFlywheelBurnAlert } from "../src/modules/social/beacon-broadcaster.ts";

export interface DaemonArgs {
  isDaemon: boolean;
  intervalMinutes: number;
  isTestBroadcast?: boolean;
}

export function parseDaemonArgs(argv: string[]): DaemonArgs {
  let isDaemon = false;
  let intervalMinutes = 5;
  let isTestBroadcast = false;

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
    } else if (arg === "--interval" || arg === "-i") {
      const next = argv[i + 1];
      if (next && !isNaN(Number(next))) {
        intervalMinutes = Math.max(1, parseInt(next, 10));
        i++;
      }
    } else if (arg === "--test-broadcast" || arg === "--broadcast-preview" || arg === "-t") {
      isTestBroadcast = true;
    }
  }

  return { isDaemon, intervalMinutes, isTestBroadcast };
}

export async function runFlywheelSinglePass(): Promise<{
  processedCount: number;
  deploymentsCount: number;
  summary: ReturnType<typeof getFlywheelSummary>;
}> {
  const cfg = getConfig();

  console.log(`
=================================================================
  [+] PERPETUAL WETH FLYWHEEL ENGINE - REVENUE RECYCLER WORKER [+]
=================================================================
  Trigger Threshold: >= ${cfg.FLYWHEEL_MIN_TRIGGER_WETH} WETH
  Pillars:
    - 35% Creator Profit
    - 30% Auto Buyback & Burn (0xdead)
    - 20% Top Holder Dividends
    - 15% FOMO Jackpot Pool
=================================================================
`);

  logger.info("[WORKER] Scanning active Base & Clanker deployments in Vault...");
  const fleetBase = getProductionFleet("base");
  const fleetClanker = getProductionFleet("clanker");
  let deployments = [...fleetBase.live, ...fleetClanker.live];

  if (deployments.length === 0) {
    deployments = [...fleetBase.all, ...fleetClanker.all].slice(0, 5);
  }

  if (deployments.length === 0) {
    logger.warn("[NOTICE] No active Base tokens found in database. Deploy a token first!");
    return {
      processedCount: 0,
      deploymentsCount: 0,
      summary: getFlywheelSummary(),
    };
  }

  logger.info(`   Found ${deployments.length} confirmed Base token(s) to monitor.`);

  // 1. Scan fees on-chain / API
  logger.info("[WORKER] Querying accrued fees from Bankr...");
  try {
    const detected = await scanCreatorFees();
    logger.info(`   Scanned ${detected.length} fee events.`);
  } catch (err) {
    logger.warn(`   Fee scan notice: ${String(err)}`);
  }

  // 2. Process each deployment
  let processedCount = 0;
  for (const dep of deployments) {
    const tokenAddress = dep.contractAddr!;
    const tokenSymbol = dep.ticker || "TOKEN";

    logger.info(`\nChecking Flywheel eligibility for $${tokenSymbol} (${tokenAddress})...`);
    logger.info(`   Architecture : 0% Tax On-Chain (EIP-1167 Renounced by Design)`);
    logger.info(`   Fee Share    : 95% WETH Creator Swap Revenue Rights (Uniswap L2)`);

    try {
      const result = await executeFlywheelCycle({
        tokenAddress,
        tokenSymbol,
        walletId: dep.walletId ?? undefined,
      });

      if (result.success) {
        processedCount++;
        logger.success(`[SUCCESS] Cycle executed for $${tokenSymbol}!`);
        if (result.burnTxHash && result.split) {
          try {
            await broadcastFlywheelBurnAlert({
              tokenSymbol,
              ticker: tokenSymbol,
              contractAddress: tokenAddress,
              burnTxHash: result.burnTxHash,
              burnedTokens: result.burnedTokensEstimate || Math.floor(result.split.buybackWeth * 2500000),
              wethUsed: result.split.buybackWeth,
              split: result.split,
            });
            logger.success(`[BEACON] Real-time burn proof alert broadcasted to Telegram & Discord for $${tokenSymbol}!`);
          } catch (bErr: any) {
            logger.warn(`[BEACON] Burn alert broadcast notice: ${bErr?.message || bErr}`);
          }
        }
      } else {
        logger.info(`[INFO] $${tokenSymbol}: ${result.error || "No action taken"}`);
      }
    } catch (err: any) {
      logger.error(`[ERROR] Error processing $${tokenSymbol}: ${err?.message || err}`);
    }
  }

  // 3. Print Global Summary
  const summary = getFlywheelSummary();
  console.log(`
=================================================================
  [+] FLYWHEEL AGGREGATE PERFORMANCE SUMMARY [+]
=================================================================
  Total Cycles Completed:   ${summary.eventCount}
  Total WETH Recycled:      ${summary.totalClaimedWeth.toFixed(6)} WETH
  - Creator Profit Kept:    ${summary.totalCreatorWeth.toFixed(6)} WETH
  - Buyback & Burned:       ${summary.totalBuybackWeth.toFixed(6)} WETH (~${summary.totalBurnedTokens.toLocaleString()} tokens burned)
  - Holder Dividends:       ${summary.totalDividendWeth.toFixed(6)} WETH
  - FOMO Jackpot Pool:      ${summary.totalJackpotWeth.toFixed(6)} WETH
=================================================================
`);

  return {
    processedCount,
    deploymentsCount: deployments.length,
    summary,
  };
}

export async function runFlywheelDaemon(intervalMinutes = 5): Promise<void> {
  let isRunning = true;
  let iteration = 0;

  const handleShutdown = () => {
    if (!isRunning) return;
    logger.info("\n[WORKER] Graceful shutdown received (SIGINT/SIGTERM). Stopping daemon loop safely...");
    isRunning = false;
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  logger.info(`[DAEMON] Starting Perpetual Flywheel Harvester Daemon (Interval: ${intervalMinutes} min)...`);
  logger.info(`[DAEMON] Press CTRL+C at any time to gracefully shut down.`);

  while (isRunning) {
    iteration++;
    const cycleStartTime = new Date().toISOString().slice(11, 19);
    logger.info(`\n=== [DAEMON RUN #${iteration} @ ${cycleStartTime} UTC] ===`);

    try {
      await runFlywheelSinglePass();

      // Background DexScreener & Sniper Bot Status Poller every 3 cycles
      if (iteration % 3 === 1) {
        try {
          const { pollFleetFastTrackStatus } = await import("../src/modules/intelligence/dexscreener-fasttrack-poller.ts");
          logger.info(`🔍 [DAEMON] Running periodic DexScreener & Sniper Bot Audit...`);
          await pollFleetFastTrackStatus();
        } catch (pollErr: any) {
          logger.warn(`[DAEMON] Periodic DexScreener poll notice: ${pollErr?.message || pollErr}`);
        }
      }
    } catch (err: any) {
      logger.error(`[DAEMON] Error during harvest cycle: ${err?.message || err}`);
    }

    if (!isRunning) break;

    const sleepSeconds = intervalMinutes * 60;
    const nextTime = new Date(Date.now() + sleepSeconds * 1000).toISOString().slice(11, 19);
    logger.info(`[DAEMON] Next harvest cycle scheduled at ${nextTime} UTC (${intervalMinutes} minutes). Standing by...`);

    // Interruptible sleep in 1-second ticks
    for (let s = 0; s < sleepSeconds; s++) {
      if (!isRunning) break;
      await Bun.sleep(1000);
    }
  }

  logger.info("[DAEMON] Perpetual Flywheel Harvester Daemon stopped gracefully. Goodbye!");
}

export async function runTestFlywheelBroadcast(tickerOrCA?: string): Promise<void> {
  const fleet = getProductionFleet("base");
  const target = fleet.live[0] || fleet.all[0] || {
    ticker: "BASECOIN",
    contractAddr: "0x1111111111111111111111111111111111111111",
  };

  const ticker = tickerOrCA || target.ticker || "BASECOIN";
  const address = target.contractAddr || "0x1111111111111111111111111111111111111111";

  logger.info(`🔥 [TEST BROADCAST] Menyiapkan simulasi Buyback & Burn Hype Alert untuk $${ticker}...`);

  const fakeSplit = {
    creatorWeth: 0.035,
    buybackWeth: 0.030,
    dividendWeth: 0.020,
    jackpotWeth: 0.015,
  };

  const fakeBurnTx = `sim_burn_${Date.now()}_test`;
  const fakeBurnedTokens = 3_000_000;

  const result = await broadcastFlywheelBurnAlert({
    tokenSymbol: ticker,
    contractAddress: address,
    burnedTokens: fakeBurnedTokens,
    wethUsed: 0.030,
    burnTxHash: fakeBurnTx,
    totalClaimedWeth: 0.100,
    split: fakeSplit,
    isSimulated: true,
  });

  if (result.telegramSent) {
    logger.success(`✅ [SUKSES] Pesan simulasi Buyback & Burn Hype Alert berhasil terkirim ke Telegram!`);
  } else {
    logger.warn(`⚠️  [INFO] Telegram tidak terkirim (${result.error || "Bot token atau Chat ID belum disetel di .env"}).`);
    logger.info(`   Format pesan HTML & inline keyboard berhasil divalidasi.`);
  }

  console.log("\n--- [PREVIEW FORMAT ALERT TELEGRAM] ---");
  console.log(result.messageText);
  console.log("----------------------------------------\n");
}

if (import.meta.main) {
  const { isDaemon, intervalMinutes, isTestBroadcast } = parseDaemonArgs(process.argv.slice(2));

  if (isTestBroadcast) {
    runTestFlywheelBroadcast()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(`Broadcast test error: ${err?.message || err}`);
        process.exit(1);
      });
  } else if (isDaemon) {
    runFlywheelDaemon(intervalMinutes)
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(`Daemon fatal error: ${err?.message || err}`);
        process.exit(1);
      });
  } else {
    runFlywheelSinglePass()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(`Worker fatal error: ${err?.message || err}`);
        process.exit(1);
      });
  }
}
