#!/usr/bin/env bun
/**
 * scripts/harvest-creator-fees.ts
 *
 * Automated Creator Fee Harvester & Treasury Sweeper CLI.
 * Scans claimable 95% WETH royalties across confirmed tokens,
 * validates claim safety gates, and executes on-chain claims when threshold is reached.
 *
 * Usage:
 *   bun run scripts/harvest-creator-fees.ts              # Scan and report fee accruals
 *   bun run scripts/harvest-creator-fees.ts --claim      # Execute claim if threshold met
 *   bun run scripts/harvest-creator-fees.ts --force      # Execute claim bypassing threshold
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { getAllDeployLogs } from "../src/db/vault.ts";
import { getWalletAccount, bootstrapDefaultWallet } from "../src/modules/identity/wallet-manager.ts";
import { scanCreatorFees } from "../src/modules/treasury/fee-scanner.ts";
import { claimAvailableFee } from "../src/modules/treasury/fee-claimer.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldClaim = args.includes("--claim") || args.includes("--force");
  const forceClaim = args.includes("--force");

  console.log(`
=================================================================
  [+] CREATOR FEE HARVESTER & TREASURY SWEEPER (95% WETH) [+]
=================================================================
  Action: ${shouldClaim ? (forceClaim ? "EXECUTE CLAIM (FORCE)" : "EXECUTE CLAIM (IF THRESHOLD MET)") : "READ-ONLY SCAN"}
=================================================================
`);

  const cfg = getConfig();
  if (!cfg.BANKR_API_KEY) {
    logger.error("❌ BANKR_API_KEY belum dikonfigurasi.");
    process.exit(1);
  }

  // Ensure default wallet is bootstrapped
  getWalletAccount("default-operator") ?? bootstrapDefaultWallet();

  logger.info(`🔍 Menjalankan scan creator fee di seluruh armada token Base...`);
  const feeEvents = await scanCreatorFees({ chain: "base" });

  let totalClaimableWeth = 0;

  if (feeEvents.length === 0) {
    logger.info("   Tidak ada saldo royalti yang baru terdeteksi.");
  }

  for (const fee of feeEvents) {
    totalClaimableWeth += fee.amountFormatted;
    logger.info(`   Token        : $${fee.tokenSymbol} (${fee.tokenAddress})`);
    logger.info(`   Fee Asset    : ${fee.tokenSymbol}`);
    logger.info(`   Claimable    : ${fee.amountFormatted.toFixed(6)} ${fee.tokenSymbol}`);
    logger.info(`   Beneficiary  : ${fee.beneficiaryAddress}`);
    logger.info(`   Fee Event ID : #${fee.id}`);
    logger.info(`   Status       : ${fee.status}`);

    if (shouldClaim && fee.status === "claimable") {
          const threshold = cfg.TREASURY_MIN_CLAIM_ETH ?? 0.005;
          if (!forceClaim && fee.amountFormatted < threshold) {
            logger.warn(`   ⏭️ Melewati klaim: ${fee.amountFormatted} < threshold (${threshold} ETH). Gunakan --force untuk memaksakan klaim.`);
            continue;
          }

          logger.info(`   ⚡ Mengeksekusi penarikan fee on-chain via Bankr Relayer...`);
          const claimRes = await claimAvailableFee(fee.id, {
            executeOnchain: true,
            ignoreMinThreshold: forceClaim,
          });

          if (claimRes.success) {
            logger.success(`   🎉 Klaim Berhasil! TxHash: ${claimRes.claimTxHash}`);
          } else {
            logger.warn(`   ⚠️ Klaim dilewati atau gagal: ${claimRes.error}`);
          }
        }
  }

  console.log(`
-----------------------------------------------------------------
  Total Saldo Royalti Siap Panen: ${totalClaimableWeth.toFixed(6)} WETH
=================================================================
`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(`Fatal Harvester error: ${err?.message || err}`);
      process.exit(1);
    });
}
