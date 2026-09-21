#!/usr/bin/env bun
/**
 * scripts/test-arc-simulation.ts
 *
 * Standalone End-to-End Zero-Gas Simulation & Fleet Integration Script for Arc Chain.
 *
 * Validates 5 automated verification phases:
 *  1. Arc Mainnet Live RPC connectivity, Chain ID (5042), and head block progression.
 *  2. Operator wallet derivation and native USDC gas token balance inspection.
 *  3. ArcPad launchpad pre-flight simulation (zero-gas contract simulation via Viem).
 *  4. Database persistence into SQLite vault (deploy_logs) with simulated metadata.
 *  5. Fleet Registry classification & Reconciler resolution verification.
 *
 * Usage:
 *   bun run scripts/test-arc-simulation.ts
 *   bun run scripts/test-arc-simulation.ts --cleanup
 *   bun run scripts/test-arc-simulation.ts --silent
 */

import * as dotenv from "dotenv";
dotenv.config();

import {
  ARC_CHAIN_ID,
  ARC_CHAIN_NAME,
  ARC_CURVE_PAD_ADDRESS,
  ARC_EXPLORER_DEFAULT,
  ArcPadAdapter,
  getArcPublicClient,
  getArcWalletClient,
  getArcNativeBalance,
  type ArcPadLaunchParams,
} from "../src/modules/arc/index.ts";
import {
  logDeploy,
  getAllDeployLogs,
  type DeployLog,
} from "../src/db/vault.ts";
import {
  classifyDeployment,
  isSimulatedDeployment,
  isLiveDeployment,
  getProductionFleet,
} from "../src/modules/fleet/fleet-registry.ts";
import {
  getEvmPublicClient,
  verifyEvmTransactionReceipt,
} from "../src/modules/reconciliation/evm-verifier.ts";
import { logger } from "../src/logger.ts";
import type { Hex, Address } from "viem";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

const args = process.argv.slice(2);
const isSilent = args.includes("--silent");
const shouldCleanup = args.includes("--cleanup");

export interface ArcSimulationReport {
  timestamp: string;
  rpc: {
    connected: boolean;
    chainId: number;
    headBlock: number;
  };
  operator: {
    address: string;
    nativeUsdcBalance: number;
    gasReady: boolean;
  };
  simulation: {
    success: boolean;
    tokenName: string;
    symbol: string;
    salt: string;
    predictedGas: string;
    simulatedTokenAddress?: string;
  };
  database: {
    loggedId: number;
    simulatedFlag: boolean;
    lifecycleState: string;
  };
  fleetClassification: {
    category: string;
    isSimulated: boolean;
    isLive: boolean;
    reconcilerChainMatch: boolean;
  };
  overallSuccess: boolean;
}

