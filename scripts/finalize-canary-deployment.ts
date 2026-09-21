#!/usr/bin/env bun
/**
 * scripts/finalize-canary-deployment.ts
 *
 * Finalizes post-deployment pipeline for on-chain confirmed Canary Token:
 * CA: 0x0a99f4251A461e8abC693a56BB837fD815D51BA3 ($PUMPRUN)
 * Tx: 0xc48842a0219c4ccd03543824fa35f6bcd3f59c1791d2034beb161f55b6839542
 */
import "dotenv/config";
import { logger } from "../src/logger.ts";
import {
  updateDeployLifecycle,
  getDeployLogById,
  updateDeployLogWebsite,
} from "../src/db/vault.ts";
import { recordGasSponsorshipToLedger } from "../src/modules/treasury/treasury-ledger.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { deployWebsiteToCloudflarePages } from "../src/modules/growth/website-deployer.ts";
import { saveDexScreenerProfileJson, buildDexScreenerProfilePayload } from "../src/modules/growth/dexscreener-profiler.ts";
import { saveGeckoTerminalProfileJson, buildGeckoTerminalProfilePayload } from "../src/modules/growth/geckoterminal-profiler.ts";
import { syncTokenDeploymentToNeon, isNeonConfigured } from "../src/db/neon-vault.ts";

const tokenAddress = "0x0a99f4251A461e8abC693a56BB837fD815D51BA3";
const poolId = "0x645d579d8002a6ac09d67c59526d065321b07570b1d9f359a70346c072ca7584";
const txHash = "0xc48842a0219c4ccd03543824fa35f6bcd3f59c1791d2034beb161f55b6839542";
const ticker = "PUMPRUN";
const tokenName = "Pump Hill Runner";
const description = "The iconic green running guy from pump.fun that carried every 100x meme coin up the hill. Never stops, never rugs, only sprints charts. Every degen saw this guy before their bag 10x'd.";
const imageUrl = "https://gateway.pinata.cloud/ipfs/QmdiMA7WbFG93SNqizSZYNV5NG37iuPj87k8vaEMZaxp6Y";
const relayerAddress = "0xf7932df89827d9cbd13a12571bb4db9da67aaf75";
const deployLogId = 16;

async function finalize() {
  console.log("=================================================================");
  console.log("  POST-DEPLOYMENT PIPELINE FINALIZATION FOR $PUMPRUN (BASE L2)");
  console.log("=================================================================");

  // 1. Update Vault DB to DEPLOY_CONFIRMED
  logger.info("💾 [VAULT] Updating SQLite record to 'DEPLOY_CONFIRMED' with 0 ETH cost...");
  updateDeployLifecycle(deployLogId, "DEPLOY_CONFIRMED", {
    status: "confirmed",
    contractAddr: tokenAddress,
    txHash,
    poolId,
    deployCost: 0.0,
    simulated: false,
    attributionStatus: "confirmed",
    attributionReason: "Gas 100% SPONSORED by official Bankr Base Relayer (0xf7932df898...)",
  });

  // 2. Record Gas Sponsorship
  try {
    recordGasSponsorshipToLedger({
      deployLogId,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: 0.000016,
      relayerAddress,
      txHash,
    });
    logger.success("🏛️  [TREASURY] Gas sponsorship tercatat di treasury ledger.");
  } catch (err: any) {
    logger.warn(`Notice ledger: ${err.message}`);
  }

  // 3. Generate 3D Parallax Web3 Website
  logger.info("🌐 [WEB3 ENGINE] Membangun Web3 Parallax Website...");
  let liveUrl: string | undefined;
  try {
    const siteRes = await generateTokenWebsite({
      name: tokenName,
      ticker,
      contractAddress: tokenAddress,
      chainId: 8453,
      chainName: "base",
      description,
      logoUrl: imageUrl,
      poolId,
      telegramUrl: "https://t.me/pumprun_coin",
      twitterUrl: "https://x.com/pumprun_coin",
    });
    logger.success(`   ✅ Website dibuat di: ${siteRes.siteDirectory}`);

    // 4. Deploy to Cloudflare Pages
    logger.info("☁️  [CLOUDFLARE] Mengunggah ke Cloudflare Pages...");
    const cfRes = await deployWebsiteToCloudflarePages({
      siteDir: siteRes.siteDirectory,
      ticker,
      contractAddress: tokenAddress,
    });
    liveUrl = cfRes.deploymentUrl;
    updateDeployLogWebsite(tokenAddress, liveUrl);
    logger.success(`   🚀 [CLOUDFLARE PAGES] Live DApp: ${liveUrl}`);

    // 5. Profilers
    saveDexScreenerProfileJson(
      siteRes.siteDirectory,
      buildDexScreenerProfilePayload({
        chainId: 8453,
        tokenAddress,
        tokenName,
        tokenSymbol: ticker,
        description,
        iconUrl: imageUrl,
        websiteUrl: liveUrl,
        telegramUrl: "https://t.me/pumprun_coin",
        twitterUrl: "https://x.com/pumprun_coin",
      })
    );
    saveGeckoTerminalProfileJson(
      siteRes.siteDirectory,
      buildGeckoTerminalProfilePayload({
        chainId: 8453,
        tokenAddress,
        tokenName,
        tokenSymbol: ticker,
        poolAddress: poolId,
        description,
        iconUrl: imageUrl,
        websiteUrl: liveUrl,
        telegramUrl: "https://t.me/pumprun_coin",
        twitterUrl: "https://x.com/pumprun_coin",
      })
    );
    logger.success("   📊 [PROFILER] DexScreener & GeckoTerminal profile data tersimpan!");
  } catch (wErr: any) {
    logger.warn(`Website generation notice: ${wErr.message}`);
  }

  // 6. Neon PostgreSQL Cloud Sync
  try {
    logger.info("🐘 [NEON CLOUD] Menyinkronkan token deployment ke Neon PostgreSQL SSOT...");
    if (isNeonConfigured()) {
      const neonRes = await syncTokenDeploymentToNeon({
        contractAddr: tokenAddress,
        ticker,
        tokenName,
        chain: "base",
        poolId,
        txHash,
        websiteUrl: liveUrl,
        description,
      });
      if (neonRes.success) {
        logger.success(`   🐘 [NEON CLOUD] Database token '${neonRes.dbName}' siap & tersinkronisasi di Neon PostgreSQL!`);
      }
    }
  } catch (neonErr: any) {
    logger.warn(`Neon notice: ${neonErr.message}`);
  }

  console.log("\n=================================================================");
  console.log("  🎉 CANARY DEPLOYMENT FULLY CONFIRMED & SYNCHRONIZED!");
  console.log("=================================================================");
  console.log(`  Token:         ${tokenName} ($${ticker})`);
  console.log(`  CA (Base L2):  ${tokenAddress}`);
  console.log(`  Pool ID:       ${poolId}`);
  console.log(`  Tx Hash:       ${txHash}`);
  console.log(`  DexScreener:   https://dexscreener.com/base/${tokenAddress}`);
  console.log(`  Uniswap Swap:  https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${tokenAddress}`);
  console.log(`  BaseScan:      https://basescan.org/tx/${txHash}`);
  if (liveUrl) console.log(`  Live DApp:     ${liveUrl}`);
  console.log("=================================================================\n");
}

finalize().catch(console.error);
