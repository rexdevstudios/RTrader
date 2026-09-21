#!/usr/bin/env bun
/**
 * scripts/run-trending-booster.ts
 *
 * CLI runner for DexScreener Trending Algorithm Booster.
 * Rotates micro-trades across multi-wallet accounts to populate "Unique Makers"
 * and green candles on DexScreener & GeckoTerminal.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getAllDeployLogs } from "../src/db/vault.ts";
import { runTrendingBoostCycle } from "../src/modules/growth/trending-booster.ts";
import { logger } from "../src/logger.ts";

async function main(): Promise<void> {
  console.log(`
=================================================================
  [+] DEXSCREENER TRENDING ALGORITHM BOOSTER (MULTI-WALLET) [+]
=================================================================
  Mechanism: Rotating Micro-Buys Across Multiple Unique Wallets
  Goal: Populate DexScreener "Unique Makers" & Top Gainers radar
=================================================================
`);

  const args = process.argv.slice(2);
  const isLiveFlag = args.includes("--live") || args.includes("-l");
  const isSimulatedFlag = (args.includes("--simulated") || args.includes("-s")) && !isLiveFlag;

  // Parse --amount or -a
  let customAmountEth = isLiveFlag ? 0.00005 : 0.0001;
  const amountIdx = args.findIndex((a) => a === "--amount" || a === "-a");
  if (amountIdx !== -1 && args[amountIdx + 1] && !isNaN(Number(args[amountIdx + 1]))) {
    customAmountEth = parseFloat(args[amountIdx + 1]);
  }

  const filteredArgs = args.filter(
    (a, i) =>
      a !== "--simulated" &&
      a !== "-s" &&
      a !== "--live" &&
      a !== "-l" &&
      a !== "--amount" &&
      a !== "-a" &&
      args[i - 1] !== "--amount" &&
      args[i - 1] !== "-a"
  );

  const customCa = filteredArgs.find((a) => a.startsWith("0x"));
  const roundArg = filteredArgs.find((a) => /^\d+$/.test(a));
  const customRounds = roundArg ? parseInt(roundArg, 10) : (isLiveFlag ? 3 : 10);

  let targetCa = customCa;
  let targetSymbol = "TOKEN";

  if (!targetCa) {
    // Find latest confirmed Base token from SQLite (prioritize unsimulated live token)
    let deploys = getAllDeployLogs().filter(
      (d) => d.chain === "base" && !d.simulated && d.contractAddr && d.contractAddr.startsWith("0x")
    );

    if (deploys.length === 0) {
      deploys = getAllDeployLogs().filter(
        (d) => d.chain === "base" && d.contractAddr && d.contractAddr.startsWith("0x")
      );
    }

    if (deploys.length === 0) {
      logger.error("[ERROR] No active Base token found in database. Please specify a CA: bun run trending:boost <CA>");
      process.exit(1);
    }

    const latest = deploys[0];
    targetCa = latest.contractAddr!;
    targetSymbol = latest.ticker || "TOKEN";
    logger.info(`[TARGET] Automatically targeted latest active token: $${targetSymbol} (${targetCa})`);
  } else {
    const deploys = getAllDeployLogs().filter(
      (d) => d.contractAddr && d.contractAddr.toLowerCase() === targetCa.toLowerCase()
    );
    if (deploys.length > 0 && deploys[0].ticker) {
      targetSymbol = deploys[0].ticker;
    }
  }

  // Pre-flight balance check for live runs
  let actualRounds = customRounds;
  if (!isSimulatedFlag) {
    const { getConfig } = await import("../src/config.ts");
    const { getEvmPublicClient, deriveEvmAddress } = await import("../src/modules/reconciliation/evm-verifier.ts");
    const { formatEther } = await import("viem");
    const cfg = getConfig();
    const opAddr = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);
    if (opAddr) {
      const client = getEvmPublicClient("base");
      if (client) {
        const balRaw = await client.getBalance({ address: opAddr as `0x${string}` });
        const opEth = parseFloat(formatEther(balRaw));
        const OPERATOR_GAS_FLOOR_ETH = 0.0003;
        const ESTIMATED_TX_GAS_ETH = 0.00002;
        const availableBudget = Math.max(0, opEth - OPERATOR_GAS_FLOOR_ETH);
        const costPerRound = customAmountEth + ESTIMATED_TX_GAS_ETH;
        const maxSafeRounds = Math.floor(availableBudget / costPerRound);

        logger.info(`[PRE-FLIGHT] Operator: ${opAddr} | Saldo: ${opEth.toFixed(6)} ETH | Floor Aman: ${OPERATOR_GAS_FLOOR_ETH} ETH | Budget Tersedia: ${availableBudget.toFixed(6)} ETH`);

        if (opEth < OPERATOR_GAS_FLOOR_ETH || maxSafeRounds < 1) {
          logger.error(`⛔ [SAFETY GATE] Saldo operator (${opEth.toFixed(6)} ETH) di bawah floor aman (${OPERATOR_GAS_FLOOR_ETH} ETH) atau tidak mencukupi untuk 1 ronde swap. Eksekusi live dibatalkan tanpa biaya gas.`);
          process.exit(1);
        }

        if (customRounds > maxSafeRounds) {
          logger.warn(`⚠️  [SAFETY CLAMP] Permintaan ${customRounds} putaran melebihi batas aman. Dipangkas otomatis menjadi ${maxSafeRounds} putaran untuk melindungi gas floor.`);
          actualRounds = maxSafeRounds;
        }
      }
    }
  }

  const summary = await runTrendingBoostCycle({
    tokenAddress: targetCa,
    tokenSymbol: targetSymbol,
    rounds: actualRounds,
    microAmountEth: customAmountEth,
    isSimulated: isSimulatedFlag,
  });

  console.log(`
=================================================================
  [+] TRENDING BOOST SUMMARY [+]
=================================================================
  Token:                $${summary.tokenSymbol}
  CA:                   ${summary.tokenAddress}
  Rounds Executed:      ${summary.totalRoundsExecuted}
  Unique Makers Used:   ${summary.uniqueMakersCount}
  Total Volume Billed:  ${summary.totalVolumeEth} ETH
  Execution Mode:       ${summary.simulated ? "SIMULATED (0 Gas)" : "LIVE"}
  Duration:             ${(summary.durationMs / 1000).toFixed(1)}s
  Chart:                https://dexscreener.com/base/${summary.tokenAddress}
=================================================================
`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(`Fatal trending booster error: ${err?.message || err}`);
      process.exit(1);
    });
}