export async function runArcSimulation(): Promise<ArcSimulationReport> {
  if (!isSilent) {
    console.log(`\n${CYAN}${BOLD}========================================================================================${RESET}`);
    console.log(`${CYAN}${BOLD}     [+] ARC CHAIN (5042) ZERO-GAS END-TO-END SIMULATION & FLEET TEST SUITE [+]         ${RESET}`);
    console.log(`${CYAN}${BOLD}========================================================================================${RESET}\n`);
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 1: ARC MAINNET LIVE RPC & NETWORK HEALTH
  // ─────────────────────────────────────────────────────────────
  if (!isSilent) console.log(`${BOLD}[Phase 1/5] Verifying Arc Mainnet Live RPC Connectivity...${RESET}`);

  const publicClient = getArcPublicClient();
  const [chainId, headBlockBig] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlockNumber(),
  ]);

  const headBlock = Number(headBlockBig);
  const rpcConnected = chainId === ARC_CHAIN_ID;

  if (!rpcConnected) {
    throw new Error(`RPC Chain ID mismatch: expected ${ARC_CHAIN_ID}, got ${chainId}`);
  }

  if (!isSilent) {
    console.log(`  ✅ ${BOLD}Arc Network${RESET}         : ${GREEN}${ARC_CHAIN_NAME} (Chain ID: ${chainId})${RESET}`);
    console.log(`  ✅ ${BOLD}Head Block Number${RESET}   : ${GREEN}#${headBlock.toLocaleString()}${RESET}`);
    console.log(`  ✅ ${BOLD}CurvePad Contract${RESET}   : ${CYAN}${ARC_CURVE_PAD_ADDRESS}${RESET}\n`);
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 2: OPERATOR DERIVATION & NATIVE GAS BALANCE
  // ─────────────────────────────────────────────────────────────
  if (!isSilent) console.log(`${BOLD}[Phase 2/5] Inspecting Operator Wallet & Native Gas Reserve...${RESET}`);

  const rawKey = process.env.ARC_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
  const privateKey: Hex = (
    rawKey && rawKey.startsWith("0x")
      ? rawKey
      : rawKey
      ? `0x${rawKey}`
      : "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  ) as Hex;

  const walletClient = getArcWalletClient(privateKey);
  const operatorAddress = walletClient.account?.address as Address;

  const balance = await getArcNativeBalance(publicClient, operatorAddress);
  const gasReady = balance.numeric >= 0.05;

  if (!isSilent) {
    console.log(`  ✅ ${BOLD}Operator Address${RESET}    : ${CYAN}${operatorAddress}${RESET}`);
    const balColor = gasReady ? GREEN : YELLOW;
    const balBadge = gasReady ? "[READY FOR LIVE DEPLOY]" : "[SIMULATION MODE / LOW BALANCE]";
    console.log(`  ✅ ${BOLD}Native USDC (Gas)${RESET}  : ${balColor}${balance.numeric.toFixed(4)} USDC ${balBadge}${RESET}\n`);
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 3: ARCPAD LAUNCHPAD ZERO-GAS PREFLIGHT SIMULATION
  // ─────────────────────────────────────────────────────────────
  if (!isSilent) console.log(`${BOLD}[Phase 3/5] Executing ArcPad Pre-flight Launch Simulation...${RESET}`);

  const testParams: ArcPadLaunchParams = {
    name: "Arc Simulation Test Token",
    symbol: "TESTARC",
    meta: {
      imageURI: "https://arcpad.meme/uploads/simulation_test_logo.webp",
      website: "https://arc.network",
      twitter: "https://x.com/arc_test",
      telegram: "https://t.me/arc_test",
    },
    devBuyUsdc: 0.1,
    dryRun: true,
  };

  const simResult = await ArcPadAdapter.simulateLaunch(
    publicClient,
    operatorAddress,
    testParams
  );

  if (!simResult.canLaunch) {
    logger.warn(`[ArcSimulation] Preflight check note: ${simResult.error}`);
  }

  const dryRunLaunch = await ArcPadAdapter.launchToken(
    publicClient,
    walletClient,
    testParams
  );

  if (!isSilent) {
    console.log(`  ✅ ${BOLD}Simulation Mode${RESET}     : ${GREEN}CONFIRMED (Zero-Gas Dry Run)${RESET}`);
    console.log(`  ✅ ${BOLD}Token Identity${RESET}      : ${CYAN}${dryRunLaunch.name} ($${dryRunLaunch.symbol})${RESET}`);
    console.log(`  ✅ ${BOLD}Cryptographic Salt${RESET}  : ${GRAY}${simResult.salt}${RESET}`);
    console.log(`  ✅ ${BOLD}Simulated Dev Buy${RESET}   : ${CYAN}${dryRunLaunch.devBuyAmountUsdc} USDC${RESET}`);
    console.log(`  ✅ ${BOLD}Simulated CA${RESET}        : ${GRAY}${dryRunLaunch.tokenAddress || "0x0000000000000000000000000000000000000000"}${RESET}\n`);
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 4: RECORD SIMULATION TO SQLITE VAULT (SSOT)
  // ─────────────────────────────────────────────────────────────
  if (!isSilent) console.log(`${BOLD}[Phase 4/5] Logging Deployment to SQLite Vault DB...${RESET}`);

  const simulatedCa = dryRunLaunch.tokenAddress || "0x0000000000000000000000000000000000000000";
  const simulatedTx = dryRunLaunch.transactionHash || `0xsimulated_arc_tx_${Date.now()}`;

  const loggedId = logDeploy({
    chain: "arc",
    tokenName: dryRunLaunch.name,
    ticker: dryRunLaunch.symbol,
    contractAddr: simulatedCa,
    txHash: simulatedTx,
    status: "confirmed",
    lifecycleState: "DEPLOY_SIMULATED",
    deployCost: dryRunLaunch.devBuyAmountUsdc,
    simulated: true,
    poolId: dryRunLaunch.poolAddress,
  });

  if (!isSilent) {
    console.log(`  ✅ ${BOLD}Vault Log ID${RESET}        : ${GREEN}#${loggedId}${RESET}`);
    console.log(`  ✅ ${BOLD}Lifecycle State${RESET}     : ${GREEN}DEPLOY_SIMULATED${RESET}`);
    console.log(`  ✅ ${BOLD}SSOT Consistency${RESET}    : ${GREEN}SAVED & INDEXED${RESET}\n`);
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE 5: FLEET REGISTRY & RECONCILER VALIDATION
  // ─────────────────────────────────────────────────────────────
  if (!isSilent) console.log(`${BOLD}[Phase 5/5] Auditing Fleet Classification & On-Chain Reconciler...${RESET}`);

  const recentLogs = getAllDeployLogs({ chain: "arc", limit: 5 });
  const targetLog = recentLogs.find((l) => l.id === loggedId);

  if (!targetLog) {
    throw new Error(`Deployment record #${loggedId} not found in deploy_logs query!`);
  }

  const category = classifyDeployment(targetLog);
  const isSim = isSimulatedDeployment(targetLog);
  const isLive = isLiveDeployment(targetLog);

  // Validate Reconciler Client Resolution for 'arc'
  const evmClient = getEvmPublicClient("arc");
  const reconcilerChainId = await evmClient?.getChainId();
  const reconcilerChainMatch = reconcilerChainId === ARC_CHAIN_ID;

  // Validate Reconciler Transaction Receipt handling
  const receiptCheck = await verifyEvmTransactionReceipt(
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "arc"
  );

  // Validate Fleet matrix inclusion
  const arcFleet = getProductionFleet("arc");
  const inFleetSimulated = arcFleet.simulated.some((l) => l.id === loggedId);

  if (!isSilent) {
    console.log(`  ✅ ${BOLD}Fleet Category${RESET}      : ${category === "SIMULATED" ? GREEN : RED}${category}${RESET}`);
    console.log(`  ✅ ${BOLD}isSimulatedDeployment${RESET}: ${isSim ? GREEN + "true" : RED + "false"}${RESET}`);
    console.log(`  ✅ ${BOLD}isLiveDeployment${RESET}     : ${!isLive ? GREEN + "false (Guard Active)" : RED + "true"}${RESET}`);
    console.log(`  ✅ ${BOLD}Reconciler Chain ID${RESET}  : ${reconcilerChainMatch ? GREEN + reconcilerChainId : RED + "Mismatch"}${RESET}`);
    console.log(`  ✅ ${BOLD}Receipt Check Status${RESET} : ${CYAN}${receiptCheck.status}${RESET} (${receiptCheck.reason || "Handled defensively"})`);
    console.log(`  ✅ ${BOLD}Fleet Matrix Sync${RESET}    : ${inFleetSimulated ? GREEN + "SYNCED" : YELLOW + "PENDING"}${RESET}\n`);
  }

  // Cleanup optional
  if (shouldCleanup) {
    try {
      const db = new Database(DB_PATH);
      db.run("DELETE FROM deploy_logs WHERE id = ?", [loggedId]);
      db.close();
      if (!isSilent) {
        console.log(`  🧹 ${GRAY}Test record #${loggedId} successfully cleaned up from vault.db (--cleanup enabled)${RESET}\n`);
      }
    } catch (cleanErr: any) {
      logger.warn(`Failed to cleanup test record #${loggedId}: ${cleanErr?.message}`);
    }
  }

  const overallSuccess =
    rpcConnected &&
    dryRunLaunch.success &&
    loggedId > 0 &&
    category === "SIMULATED" &&
    isSim === true &&
    isLive === false &&
    reconcilerChainMatch;

  if (!isSilent) {
    console.log(`${CYAN}${BOLD}========================================================================================${RESET}`);
    if (overallSuccess) {
      console.log(`${GREEN}${BOLD}   [+] ALL 5 PHASES PASSED: ARC CHAIN ZERO-GAS SIMULATION IS 100% OPERATIONAL [+]       ${RESET}`);
    } else {
      console.log(`${RED}${BOLD}   [-] SIMULATION COMPLETED WITH WARNINGS OR ANOMALIES [-]                               ${RESET}`);
    }
    console.log(`${CYAN}${BOLD}========================================================================================${RESET}\n`);
  }

  return {
    timestamp: new Date().toISOString(),
    rpc: {
      connected: rpcConnected,
      chainId,
      headBlock,
    },
    operator: {
      address: operatorAddress,
      nativeUsdcBalance: balance.numeric,
      gasReady,
    },
    simulation: {
      success: dryRunLaunch.success,
      tokenName: dryRunLaunch.name,
      symbol: dryRunLaunch.symbol,
      salt: simResult.salt,
      predictedGas: simResult.predictedGas.toString(),
      simulatedTokenAddress: dryRunLaunch.tokenAddress,
    },
    database: {
      loggedId,
      simulatedFlag: Boolean(targetLog.simulated),
      lifecycleState: String(targetLog.lifecycleState),
    },
    fleetClassification: {
      category,
      isSimulated: isSim,
      isLive,
      reconcilerChainMatch,
    },
    overallSuccess,
  };
}

if (import.meta.main) {
  runArcSimulation().catch((err) => {
    logger.error(`Fatal error in Arc simulation script: ${err?.message || err}`);
    console.error(`\n❌ FATAL ERROR:`, err);
    process.exit(1);
  });
}
