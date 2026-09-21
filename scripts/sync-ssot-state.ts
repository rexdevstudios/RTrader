#!/usr/bin/env bun
/**
 * scripts/sync-ssot-state.ts
 *
 * Idempotent SSOT State Synchronizer.
 * Synchronizes confirmed on-chain tokens (such as $PUMPRUN on Base Mainnet)
 * into SQLite vault.db and ensures bidirectional alignment with Neon Cloud SSOT.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { Database } from "bun:sqlite";
import {
  DB_PATH,
  getDeployLogByContract,
  logDeploy,
  createPendingPosition,
  transitionPositionState,
} from "../src/db/vault.ts";
import { exportVaultDeployments } from "./export-deployment-state.ts";
import { logger } from "../src/logger.ts";

export async function syncConfirmedPUMPRUN(): Promise<{
  deployLogId: number;
  positionCreated: boolean;
}> {
  const ca = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
  const ticker = "PUMPRUN";
  const name = "Pump Hill Runner";
  const chain = "base";
  const poolId = "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9";
  const websiteUrl = "https://pumprun-web3.pages.dev";
  const deployTx = "0x64cf510b6fe9fbfa56fa7b120f2b3ecbb93e36e1f0e4bbf45145b38a7e0c4a45";
  const buyTx = "0x4c95635c35bbfb37cef792ee596b64afc45c3f303ae124f6080c36d2ba55e0a1";
  const operatorWallet = "0x946657D17C7e83052D50634D9dA6FF3Fc46b418a";

  logger.info(`[SSOT-SYNC] Checking deployment record for $${ticker} (${ca})...`);
  let existing = getDeployLogByContract(ca);
  let deployLogId: number;

  if (!existing) {
    deployLogId = logDeploy({
      chain,
      tokenName: name,
      ticker,
      contractAddr: ca,
      txHash: deployTx,
      status: "confirmed",
      lifecycleState: "DEPLOY_CONFIRMED",
      poolId,
      websiteUrl,
      walletId: "default-operator",
      simulated: false,
      attributionStatus: "transaction_verified",
      attributionReason: "Confirmed Base Mainnet Doppler v4 deployment",
    });
    logger.success(`[SSOT-SYNC] Successfully inserted $${ticker} into deploy_logs (ID: ${deployLogId})`);
  } else {
    deployLogId = existing.id;
    logger.info(`[SSOT-SYNC] $${ticker} already exists in deploy_logs (ID: ${deployLogId})`);
  }

  // Check active_positions
  const db = new Database(DB_PATH);
  const posRow = db
    .query(`SELECT id, status FROM active_positions WHERE contract_addr = ?`)
    .get(ca) as { id: number; status: string } | null;

  let positionCreated = false;
  if (!posRow) {
    createPendingPosition({
      deployLogId,
      chain,
      contractAddr: ca,
      ticker,
      snipeAmount: 19363040.62,
      takeProfitX: 1.5,
      stopLossPct: 0.30,
      walletAddress: operatorWallet,
      deploymentTxHash: deployTx,
      balanceBefore: "0",
    });

    transitionPositionState(ca, "buy_submitted", "open", {
      entryPrice: 0.00000002450,
      currentBalance: "19363040620000000000000000",
      reconciliationStatus: "confirmed",
      attributionStatus: "transaction_verified",
    });

    // Update buy_tx_hash
    db.run(`UPDATE active_positions SET buy_tx_hash = ? WHERE contract_addr = ?`, [buyTx, ca]);

    logger.success(`[SSOT-SYNC] Successfully recorded active position for $${ticker} (19,363,040.62 tokens)`);
    positionCreated = true;
  } else {
    logger.info(`[SSOT-SYNC] Active position already exists for $${ticker} (Status: ${posRow.status})`);
  }

  // Export state to deployments/ directory for persistent artifact storage
  exportVaultDeployments();

  return { deployLogId, positionCreated };
}

if (import.meta.main) {
  syncConfirmedPUMPRUN()
    .then((res) => {
      console.log(`\n=================================================================`);
      console.log(`[+] SSOT SYNCHRONIZATION COMPLETE [+]`);
      console.log(`Deploy Log ID: ${res.deployLogId}`);
      console.log(`Position Synced: ${res.positionCreated ? "NEWLY CREATED" : "ALREADY PRESENT"}`);
      console.log(`=================================================================\n`);
    })
    .catch((err) => {
      logger.error(`[SSOT-SYNC] Error during synchronization: ${err}`);
      process.exit(1);
    });
}
