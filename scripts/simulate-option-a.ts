/**
 * scripts/simulate-option-a.ts
 *
 * Runs a single full cycle of the pipeline in Option A (testnet simulation mode)
 * with zero required gas balance, using live Firecrawl, ByteDance ModelArk AI,
 * Pinata IPFS, and simulated on-chain deployment.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { getConfig, resetConfig } from "../src/config.ts";
import { runDeployPipeline } from "../src/index.ts";
import { getAllDeployLogs, getOpenPositions } from "../src/db/vault.ts";
import { logger } from "../src/logger.ts";

async function runSimulation() {
  console.log(`
=================================================================
  OPTION A - ZERO-COST TESTNET PIPELINE SIMULATION
=================================================================
  Mode: TESTNET (Simulated Deployment)
  AI Provider: ByteDance ModelArk (Dola-Seed-2.0-pro)
  Preflight Min Balance: ETH=0, SOL=0
=================================================================
`);

  process.env.SCHEDULING_POLICY_ENABLED = "true";
  process.env.SCHEDULING_COOLDOWN_MINUTES = "0";
  process.env.SCHEDULING_MIN_INTERVAL_MINUTES = "1";
  process.env.TREND_SCAN_INTERVAL_MINUTES = "1";
  process.env.SCHEDULING_ADAPTIVE_ENABLED = "false";
  process.env.PREFLIGHT_MIN_BALANCE_ETH = "0";
  process.env.PREFLIGHT_MIN_BALANCE_SOL = "0";
  process.env.DEPLOY_MODE = "testnet";
  resetConfig();
  const cfg = getConfig();

  // Reset last cycle completion time so the scheduling gate is immediately READY
  const { Database } = await import("bun:sqlite");
  const { DB_PATH } = await import("../src/db/vault.ts");
  const localDb = new Database(DB_PATH);
  localDb.run("UPDATE pipeline_cycles SET completed_at = datetime('now', '-2 hours') WHERE completed_at IS NOT NULL");
  localDb.close();

  logger.info(`Starting single pipeline execution cycle...`);
  const startTime = Date.now();

  try {
    await runDeployPipeline();
  } catch (err: any) {
    logger.error(`Pipeline cycle threw error: ${err?.message || String(err)}`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n-----------------------------------------------------------------`);
  console.log(`  Cycle completed in ${durationSec}s`);
  console.log(`-----------------------------------------------------------------\n`);

  // Verify DB state
  const recentDeploys = getAllDeployLogs().slice(0, 5);
  console.log("Recent Deploy Logs in SQLite Vault:");
  if (recentDeploys.length === 0) {
    console.log("  (No deploys recorded in this cycle)");
  } else {
    for (const d of recentDeploys) {
      console.log(`  - ID: ${d.id} | Chain: ${d.chain.toUpperCase()} | Token: $${d.ticker} ("${d.tokenName}")`);
      console.log(`    Status: ${d.status} | Lifecycle: ${d.lifecycleState} | Simulated: ${d.simulated}`);
      console.log(`    Contract: ${d.contractAddr ?? "n/a"} | Pool: ${d.poolId ?? "n/a"}`);
      console.log(`    IPFS: ${d.ipfsUrl ?? "n/a"}`);
      console.log(`    Candidate ID: ${d.candidateId ?? "n/a"} | Viral Score: ${d.viralScore}`);
      if (d.errorMsg) console.log(`    Error/Note: ${d.errorMsg}`);
    }
  }

  const positions = getOpenPositions().slice(0, 3);
  console.log(`\nActive Positions (showing top ${positions.length}):`);
  for (const pos of positions) {
    console.log(`  - Chain: ${pos.chain} | CA: ${pos.contractAddr} | Snipe: ${pos.snipeAmount}`);
    console.log(`    Status: ${pos.status} | Entry: $${pos.entryPrice ?? "simulated"}`);
  }

  console.log(`\n=================================================================`);
  console.log(`  SIMULATION COMPLETED SUCCESSFULLY`);
  console.log(`=================================================================\n`);
}

runSimulation().catch((err) => {
  console.error("Fatal error during simulation:", err);
  process.exit(1);
});
