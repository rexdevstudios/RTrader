/**
 * scripts/deploy-arcpad-token.ts
 *
 * Standalone, isolated CLI execution script for deploying meme tokens to ArcPad
 * on Arc Mainnet (Chain ID 5042, USDC-native gas).
 *
 * Usage:
 *   bun run scripts/deploy-arcpad-token.ts --simulate
 *   bun run scripts/deploy-arcpad-token.ts --name="My Coin" --symbol="MYC" --dev-buy=1.0
 *   bun run scripts/deploy-arcpad-token.ts --dry-run
 */

import * as dotenv from "dotenv";
dotenv.config();

import {
  ARC_CHAIN_ID,
  ARC_CHAIN_NAME,
  ARC_CURVE_PAD_ADDRESS,
  ARC_EXPLORER_DEFAULT,
  ARCPAD_TOTAL_SUPPLY,
  ArcPadAdapter,
  getArcPublicClient,
  getArcWalletClient,
  getArcNativeBalance,
  nativeUsdcToWei,
  type ArcPadLaunchParams,
} from "../src/modules/arc/index.ts";
import { logDeploy, createPendingPosition } from "../src/db/vault.ts";
import { logger } from "../src/logger.ts";
import type { Hex, Address } from "viem";

// ─── Parse Arguments ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string, fallback: string = ""): string {
  for (const a of args) {
    if (a.startsWith(`${flag}=`)) {
      return a.slice(flag.length + 1);
    }
  }
  return fallback;
}

const isSimulate =
  args.includes("--simulate") ||
  args.includes("--dry-run") ||
  process.env.DRY_RUN === "true";

const tokenName = getArg("--name", "Arc Quantum Meme");
const tokenSymbol = getArg("--symbol", "AQM").toUpperCase();
const imageUri = getArg(
  "--image",
  "https://arcpad.meme/uploads/f07e944874c4eef677e72e8a6203e0be4548fe12d588f096cf30f2df44a43445.webp"
);
const website = getArg("--website", "");
const twitter = getArg("--twitter", "");
const telegram = getArg("--telegram", "");
const devBuyUsdc = getArg("--dev-buy", "0");
const rpcOverride = getArg("--rpc", "");

// ─── Main Execution ───────────────────────────────────────────────────────────

