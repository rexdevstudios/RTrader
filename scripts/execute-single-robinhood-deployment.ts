/**
 * scripts/execute-single-robinhood-deployment.ts
 *
 * Executes ONE single controlled token deployment to Robinhood Chain L2
 * via the official Bankr Token Launch API.
 *
 * Differences from execute-single-base-deployment.ts:
 *  - BANKR_CHAIN = "robinhood" (Robinhood Chain L2, Chain ID 4663)
 *  - Gas sponsorship gate is ADVISORY (Robinhood has no Base relayer equivalent yet)
 *  - Explorer: https://robinhoodchain.blockscout.com
 *  - All modules (vault, gemini-brain, pinata, deploy-guard) reused 100%.
 *
 * STRICT INVARIANTS (inherited):
 *  - Exactly 1 deployment attempt. NO auto-retry.
 *  - NO paid gas fallback, NO local private key broadcast.
 *  - Downstream sniper buy DISABLED.
 */

import * as dotenv from "dotenv";
dotenv.config();

// Must set BANKR_CHAIN BEFORE resetConfig() is called
process.env.BANKR_CHAIN = "robinhood";
process.env.DEPLOY_MODE = "mainnet";
process.env.BANKR_REQUIRE_GAS_SPONSORSHIP = "false";
process.env.BANKR_ALLOW_PAID_GAS_FALLBACK = "false";
process.env.BANKR_QUOTE_ONLY_FEES = "true";
process.env.BANKR_SIMULATE_ONLY = "false";
process.env.DRY_RUN = "false";

