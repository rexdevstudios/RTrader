#!/usr/bin/env bun
/**
 * scripts/run-phase-orchestrator.ts
 *
 * CLI Runner for Phase Orchestrator (Phase 3 -> 4 -> 5 -> 6)
 * Evaluates live metrics, displays an interactive terminal scorecard,
 * checks safety gates, and optionally executes the transition with audit trail.
 *
 * Usage:
 *   bun run scripts/run-phase-orchestrator.ts [tokenAddress] [--execute] [--simulate]
 */

import { evaluateTokenPhase, executePhaseTransition } from "../src/modules/orchestration/phase-orchestrator.ts";
import { logger } from "../src/logger.ts";

const DEFAULT_TOKEN_ADDRESS = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
const DEFAULT_TOKEN_NAME = "PumpRun";
const DEFAULT_TOKEN_SYMBOL = "PUMPRUN";
const DEFAULT_CHAIN_ID = 8453; // Base Mainnet

function resolveActiveToken(addressArg?: string) {
  const address = (addressArg || DEFAULT_TOKEN_ADDRESS).toLowerCase();
  return {
    address,
    name: address === DEFAULT_TOKEN_ADDRESS.toLowerCase() ? DEFAULT_TOKEN_NAME : "Token",
    symbol: address === DEFAULT_TOKEN_ADDRESS.toLowerCase() ? DEFAULT_TOKEN_SYMBOL : "TKN",
    chainId: DEFAULT_CHAIN_ID,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");
  const isSimulate = args.includes("--simulate") || !isExecute;
  const addressArg = args.find((a) => a.startsWith("0x"));

  const resolved = resolveActiveToken(addressArg);

  console.log("\n=================================================================");
  console.log("🚀 RTrader Autonomous Phase Orchestrator (P3 → P4 → P5 → P6)");
  console.log(`🎯 Target Token: ${resolved.name} ($${resolved.symbol}) - ${resolved.address}`);
  console.log(`🌐 Chain: Base (${resolved.chainId})`);
  console.log(`⚙️ Mode: ${isExecute ? "LIVE EXECUTION" : "AUDIT / SIMULATION"}`);
  console.log("=================================================================\n");

  logger.info("Mengevaluasi metrik on-chain, DexScreener, dan database state...");
  const evalResult = await evaluateTokenPhase(resolved.address);

  console.log("\n------------------------- SCORECARD -----------------------------");
  console.log(`📍 Fase Saat Ini     : ${evalResult.currentPhase}`);
  console.log(`🎯 Fase Target       : ${evalResult.nextPhase || "SELESAI (MAX_PHASE)"}`);
  console.log(`🛡️ Status Safety Gate: ${evalResult.safetyGatePassed ? "✅ LOLOS (AMAN)" : "❌ TERHALANG"}`);
  console.log(`📈 Memenuhi Syarat   : ${evalResult.transitionEligible ? "✅ YA" : "⏳ BELUM"}`);

  console.log("\n📊 Telemetri Aktual:");
  console.log(`   - 24h Volume USD   : $${evalResult.metrics.volume24hUsd.toFixed(2)}`);
  console.log(`   - Unique Makers    : ${evalResult.metrics.uniqueMakers}`);
  console.log(`   - Creator Fee WETH : ${evalResult.metrics.creatorFeeAvailableWeth.toFixed(6)} WETH`);
  console.log(`   - Operator Balance : ${evalResult.metrics.operatorBalanceEth.toFixed(6)} ETH (Floor: 0.0003 ETH)`);
  console.log(`   - Flywheel Cycles  : ${evalResult.metrics.flywheelCyclesCount} (Total Recycled: ${evalResult.metrics.totalRecycledWeth.toFixed(6)} WETH)`);
  console.log(`   - Bounty Active    : ${evalResult.metrics.bountyCampaignActive ? "YA (Neon SSOT)" : "TIDAK"}`);
  console.log(`   - Multi-Chain Fleet: ${evalResult.metrics.fleetDeployedChains.join(", ") || "Base only"}`);

  if (evalResult.unmetConditions.length > 0) {
    console.log("\n⏳ Kondisi yang Belum Terpenuhi:");
    for (const cond of evalResult.unmetConditions) {
      console.log(`   ❌ ${cond}`);
    }
  } else {
    console.log("\n✨ Semua kriteria transisi terpenuhi!");
  }

  if (evalResult.safetyGateReason) {
    console.log(`\n⚠️ Safety Gate Warning: ${evalResult.safetyGateReason}`);
  }

  if (isExecute) {
    console.log("\n------------------- EKSEKUSI TRANSISI ---------------------------");
    const transResult = await executePhaseTransition(evalResult, {
      simulateOnly: isSimulate,
    });

    if (transResult.success) {
      logger.success(`✅ Transisi Berhasil! Tindakan: ${transResult.action} (Audit Log #${transResult.auditLogId})`);
    } else {
      logger.error(`❌ Transisi Gagal: ${transResult.error}`);
    }
  } else {
    console.log("\n💡 Petunjuk Operasional:");
    if (evalResult.transitionEligible) {
      console.log(`   Jalankan eksekusi transisi: bun run scripts/run-phase-orchestrator.ts ${resolved.address} --execute`);
    } else if (evalResult.currentPhase === "PHASE_3_CATALYST") {
      console.log("   Picu Volume Spark untuk tembus syarat Fase 4:");
      console.log("   👉 bun run scripts/execute-catalyst-trading.ts spark 1 3 0.00005");
    }
  }
  console.log("=================================================================\n");
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