async function main() {
  console.log("===============================================================================");
  console.log(` [+] ARCPAD LAUNCHPAD ENGINE — ${ARC_CHAIN_NAME} (Chain ID: ${ARC_CHAIN_ID}) [+]`);
  console.log("===============================================================================");
  console.log(` Mode:        ${isSimulate ? "🧪 SIMULATION / DRY-RUN" : "🚀 LIVE MAINNET BROADCAST"}`);
  console.log(` Token Name:  ${tokenName}`);
  console.log(` Symbol:      $${tokenSymbol}`);
  console.log(` Total Supply: 1,000,000,000 (Fixed, 100% LP Locked at block one)`);
  console.log(` Dev Buy:     ${devBuyUsdc} USDC`);
  console.log(` Image URI:   ${imageUri}`);
  console.log("===============================================================================\n");

  // 1. Resolve RPC & Client
  const publicClient = getArcPublicClient(rpcOverride || undefined);

  console.log("[1/4] Connecting to Arc Mainnet RPC...");
  const chainId = await publicClient.getChainId();
  const headBlock = await publicClient.getBlockNumber();

  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Unexpected Chain ID: expected ${ARC_CHAIN_ID}, got ${chainId}`);
  }

  console.log(` -> Connected! Arc Chain ID: ${chainId} | Head Block: ${headBlock}`);

  // 2. Resolve Operator Account
  const rawKey = process.env.ARC_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
  const privateKey: Hex = (
    rawKey && rawKey.startsWith("0x")
      ? rawKey
      : rawKey
      ? `0x${rawKey}`
      : "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  ) as Hex;

  const walletClient = getArcWalletClient(privateKey, rpcOverride || undefined);
  const operatorAddress = walletClient.account?.address as Address;

  console.log(`\n[2/4] Operator Identity: ${operatorAddress}`);
  const balance = await getArcNativeBalance(publicClient, operatorAddress);
  console.log(` -> Native USDC Balance: ${balance.numeric.toFixed(4)} USDC (Gas Token)`);

  const devBuyNum = parseFloat(devBuyUsdc) || 0;
  const gasReserveUsdc = 0.05; // Buffer for deployment gas fee

  if (!isSimulate && balance.numeric < devBuyNum + gasReserveUsdc) {
    console.error(`\n❌ SALDO NATIVE USDC TIDAK CUKUP:`);
    console.error(`   Dibutuhkan minimal ${(devBuyNum + gasReserveUsdc).toFixed(4)} USDC (dev buy + gas reserve).`);
    console.error(`   Saldo saat ini: ${balance.numeric.toFixed(4)} USDC di alamat ${operatorAddress}`);
    console.error(`   Harap transfer USDC ke alamat operator di jaringan Arc Mainnet (Chain ID 5042).`);
    process.exit(1);
  }

  // 3. Pre-Flight Simulation
  console.log("\n[3/4] Running pre-flight launchpad simulation...");
  const launchParams: ArcPadLaunchParams = {
    name: tokenName,
    symbol: tokenSymbol,
    meta: {
      imageURI: imageUri,
      website,
      twitter,
      telegram,
    },
    devBuyUsdc,
    dryRun: isSimulate,
  };

  const simResult = await ArcPadAdapter.simulateLaunch(
    publicClient,
    operatorAddress,
    launchParams
  );

  if (!simResult.canLaunch) {
    console.error(`❌ Pre-flight simulation failed: ${simResult.error}`);
    if (!isSimulate) {
      process.exit(1);
    }
  } else {
    console.log(` -> Preflight check PASSED!`);
    console.log(`    Salt: ${simResult.salt}`);
    console.log(`    Predicted Gas: ${simResult.predictedGas.toString()}`);
    console.log(`    Dev Buy (wei): ${simResult.devBuyWei.toString()}`);
  }

  // 4. Execution & Accounting
  console.log("\n[4/4] Executing deployment lifecycle...");

  const deployResult = await ArcPadAdapter.launchToken(
    publicClient,
    walletClient,
    launchParams
  );

  if (!deployResult.success) {
    console.error(`\n❌ DEPLOYMENT GAGAL: ${deployResult.error}`);
    process.exit(1);
  }

  // Record to SQLite Vault DB
  const deployLogId = logDeploy({
    chain: "arc",
    tokenName: deployResult.name,
    ticker: deployResult.symbol,
    contractAddr: deployResult.tokenAddress || "0x0000000000000000000000000000000000000000",
    txHash: deployResult.transactionHash || (isSimulate ? "0xsimulated_arc_tx" : undefined),
    status: "confirmed",
    lifecycleState: isSimulate ? "DEPLOY_SIMULATED" : "DEPLOY_CONFIRMED",
    deployCost: deployResult.devBuyAmountUsdc,
    simulated: isSimulate,
    poolId: deployResult.poolAddress,
  });

  if (deployResult.tokenAddress && devBuyNum > 0 && !isSimulate) {
    createPendingPosition({
      deployLogId,
      chain: "arc",
      contractAddr: deployResult.tokenAddress,
      ticker: deployResult.symbol,
      snipeAmount: devBuyNum,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletAddress: operatorAddress,
      deploymentTxHash: deployResult.transactionHash,
    });
  }

  console.log("\n===============================================================================");
  console.log(" ✅ DEPLOYMENT BERHASIL DI-CATAT KE SSOT & DATABASE!");
  console.log("===============================================================================");
  console.log(` Token Name:     ${deployResult.name}`);
  console.log(` Symbol:         $${deployResult.symbol}`);
  console.log(` Token Address:  ${deployResult.tokenAddress || "[SIMULATED]"}`);
  console.log(` Pool Address:   ${deployResult.poolAddress || "[UNISWAP_V3_1%_LOCKED]"}`);
  console.log(` Tx Hash:        ${deployResult.transactionHash || "[DRY_RUN_TX]"}`);
  console.log(` Explorer:       ${deployResult.explorerUrl || ARC_EXPLORER_DEFAULT}`);
  console.log(` ArcPad Live:    ${deployResult.arcpadUrl || "https://arcpad.meme"}`);
  console.log(` Vault Log ID:   #${deployLogId}`);
  console.log("===============================================================================\n");
}

main().catch((err) => {
  logger.error(`Fatal error in ArcPad deployer: ${err?.message || err}`);
  console.error("Fatal error:", err);
  process.exit(1);
});
