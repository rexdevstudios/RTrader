#!/usr/bin/env bun
/**
 * scripts/generate-affiliate-link.ts
 *
 * Community Referral & Affiliate Link Generator.
 *
 * Produces:
 *  1. Custom DexScreener referral links.
 *  2. Ready-to-tweet viral shill templates with embedded on-chain referral tag.
 *  3. Queries current accumulated WETH bounty stats for the affiliate.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getAllDeployLogs, getAffiliateStats } from "../src/db/vault.ts";
import { generateReferralLink } from "../src/modules/growth/flywheel-engine.ts";
import { logger } from "../src/logger.ts";
import { getConfig } from "../src/config.ts";
import { privateKeyToAccount } from "viem/accounts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let affiliateAddress = args[0];
  let tokenCa = args[1];

  console.log(`
=================================================================
  [+] ON-CHAIN AFFILIATE & REFERRAL BOUNTY GENERATOR (5% WETH) [+]
=================================================================
  Share this link with your community / followers!
  Every buy routed through your link earns you 5% WETH instantly.
=================================================================
`);

  // If no token CA provided, select the latest active token on Base
  let targetTicker = "TOKEN";
  let targetName = "Meme Gem";
  let targetChain = "Base L2";

  if (!tokenCa) {
    const deploys = getAllDeployLogs().filter(
      (d) => d.chain === "base" && !d.simulated && d.contractAddr && d.contractAddr.startsWith("0x")
    );

    if (deploys.length === 0) {
      const anyDeploys = getAllDeployLogs().filter((d) => d.contractAddr);
      if (anyDeploys.length === 0) {
        logger.error("[ERROR] No active token found in database. Please specify a CA.");
        process.exit(1);
      }
      tokenCa = anyDeploys[0].contractAddr!;
      targetTicker = anyDeploys[0].ticker || "TOKEN";
      targetName = anyDeploys[0].tokenName || "Meme Gem";
      targetChain = anyDeploys[0].chain.toUpperCase();
    } else {
      tokenCa = deploys[0].contractAddr!;
      targetTicker = deploys[0].ticker || "TOKEN";
      targetName = deploys[0].tokenName || "Meme Gem";
      targetChain = "Base L2";
    }
  } else {
    const matched = getAllDeployLogs().filter(
      (d) => d.contractAddr && d.contractAddr.toLowerCase() === tokenCa.toLowerCase()
    );
    if (matched.length > 0) {
      targetTicker = matched[0].ticker || "TOKEN";
      targetName = matched[0].tokenName || "Meme Gem";
      targetChain = matched[0].chain.toUpperCase();
    }
  }

  // If no affiliate address provided, auto-resolve operator EVM address
  if (!affiliateAddress) {
    try {
      const cfg = getConfig();
      if (cfg.EVM_PRIVATE_KEY && cfg.EVM_PRIVATE_KEY.startsWith("0x") && cfg.EVM_PRIVATE_KEY.length === 66) {
        affiliateAddress = privateKeyToAccount(cfg.EVM_PRIVATE_KEY as `0x${string}`).address;
      }
    } catch {
      // Fallback
    }
    if (!affiliateAddress) {
      affiliateAddress = "0xYourWalletAddressHere";
    }
  }

  const refUrl = generateReferralLink(tokenCa, affiliateAddress);

  // Check existing stats in SQLite
  const stats = getAffiliateStats(affiliateAddress, tokenCa);

  console.log(`
[TARGET TOKEN]      : $${targetTicker} (${targetName})
[TARGET CHAIN]      : ${targetChain}
[TARGET CA]         : ${tokenCa}
[AFFILIATE WALLET]  : ${affiliateAddress}
[REFERRAL LINK]     : ${refUrl}

[PERFORMANCE STATS] :
  - Total WETH Bounty Earned : ${(stats?.bountyEarnedWeth ?? 0).toFixed(6)} WETH
  - Total Volume Routed      : ${(stats?.volumeRoutedWeth ?? 0).toFixed(6)} WETH
  - Total Successful Claims  : ${stats?.claimCount ?? 0} kali
  - Last Reward Recorded     : ${stats?.lastClaimedAt ?? "Belum ada transaksi"}

-----------------------------------------------------------------
[TEMPLATE] READY-TO-POST SHILL TEMPLATE (COPY-PASTE FOR TWITTER/TELEGRAM):
-----------------------------------------------------------------
Found an actual unruggable alpha gem on ${targetChain}!

$${targetTicker} (${targetName}) has 0% tax, 100/100 safe score, and an autonomous WETH Flywheel:
- 30% of all swap fees auto BUYBACK and BURN token floor!
- 20% passive WETH dividends distributed to holders!
- 10-Min FOMO Jackpot for the last buyer!

Chart & Swap through my verified link:
${refUrl}
-----------------------------------------------------------------
`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(`Error: ${err?.message || err}`);
      process.exit(1);
    });
}
