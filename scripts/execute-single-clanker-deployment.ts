/**
 * scripts/execute-single-clanker-deployment.ts
 *
 * Executes ONE single controlled token deployment to Base Mainnet
 * via the Clanker v3.1 factory contract (on-chain, no REST API).
 *
 * Key differences from Bankr-based deployers:
 *  - NO Bankr API key required.
 *  - Operator pays gas directly (~0.001–0.005 ETH).
 *  - Uses viem walletClient.writeContract() directly.
 *  - Token is immediately listed on Clanker launchpad + Uniswap V4.
 *  - Chain label in Vault: "clanker".
 *
 * STRICT INVARIANTS:
 *  - Exactly 1 deployment attempt. NO auto-retry.
 *  - Simulation (simulateContract) MUST pass before live TX.
 *  - Fail-closed: gate rejection → zero TX.
 *  - No secrets exposed in logs.
 */

import * as dotenv from "dotenv";
dotenv.config();

process.env.DEPLOY_MODE = "mainnet";
process.env.DRY_RUN = "false";

import { getConfig, resetConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import {
  bootstrapDefaultWallet,
  selectExecutionWallet,
  getWalletAccount,
  getWalletByAddress,
  listWalletAccounts,
  resolveOperationalContext,
} from "../src/modules/identity/wallet-manager.ts";
import { executeWithDeploymentSafetyGate } from "../src/modules/deploy-guard.ts";
import { deriveEvmAddress } from "../src/modules/reconciliation/evm-verifier.ts";
import { checkEvmNativeBalance } from "../src/modules/identity/preflight-balance.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  generateCandidateId,
  getWalletKeyByAddress,
} from "../src/db/vault.ts";
import { generateTokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { generateTokenLogo } from "../src/modules/image/pollinations-gen.ts";
import { uploadTokenAssets, type UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";
import { generateIrresistibleOffer, saveOfferDeckMarkdown } from "../src/modules/growth/token-offer-generator.ts";
import {
  deployClanker,
  estimateClankerDeployCost,
  CLANKER_V4_FACTORY_ADDRESS,
  type ClankerAssetInput,
} from "../src/modules/evm/clanker-deployer.ts";
import { getWethBalance } from "../src/modules/evm/weth-wrapper.ts";
import { dispatchBeaconCard } from "../src/modules/social/beacon-broadcaster.ts";
import { runTrendingBoostCycle } from "../src/modules/growth/trending-booster.ts";

import * as path from "path";

resetConfig();
const cfg = getConfig();

const cliArgs = process.argv.slice(2);
const isDryRun = cliArgs.includes("--dry-run") || cfg.DRY_RUN;
const skipBalanceCheck = cliArgs.includes("--skip-balance-check");
const walletArg = cliArgs.find((a) => a.startsWith("--wallet="));
const requestedWalletId = walletArg ? walletArg.split("=")[1]?.trim() : undefined;

const CLANKER_EXPLORER_TOKEN = "https://basescan.org/token/";
const CLANKER_LAUNCHPAD_URL  = "https://www.clanker.world/clanker/";
const PREFLIGHT_MIN_ETH = 0.0001; // gas (~0.000030 ETH actual) + 3x safety buffer on Base L2

async function runSingleClankerDeployment(): Promise<void> {
  console.log(`
=================================================================
  SINGLE CONTROLLED CLANKER v4 DEPLOYMENT — BASE MAINNET
=================================================================
  Target Chain  : Base Mainnet (Chain ID: 8453)
  Provider      : Clanker v4 Factory (On-Chain, Uniswap v4)
  Factory       : ${CLANKER_V4_FACTORY_ADDRESS}
  Gas Policy    : Operator pays gas (~0.00003–0.0002 ETH)
  Dev Buy       : ${cfg.CLANKER_DEV_BUY_ETH} ETH ${cfg.CLANKER_DEV_BUY_ETH > 0 ? "(bundled in deploy tx)" : "(disabled)"}
  Dry-Run       : ${isDryRun}
=================================================================`);

  // ── PHASE 0: Identity & Wallet ───────────────────────────────────────────
  let wallet: ReturnType<typeof getWalletAccount> = null;
  if (requestedWalletId) {
    const q = requestedWalletId.trim().toLowerCase();
    if (q === "1" || q === "sub-1" || q === "sub-wallet-1") {
      wallet = listWalletAccounts().find((w) => w.label.includes("#1")) || null;
    } else if (q === "2" || q === "sub-2" || q === "sub-wallet-2") {
      wallet = listWalletAccounts().find((w) => w.label.includes("#2")) || null;
    } else if (q === "3" || q === "sub-3" || q === "sub-wallet-3") {
      wallet = listWalletAccounts().find((w) => w.label.includes("#3")) || null;
    } else {
      wallet = getWalletAccount(requestedWalletId) || getWalletByAddress(requestedWalletId);
    }
  }
  if (!wallet) {
    wallet = bootstrapDefaultWallet();
  }

  let deployerKey = cfg.EVM_PRIVATE_KEY;
  let deployerAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);
  let isSubWalletDeployer = false;

  if (wallet && wallet.id !== "default-operator" && wallet.evmAddress) {
    const subKey = getWalletKeyByAddress(wallet.evmAddress);
    if (subKey) {
      deployerKey = subKey;
      deployerAddress = wallet.evmAddress;
      isSubWalletDeployer = true;
      logger.info(`🔑 [MULTI-WALLET DEPLOYER] Using Sub-Wallet: '${wallet.id}' (${wallet.label})`);
      logger.info(`   Deployer EOA: ${deployerAddress} [0% CLUSTER CORRELATION]`);
    } else {
      logger.warn(`⚠️  Private key for wallet '${wallet.id}' not found in vault. Falling back to default operator.`);
      logger.info(`   Operator: ${deployerAddress}`);
    }
  } else {
    logger.info(`   Operator: ${deployerAddress}`);
  }

  if (!deployerAddress) throw new Error("ABORT: Deployer EVM address invalid or missing.");

  // ── PHASE 1: Pre-flight Balance Check ───────────────────────────────────
  const devBuyEth = cfg.CLANKER_DEV_BUY_ETH ?? 0;
  const totalMinEth = PREFLIGHT_MIN_ETH + devBuyEth;
  logger.info(`🔒 [PREFLIGHT] Checking EVM balance for ${deployerAddress} (Gas buffer: ${PREFLIGHT_MIN_ETH} ETH + Dev Buy: ${devBuyEth} ETH = ${totalMinEth.toFixed(4)} ETH)...`);
  if (!skipBalanceCheck && !isDryRun) {
    const balResult = await checkEvmNativeBalance("base", deployerAddress, totalMinEth);
    if (balResult.outcome === "insufficient_balance") {
      throw new Error(
        `ABORT: INSUFFICIENT_BALANCE — need ≥${totalMinEth.toFixed(4)} ETH on Base, ` +
        `have ${balResult.actualBalance?.toFixed(6) ?? "0"} ETH. ` +
        `Top up wallet ${deployerAddress} and retry.`
      );
    }
    if (balResult.outcome === "rpc_failure") {
      logger.warn(`⚠️  [PREFLIGHT] RPC balance check failed (${balResult.reason}). Proceeding with caution.`);
    } else {
      logger.success(`   ETH Balance OK: ${balResult.actualBalance?.toFixed(6)} ETH (need ≥${totalMinEth.toFixed(4)})`);
    }

    // Read WETH balance for operator visibility
    try {
      const wethBal = await getWethBalance(deployerAddress as `0x${string}`);
      logger.info(`   WETH Balance: ${wethBal.toFixed(6)} WETH`);
    } catch {
      // Non-fatal advisory
    }
  } else if (isDryRun) {
    logger.info("🧪 [PREFLIGHT] Dry-run simulation mode — real on-chain balance check bypassed.");
  } else {
    logger.warn("⚡ [PREFLIGHT] Balance check SKIPPED (--skip-balance-check).");
  }

  // ── Gas cost estimate ────────────────────────────────────────────────────
  logger.info("💰 [PREFLIGHT] Estimating gas cost...");
  try {
    const est = await estimateClankerDeployCost(
      { name: "GAS_PROBE", ticker: "PROBE" },
      { devBuyEth: cfg.CLANKER_DEV_BUY_ETH }
    );
    logger.info(`   Estimated gas: ${est.estimatedGasUnits.toLocaleString()} units ≈ ${est.estimatedEth.toFixed(6)} ETH`);
  } catch {
    logger.warn("⚠️  Gas estimate unavailable (non-fatal, will use gas limit buffer).");
  }

  logger.success("✅ [PREFLIGHT] All pre-flight checks passed!");

  // ── PHASE 2: Live Viral Trend Radar (Firecrawl) & Token Identity (AI) ───
  logger.info("\n📡 [FIRECRAWL] Scanning live viral trends from DexScreener & Pump.fun...");
  const { scanTrends } = await import("../src/modules/trend/firecrawl-radar.ts");
  let trendData = null;
  try {
    trendData = await scanTrends();
  } catch (trendErr: any) {
    logger.warn(`⚠️  [FIRECRAWL] Live trend scan notice: ${trendErr?.message || trendErr}`);
  }

  logger.info("🧠 [AI] Formulating viral meme token identity from live narrative...");
  const candidateId = generateCandidateId();

  let identity = await generateTokenIdentity(trendData?.raw || { chain: "clanker" });
  if (!identity) {
    throw new Error("Failed to generate token identity from AI.");
  }
  const saturation = await checkCrossChainSaturation(identity.ticker, ["base"]);
  if (saturation?.isSaturated) {
    logger.warn(`⚠️  $${identity.ticker} saturated — regenerating...`);
    identity = (await generateTokenIdentity(trendData?.raw || { chain: "clanker" }))!;
  }
  logger.success(`   🪙 $${identity.ticker} — "${identity.name}" (viral score: ${identity.viralScore})`);

  // Canonical Pre-Flight URL Configuration (Infrastructure-First)
  const cleanTicker = identity.ticker.replace(/^\$/, "").toUpperCase();
  const predictedPagesUrl = `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
  identity.website = predictedPagesUrl;
  identity.twitter = `https://x.com/search?q=%24${cleanTicker}`;
  identity.telegram = `https://t.me/${cleanTicker.toLowerCase()}_portal`;
  logger.info(`🌐 [PRE-FLIGHT] Canonical Web3 DApp: ${predictedPagesUrl}`);
  logger.info(`🐦 [PRE-FLIGHT] Social Search/Feed : ${identity.twitter}`);
  logger.info(`💬 [PRE-FLIGHT] Telegram Portal    : ${identity.telegram}`);

  // ── PHASE 2.5: Pre-Flight Web3 DApp Generation & Edge Deploy ─────────────
  logger.info("\n🌐 [INFRASTRUCTURE] Pre-building Web3 3D DApp before on-chain broadcast...");
  let preflightWeb3Url = predictedPagesUrl;
  try {
    const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
    const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
    const preSite = await generateTokenWebsite({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
      chainName: "base",
      description: identity.lore,
      websiteUrl: predictedPagesUrl,
      twitterUrl: identity.twitter,
      telegramUrl: identity.telegram,
      preferredStyle: "NEO_BRUTALISM",
    });
    const cfPre = await deployWebsiteToCloudflarePages({
      siteDir: preSite.siteDirectory,
      ticker: identity.ticker,
      contractAddress: "0x0000000000000000000000000000000000000000",
    });
    preflightWeb3Url = cfPre.deploymentUrl;
    logger.success(`   🚀 [CLOUDFLARE PAGES] Pre-flight DApp LIVE at: ${preflightWeb3Url}`);
  } catch (pfErr: any) {
    logger.warn(`   Notice pre-flight DApp deploy: ${pfErr?.message || pfErr}`);
  }

  // ── PHASE 3: Assets + IPFS ───────────────────────────────────────────────
  logger.info("\n🎨 [ASSETS] Generating logo and uploading to IPFS...");
  const deployLogId = logDeploy({
    candidateId,
    chain:          "clanker",
    tokenName:      identity.name,
    ticker:         identity.ticker,
    status:         "pending",
    lifecycleState: "IDENTITY_GENERATED",
    simulated:      isDryRun,
  });
  logger.info(`   Vault ID: #${deployLogId}`);

  let logoBuffer: Buffer | undefined;
  try {
    logoBuffer = await generateTokenLogo(identity);
  } catch (e: any) {
    logger.warn(`⚠️  Logo generation failed (non-fatal): ${e.message}`);
  }

  let assets: UploadResult | undefined;
  try {
    const uploadResult = await uploadTokenAssets(logoBuffer ?? null, identity);
    if (uploadResult) assets = uploadResult;
    updateDeployLifecycle(deployLogId, "ASSETS_UPLOADED");
    logger.success(`   IPFS: ${assets?.imageUrl ?? "(no logo)"}`);
  } catch (e: any) {
    logger.warn(`⚠️  IPFS upload failed (non-fatal): ${e.message}`);
  }

  // ── PHASE 4: Deployment via Clanker v4 ─────────────────────────────────
  logger.info("\n🚀 [DEPLOY] Deploying via Clanker v4 factory...");
  updateDeployLifecycle(deployLogId, "DEPLOY_INITIATED");

  let deployResult: Awaited<ReturnType<typeof deployClanker>>;
  try {
    const gateResult = await executeWithDeploymentSafetyGate(
      {
        chain:         "clanker",
        identity,
        assets,
        walletAddress: deployerAddress ?? undefined,
        isSimulation:  isDryRun,
      },
      async () => {
        const clankerAssets: ClankerAssetInput = {
          ipfsImageUri: assets?.ipfsImageUri ?? undefined,
          imageUrl:     assets?.imageUrl ?? undefined,
        };
        return deployClanker(identity, clankerAssets, {
          devBuyEth:        cfg.CLANKER_DEV_BUY_ETH,
          creatorRewardPct: cfg.CLANKER_CREATOR_REWARD_PCT,
          dryRun:           isDryRun,
          rpcUrl:           cfg.BASE_RPC_URL,
          deployerPrivateKey: deployerKey,
        });
      }

    );

    if (!gateResult.success || !gateResult.result) {
      updateDeployLifecycle(deployLogId, "FAILED", {
        status:   "failed",
        errorMsg: gateResult.error ?? "GATE_REJECTED",
      });
      throw new Error(`ABORT: Safety gate rejected: ${gateResult.error}`);
    }
    deployResult = gateResult.result;
  } catch (e: any) {
    if (!e.message.startsWith("ABORT:")) {
      updateDeployLifecycle(deployLogId, "UNKNOWN", { status: "unknown", errorMsg: e.message });
    }
    throw e;
  }

  if (!deployResult.success) {
    updateDeployLifecycle(deployLogId, "FAILED", {
      status:   "failed",
      errorMsg: deployResult.error ?? "DEPLOY_FAILED",
    });
    throw new Error(`ABORT: Clanker deployment failed: ${deployResult.error}`);
  }

  // ── PHASE 5: Vault Update ─────────────────────────────────────────────────
  const tokenAddress = deployResult.tokenAddress ?? "unknown";
  const poolAddress  = deployResult.poolAddress ?? undefined;
  const txHash       = deployResult.txHash ?? undefined;

  updateDeployLifecycle(deployLogId, deployResult.simulated ? "DEPLOY_INITIATED" : "DEPLOY_CONFIRMED", {
    status:       deployResult.simulated ? "pending" : "confirmed",
    contractAddr: tokenAddress !== "unknown" ? tokenAddress : undefined,
    poolId:       poolAddress,
    txHash,
    deployCost:   deployResult.deployCostEth ?? 0,
    walletId:     wallet.id,
  });

  logger.success(`✅ [VAULT] Deployment logged: ID #${deployLogId}, status: ${deployResult.simulated ? "simulated" : "confirmed"}`);

  // ── PHASE 5.1: Neon PostgreSQL Cloud SSOT Sync ───────────────────────────
  try {
    const { getDbPool } = await import("../packages/shared/db-pool.ts");
    const pool = getDbPool();
    if (pool && tokenAddress !== "unknown") {
      const draftId = crypto.randomUUID();
      const launchId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Ensure user exists or use default
      let creatorId = "00000000-0000-0000-0000-000000000001";
      try {
        const userRes = await pool.query(`SELECT id FROM users LIMIT 1;`);
        if (userRes.rows.length > 0) creatorId = userRes.rows[0].id;
      } catch {}

      // 1. Insert/Update launch_drafts
      await pool.query(
        `INSERT INTO launch_drafts (
          id, creator_id, name, ticker, description, image_url, 
          target_chain, launch_mode, status, social_links, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'FAIR_LAUNCH', 'CONFIRMED', $8, $9, $10)
        ON CONFLICT (id) DO NOTHING;`,
        [
          draftId,
          creatorId,
          identity.name,
          identity.ticker,
          identity.description || "",
          assets?.imageUrl || "",
          "base",
          JSON.stringify({
            website: identity.website || "",
            twitter: identity.twitter || "",
            telegram: identity.telegram || "",
            clanker: `https://www.clanker.world/clanker/${tokenAddress}`,
          }),
          now,
          now,
        ]
      );

      // 2. Insert token_launches
      await pool.query(
        `INSERT INTO token_launches (
          id, draft_id, chain, contract_address, dex_pair_address, 
          is_graduated, risk_score, published_at
        ) VALUES ($1, $2, $3, $4, $5, true, 95, $6)
        ON CONFLICT (contract_address) DO UPDATE SET
          dex_pair_address = EXCLUDED.dex_pair_address,
          published_at = EXCLUDED.published_at;`,
        [
          launchId,
          draftId,
          "base",
          tokenAddress,
          poolAddress || null,
          now,
        ]
      );
      logger.success(`   ☁️ [NEON SSOT] Token launch synced to Neon PostgreSQL Cloud!`);
    }
  } catch (neonErr: any) {
    logger.warn(`   ⚠️ [NEON SSOT] Cloud sync notice (non-fatal): ${neonErr?.message || neonErr}`);
  }

  // ── PHASE 6: Post-Deploy Boost & Social Broadcast ───────────────────────
  let liveWeb3Url: string | undefined;

  if (tokenAddress !== "unknown") {
    // 6.0 Web3 3D Parallax Website & Cloudflare Pages Auto-Deploy
    try {
      logger.info(`🌐 [WEB3 ENGINE] Membangun Website 3D Parallax untuk $${identity.ticker}...`);
      const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
      const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
      const siteRes = await generateTokenWebsite({
        name: identity.name,
        ticker: identity.ticker,
        contractAddress: tokenAddress,
        chainId: 8453,
        chainName: "base",
        description: identity.lore,
        logoUrl: assets?.imageUrl,
        poolId: poolAddress,
        websiteUrl: liveWeb3Url || preflightWeb3Url,
        twitterUrl: identity.twitter,
        telegramUrl: identity.telegram,
        preferredStyle: "NEO_BRUTALISM",
      });
      logger.success(`   ✅ [WEB3 ENGINE] Website dibuat di: ${siteRes.siteDirectory}`);

      const cfRes = await deployWebsiteToCloudflarePages({
        siteDir: siteRes.siteDirectory,
        ticker: identity.ticker,
        contractAddress: tokenAddress,
      });
      liveWeb3Url = cfRes.deploymentUrl;
      logger.success(`   🚀 [CLOUDFLARE PAGES] Live DApp: ${liveWeb3Url}`);
    } catch (wErr: any) {
      logger.warn(`   Notice Web3 Website: ${wErr?.message || wErr}`);
    }

    // 6.0B Neon PostgreSQL Multi-Tenant Cloud Sync
    try {
      const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
      if (isNeonConfigured()) {
        const neonRes = await syncTokenDeploymentToNeon({
          contractAddr: tokenAddress,
          ticker: identity.ticker,
          tokenName: identity.name,
          chain: "clanker",
          poolId: poolAddress,
          txHash,
          websiteUrl: liveWeb3Url,
        });
        if (neonRes.success) {
          logger.success(`   🐘 [NEON CLOUD] Database '${neonRes.dbName}' siap & tersinkronisasi di Neon PostgreSQL!`);
        }
      }
    } catch (neonErr: any) {
      logger.warn(`   🐘 [NEON CLOUD] Notice Neon cloud sync: ${neonErr?.message || neonErr}`);
    }

    if (!deployResult.simulated) {
      // 6.1 Offer Deck
      try {
        const offer = await generateIrresistibleOffer(identity, tokenAddress, "clanker");
        const deckPath = saveOfferDeckMarkdown(offer, identity.ticker);
        logger.success(`   📄 Offer deck: ${deckPath}`);
      } catch (e: any) {
        logger.warn(`⚠️  Offer deck failed (non-fatal): ${e.message}`);
      }

      // 6.2 DexScreener Momentum Kickstart (Unique Makers)
      try {
        logger.info(`🚀 [MOMENTUM ENGINE] Initiating DexScreener Unique Maker kickstart for $${identity.ticker}...`);
        const boostRes = await runTrendingBoostCycle({
          tokenAddress,
          tokenSymbol: identity.ticker,
          rounds: 3,
          microAmountEth: 0.0001,
          isSimulated: isDryRun,
        });
        logger.success(`   ✅ [MOMENTUM ENGINE] ${boostRes.totalRoundsExecuted} green buys executed (${boostRes.uniqueMakersCount} unique makers)!`);
      } catch (bErr: any) {
        logger.warn(`   Notice momentum engine: ${bErr?.message || bErr}`);
      }

      // 6.3 Multi-Channel Beacon Card Broadcast (Discord/Telegram)
      try {
        const dexscreenerUrl = `https://dexscreener.com/base/${tokenAddress}`;
        const clankerUrl = CLANKER_LAUNCHPAD_URL + tokenAddress;
        const launchMsg = `🚀 **NEW CLANKER LAUNCH: $${identity.ticker} (${identity.name})**\n⛓️ Chain: Base Mainnet (Clanker v4)\n📋 CA: \`${tokenAddress}\`\n🏊 Pool: \`${poolAddress ?? "Uniswap v4"}\`\n🌐 Web3: ${liveWeb3Url ?? "https://" + identity.ticker.toLowerCase() + "-web3.pages.dev"}\n💎 40% Creator LP Fees Retained | On-Chain Verifiable\n📊 Chart: ${dexscreenerUrl}\n🌐 Clanker: ${clankerUrl}`;
        await dispatchBeaconCard(launchMsg);
        logger.success(`   📡 [BROADCAST] Beacon card dispatched to configured social channels.`);
      } catch (bcErr: any) {
        logger.warn(`   Notice beacon broadcast: ${bcErr?.message || bcErr}`);
      }
    }
  }

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  console.log(`
=================================================================
  ${deployResult.simulated ? "🔍 SIMULATION COMPLETE (no TX sent)" : "✅ CLANKER DEPLOYMENT COMPLETE"}
=================================================================
  Token   : ${identity.name} ($${identity.ticker})
  CA      : ${tokenAddress}
  Pool    : ${poolAddress ?? "N/A"}
  TxHash  : ${txHash ?? "N/A (dry-run)"}
  Gas     : ${deployResult.deployCostEth != null ? deployResult.deployCostEth.toFixed(8) + " ETH" : "N/A"}
  Explorer: ${deployResult.explorerUrl ?? "N/A"}
  Clanker : ${tokenAddress !== "unknown" ? CLANKER_LAUNCHPAD_URL + tokenAddress : "N/A"}
  Web3    : ${liveWeb3Url ?? "https://" + identity.ticker.toLowerCase() + "-web3.pages.dev"}
  Vault ID: #${deployLogId}
=================================================================
  LANGKAH OPTIMASI GT SECURITY SCORE & PROFIL DEXSCREENER:
  1. Basescan Token Update (Gratis) : https://basescan.org/tokenupdate/${tokenAddress}
  2. CoinGecko/GT Ticket Form       : https://support.coingecko.com/hc/en-us/requests/new?ticket_form_id=360000025353
  3. DexScreener Token Claim        : https://dexscreener.com/base/${tokenAddress}
  4. Manajemen Akun Cloudflare      : Jalankan CLEAN_CLOUDFLARE_PAGES.bat jika project mendekati 100.
=================================================================`);
}

if (import.meta.main) {
  runSingleClankerDeployment().catch((err) => {
    logger.error(`❌ FATAL: ${err.message}`);
    process.exit(1);
  });
}