import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getConfig, resetConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import {
  deployViaBankr,
  getBankrHeaders,
  BANKR_DEPLOY_URL,
  buildAxiosProxyConfig,
} from "../src/modules/evm/bankr-deployer.ts";
import {
  bootstrapDefaultWallet,
  selectExecutionWallet,
  getWalletAccount,
  resolveOperationalContext,
  resolveCredential,
  autoFailoverUnhealthyRoutes,
} from "../src/modules/identity/wallet-manager.ts";
import {
  executeWithDeploymentSafetyGate,
} from "../src/modules/deploy-guard.ts";
import {
  verifyEvmTransactionReceipt,
  deriveEvmAddress,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  generateCandidateId,
} from "../src/db/vault.ts";
import { generateTokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { generateTokenLogo } from "../src/modules/image/pollinations-gen.ts";
import { uploadTokenAssets, type UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";
import { generateIrresistibleOffer, saveOfferDeckMarkdown } from "../src/modules/growth/token-offer-generator.ts";
import * as path from "path";

resetConfig();
const cfg = getConfig();

const ROBINHOOD_EXPLORER_TOKEN = "https://robinhoodchain.blockscout.com/token/";
const GECKOTERMINAL_ROBINHOOD = "https://www.geckoterminal.com/robinhood-chain/pools/";

const skipSimulationProbe = process.argv.includes("--skip-simulation-probe");

async function runSingleRobinhoodDeployment(): Promise<void> {
  console.log(`
=================================================================
  SINGLE CONTROLLED ROBINHOOD CHAIN L2 DEPLOYMENT
=================================================================
  Target Chain : Robinhood Chain L2 (Chain ID: 4663)
  Provider     : Bankr Token Launch API
  Gas Policy   : Advisory (no paid fallback)
=================================================================
`);

  // PHASE 0: Identity & Proxy
  logger.info("🔐 [IDENTITY] Resolving wallet and proxy...");
  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  const requestedWalletId = walletArg ? walletArg.split("=")[1]?.trim() : undefined;
  const wallet = requestedWalletId
    ? (getWalletAccount(requestedWalletId) ?? bootstrapDefaultWallet())
    : selectExecutionWallet({ requiredProvider: "bankr", targetChains: ["robinhood"] });

  let bankrContext = resolveOperationalContext(wallet.id, "bankr");
  if (!bankrContext.isUsable && bankrContext.proxy?.healthStatus !== "available") {
    try {
      const fr = await autoFailoverUnhealthyRoutes();
      if (fr.failoversExecuted > 0) bankrContext = resolveOperationalContext(wallet.id, "bankr");
    } catch { /* non-fatal */ }
  }

  if (!bankrContext.isUsable) {
    throw new Error(`ABORT: Operational identity unusable: ${bankrContext.unusableReason || "unknown"}`);
  }

  const axiosProxy = buildAxiosProxyConfig(bankrContext.proxyUrl ?? undefined);
  const httpsAgent = bankrContext.proxyUrl ? new HttpsProxyAgent(bankrContext.proxyUrl) : undefined;

  // PHASE 1: Pre-flight
  logger.info("🔒 [PREFLIGHT] Running gates...");
  let apiKey = bankrContext.credentialRef ? resolveCredential(bankrContext.credentialRef) : cfg.BANKR_API_KEY;
  if (!apiKey) throw new Error("ABORT: BANKR_API_KEY not configured.");
  const headers = getBankrHeaders(apiKey);

  // Gate 1: Auth
  logger.info("🔒 [PREFLIGHT 1/3] Verifying Bankr API auth...");
  try {
    const me = await axios.get("https://api.bankr.bot/me", { headers, timeout: cfg.API_TIMEOUT_MS, ...(axiosProxy && { proxy: axiosProxy }), ...(httpsAgent && { httpsAgent }) });
    logger.info(`   Auth OK — Custodial EVM: ${me.data?.address || "verified"}`);
  } catch (e: any) { throw new Error(`ABORT: BANKR_ACCOUNT_AUTH FAILED — ${e.message}`); }

  // Gate 2: EVM wallet
  logger.info("🔒 [PREFLIGHT 2/3] Verifying EVM wallet...");
  const operatorAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);
  if (!operatorAddress) throw new Error("ABORT: EVM_PRIVATE_KEY invalid.");
  logger.info(`   Operator: ${operatorAddress}`);

  // Gate 3: Simulation probe
  if (!skipSimulationProbe) {
    logger.info("🔒 [PREFLIGHT 3/3] Running simulation probe...");
    try {
      await axios.post(BANKR_DEPLOY_URL, { tokenName: "RH_PROBE_" + Date.now(), tokenSymbol: "RHP", chain: "robinhood", simulateOnly: true },
        { headers, timeout: cfg.API_TIMEOUT_MS, ...(axiosProxy && { proxy: axiosProxy }), ...(httpsAgent && { httpsAgent }) });
      logger.info("   Probe OK");
    } catch (e: any) {
      if (e?.response?.status === 429) throw new Error("ABORT: Rate-limited. Use --skip-simulation-probe.");
      throw new Error(`ABORT: BANKR_WRITE_PERMISSION FAILED — ${e.message}`);
    }
  } else {
    logger.info("⚡ [PREFLIGHT 3/3] Probe SKIPPED (--skip-simulation-probe).");
  }
  logger.success("✅ [PREFLIGHT] All gates passed!");

  // PHASE 2: Token identity
  logger.info("\n🧠 [AI] Generating token identity...");
  const candidateId = generateCandidateId();
  let identity = await generateTokenIdentity({ chain: "robinhood" });
  const saturation = await checkCrossChainSaturation(identity.ticker, ["robinhood"]);
  if (saturation?.isSaturated) {
    logger.warn(`⚠️  ${identity.ticker} saturated — regenerating...`);
    identity = await generateTokenIdentity({ chain: "robinhood" });
  }
  logger.success(`   ${identity.ticker} — ${identity.name}`);

  // PHASE 3: Assets + IPFS
  logger.info("\n🎨 [ASSETS] Generating logo and uploading to IPFS...");
  const deployLogId = logDeploy({ candidateId, chain: "robinhood", tokenName: identity.name, ticker: identity.ticker, status: "pending", lifecycleState: "IDENTITY_GENERATED", simulated: false });
  logger.info(`   Vault ID: #${deployLogId}`);

  let logoPath: string | undefined;
  try { logoPath = await generateTokenLogo(identity); } catch (e: any) { logger.warn(`⚠️  Logo failed (non-fatal): ${e.message}`); }

  let assets: UploadResult | undefined;
  try {
    assets = await uploadTokenAssets(identity, logoPath);
    updateDeployLifecycle(deployLogId, "ASSETS_UPLOADED");
    logger.success(`   IPFS: ${assets.metadataUri}`);
  } catch (e: any) { logger.warn(`⚠️  IPFS failed (non-fatal): ${e.message}`); }

  // PHASE 4: Deployment
  logger.info("\n🚀 [DEPLOY] Deploying to Robinhood Chain L2...");
  updateDeployLifecycle(deployLogId, "DEPLOY_INITIATED");

  let deployResult: any;
  try {
    const gateResult = await executeWithDeploymentSafetyGate(
      { chain: "robinhood", identity, assets, walletAddress: operatorAddress ?? undefined, isSimulation: false },
      async () => deployViaBankr(identity, assets, { chain: "robinhood", apiKey: apiKey!, simulateOnly: false, quoteOnlyFees: true, proxyUrl: bankrContext.proxyUrl ?? undefined })
    );
    if (!gateResult.success || !gateResult.result) {
      updateDeployLifecycle(deployLogId, "FAILED", { status: "failed", errorMsg: gateResult.error ?? "GATE_REJECTED" });
      throw new Error(`ABORT: Safety gate rejected: ${gateResult.error}`);
    }
    deployResult = gateResult.result;
  } catch (e: any) {
    if (!e.message.startsWith("ABORT:")) updateDeployLifecycle(deployLogId, "UNKNOWN", { status: "unknown", errorMsg: e.message });
    throw e;
  }

  const txHash: string | undefined = deployResult.txHash ?? deployResult.transactionHash;
  const tokenAddress: string = deployResult.tokenAddress;
  const poolId: string | undefined = deployResult.poolId;

  // PHASE 5: On-chain verification
  let confirmed = false;
  if (txHash) {
    logger.info("\n🔍 [VERIFY] Verifying on Robinhood Chain...");
    await new Promise((r) => setTimeout(r, 5000));
    const receipt = await verifyEvmTransactionReceipt(txHash, "robinhood");
    confirmed = receipt.status === "confirmed";
    logger.info(confirmed ? `   ✅ Confirmed at block #${receipt.blockNumber}` : `   ⏳ Status: ${receipt.status}`);
  }

  // PHASE 6: Vault update
  updateDeployLifecycle(deployLogId, confirmed ? "DEPLOY_CONFIRMED" : "DEPLOY_INITIATED", {
    status: confirmed ? "confirmed" : "unknown",
    contractAddr: tokenAddress,
    poolId: poolId ?? undefined,
    txHash: txHash ?? undefined,
    deployCost: 0,
    walletId: wallet.id,
  });

  // PHASE 7: Offer deck
  try {
    const offer = await generateIrresistibleOffer(identity, tokenAddress, "robinhood");
    const deckPath = saveOfferDeckMarkdown(offer, identity.ticker);
    logger.success(`   Offer deck: ${deckPath}`);
  } catch (e: any) { logger.warn(`⚠️  Offer deck failed (non-fatal): ${e.message}`); }

  // PHASE 8: AUTO-GENERATE WEB3 WEBSITE & CLOUDFLARE PAGES
  let rhLiveWeb3Url: string | undefined;
  try {
    logger.info(`🌐 [WEB3 ENGINE] Membangun Website untuk Robinhood Chain $${identity.ticker}...`);
    const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
    const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
    const { updateDeployLogWebsite } = await import("../src/db/vault.ts");

    const siteRes = await generateTokenWebsite({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      chainId: 46688,
      chainName: "robinhood",
      description: identity.description,
      logoUrl: assets.imageUrl,
      poolId: poolId !== "N/A" ? poolId : undefined,
      websiteUrl: identity.website,
      twitterUrl: identity.twitter,
      telegramUrl: identity.telegram,
    });

    const cfRes = await deployWebsiteToCloudflarePages({
      siteDir: siteRes.siteDirectory,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      chain: "robinhood",
    });
    rhLiveWeb3Url = cfRes.deploymentUrl;
    updateDeployLogWebsite(tokenAddress, rhLiveWeb3Url);
    logger.success(`   🚀 [CLOUDFLARE PAGES] Live DApp: ${rhLiveWeb3Url}`);
  } catch (wErr: any) {
    logger.warn(`   Notice Web3 Website / Cloudflare Pages: ${wErr?.message || wErr}`);
  }

  // PHASE 9: NEON POSTGRESQL SSOT CLOUD SYNC
  try {
    const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
    if (isNeonConfigured()) {
      const neonRes = await syncTokenDeploymentToNeon({
        contractAddr: tokenAddress,
        ticker: identity.ticker,
        tokenName: identity.name,
        chain: "robinhood",
        poolId: poolId !== "N/A" ? poolId : undefined,
        txHash,
        websiteUrl: rhLiveWeb3Url || `https://rtrader.pages.dev/token/robinhood/${tokenAddress}`,
        creatorWallet: operatorAddress ?? undefined,
        description: identity.description,
      });
      if (neonRes.success) {
        logger.success(`   🐘 [NEON CLOUD] Robinhood token '${neonRes.dbName}' tersinkronisasi di Neon PostgreSQL SSOT!`);
      }
      // Ensure 3 SocialFi Campaigns and launchpad visibility
      const { syncRobinhoodTokenToNeon } = await import("./sync-robinhood-to-neon.ts");
      await syncRobinhoodTokenToNeon(tokenAddress, poolId !== "N/A" ? poolId : undefined);
    }
  } catch (neonErr: any) {
    logger.warn(`   🐘 [NEON CLOUD] Notice Neon cloud sync: ${neonErr?.message || neonErr}`);
  }

  console.log(`
=================================================================
  ✅ ROBINHOOD CHAIN L2 DEPLOYMENT COMPLETE
=================================================================
  Token   : ${identity.name} (${identity.ticker})
  CA      : ${tokenAddress}
  Pool ID : ${poolId || "N/A"}
  TxHash  : ${txHash || "N/A"}
  Status  : ${confirmed ? "CONFIRMED" : "PENDING"}
  Explorer: ${ROBINHOOD_EXPLORER_TOKEN}${tokenAddress}
  Gecko   : ${poolId ? GECKOTERMINAL_ROBINHOOD + poolId : "N/A"}
=================================================================
  Selanjutnya: Buka GeckoTerminal dan lakukan swap perdana kecil.
=================================================================
`);
}

if (import.meta.main) {
  runSingleRobinhoodDeployment().catch((err) => {
    logger.error(`❌ FATAL: ${err.message}`);
    process.exit(1);
  });
}
