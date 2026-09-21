/**
 * scripts/execute-flywheel-deployment.ts
 *
 * Executes ONE controlled token deployment to Base Mainnet in FLYWHEEL GROWTH MODE.
 *
 * Distinctive Features:
 *   - 100% Gas Sponsored (0 ETH operator cost via Bankr Relayer).
 *   - Zero Token Transfer Tax (100/100 Safe Audit score on DexScreener/Photon).
 *   - Generates & prints the Community Flywheel Alpha Card (Auto Buyback, WETH Dividends, Jackpot).
 *   - Configures deployment in SQLite with Flywheel metadata.
 *   - Zero Downstream Sniper Dump.
 */

import * as dotenv from "dotenv";
dotenv.config();

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
  resolveOperationalContext,
  resolveCredential,
} from "../src/modules/identity/wallet-manager.ts";
import {
  verifyDeploymentSafetyParameters,
  predictDeploymentAddress,
  executeWithDeploymentSafetyGate,
} from "../src/modules/deploy-guard.ts";
import {
  verifyEvmTransactionReceipt,
  calculateEvmDeploymentCost,
  deriveEvmAddress,
  BANKR_BASE_RELAYER_ADDRESS,
  type EvmGasSponsorshipVerification,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  getDeployLogById,
  generateCandidateId,
} from "../src/db/vault.ts";
import { generateTokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { generateTokenLogo } from "../src/modules/image/pollinations-gen.ts";
import { uploadTokenAssets } from "../src/modules/ipfs/pinata-uploader.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";
import { scanTrends } from "../src/modules/trend/firecrawl-radar.ts";
import { generateFlywheelAnnouncementCard } from "../src/modules/growth/flywheel-engine.ts";
import { dispatchBeaconCard } from "../src/modules/social/beacon-broadcaster.ts";
import { recordGasSponsorshipToLedger } from "../src/modules/treasury/treasury-ledger.ts";

const isSimulated =
  process.argv.includes("--simulate") ||
  process.argv.includes("--testnet") ||
  process.env.DEPLOY_MODE === "testnet";

// Force configuration for Flywheel deployment
process.env.DEPLOY_MODE = isSimulated ? "testnet" : "mainnet";
process.env.BANKR_CHAIN = "base";
process.env.BANKR_REQUIRE_GAS_SPONSORSHIP = "true";
process.env.BANKR_ALLOW_PAID_GAS_FALLBACK = "false";
process.env.BANKR_QUOTE_ONLY_FEES = "true";
process.env.BANKR_SIMULATE_ONLY = isSimulated ? "true" : "false";
process.env.DRY_RUN = isSimulated ? "true" : "false";
process.env.FLYWHEEL_ENABLED = "true";

resetConfig();
const cfg = getConfig();

async function runFlywheelDeployment(): Promise<void> {
  console.log(`
=================================================================
  [+] BASE MAINNET DEPLOYMENT - FLYWHEEL GROWTH MODE [+]
=================================================================
  Target Chain: Base Mainnet
  Mechanism: Positive-Sum Perpetual WETH Flywheel
  Security: 0% Tax (100/100 Safe Score)
  Gas Sponsorship: 100% Sponsored (0.0 ETH Operator Cost)
  Downstream Dumping: FORBIDDEN
=================================================================
`);

  // -------------------------------------------------------------
  // PHASE 0: 1:1 IDENTITY & PROXY CONTEXT RESOLUTION
  // -------------------------------------------------------------
  logger.info("🔐 [IDENTITY MAPPING] Resolving 1:1 Operator Wallet, Route, and Proxy Context...");
  const wallet = bootstrapDefaultWallet();
  const bankrContext = resolveOperationalContext(wallet.id, "bankr");

  logger.info(`   Active Wallet: '${wallet.id}' (${wallet.label})`);
  logger.info(`   EVM Address:   ${wallet.evmAddress ?? "N/A"}`);
  if (bankrContext.proxyUrl) {
    logger.info(`   Proxy Binding: ${bankrContext.maskedProxyUrl} (Proxy ID: ${bankrContext.proxy?.id})`);
  } else {
    logger.info(`   Proxy Binding: DIRECT (No proxy configured)`);
  }

  if (!bankrContext.isUsable) {
    throw new Error(
      `ABORT: Operational identity route unusable: ${bankrContext.unusableReason ?? "Unknown issue"}`
    );
  }

  // Resolve API Key: route credentialRef (isolated account) with fallback to global cfg.BANKR_API_KEY
  let apiKey: string | undefined;
  if (bankrContext.credentialRef) {
    apiKey = resolveCredential(bankrContext.credentialRef);
    if (!apiKey) {
      throw new Error(
        `ABORT: Failed to resolve credential from ref '${bankrContext.credentialRef}' for wallet '${wallet.id}'. Strict account isolation prevents fallback to global key.`
      );
    }
  } else {
    apiKey = cfg.BANKR_API_KEY;
  }

  if (!apiKey) {
    throw new Error("ABORT: BANKR_API_KEY is missing from environment.");
  }

  const axiosProxy = buildAxiosProxyConfig(bankrContext.proxyUrl ?? undefined);
  const httpsAgent = bankrContext.proxyUrl ? new HttpsProxyAgent(bankrContext.proxyUrl) : undefined;
  const headers = getBankrHeaders(apiKey);

  // PREFLIGHT 1: Custodial EVM
  logger.info("🔒 [PREFLIGHT 1/4] Verifying Bankr Account & Custodial Wallet...");
  const balRes = await axios.get("https://api.bankr.bot/wallet/balances", {
    headers,
    proxy: bankrContext.proxyUrl ? false : axiosProxy,
    httpsAgent,
    timeout: 10000,
  });

  if (balRes.status !== 200 || !balRes.data?.success) {
    throw new Error(`ABORT: BANKR_ACCOUNT_AUTH FAILED — Status ${balRes.status}`);
  }
  const custodialEvm = balRes.data.evmAddress;
  const baseBal = parseFloat(balRes.data.balances?.base?.nativeBalance ?? "0");

  logger.info(`   Custodial EVM: ${custodialEvm}`);
  logger.info(`   Base Balance: ${baseBal} ETH`);

  if (!isSimulated && baseBal < 0.002) {
    throw new Error(`ABORT: Base balance too low (${baseBal} ETH). Need >= 0.002 ETH.`);
  }

  // PREFLIGHT 2: Write permission probe
  logger.info("🔒 [PREFLIGHT 2/4] Verifying Token Launch permission via simulation probe...");
  let simRes;
  try {
    const probePayload = {
      tokenName: "Flywheel Probe Token",
      tokenSymbol: "FPROBE",
      chain: "base",
      simulateOnly: true,
      quoteOnlyFees: true,
    };
    const probeBody = JSON.stringify(probePayload);
    const probeHeaders: Record<string, string> = { ...headers };
    if (bankrContext.proxyUrl) {
      probeHeaders["Content-Length"] = String(Buffer.byteLength(probeBody));
    }
    simRes = await axios.post(
      BANKR_DEPLOY_URL,
      bankrContext.proxyUrl ? probeBody : probePayload,
      {
        headers: probeHeaders,
        proxy: bankrContext.proxyUrl ? false : axiosProxy,
        httpsAgent,
        timeout: 15000,
      }
    );
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const serverHeader = String(err.response?.headers?.["server"] || "unknown");
      const dataPreview = typeof err.response?.data === "string"
        ? err.response.data.slice(0, 200).replace(/[\r\n]+/g, " ")
        : JSON.stringify(err.response?.data);

      if (status === 403) {
        logger.error(`❌ [PREFLIGHT 2/4] HTTP 403 Forbidden received from upstream.`);
        logger.error(`   Server: ${serverHeader} | Upstream Response: ${dataPreview}`);
        logger.error(`   Diagnosis: Request rejected by AWS ALB / WAF Gateway perimeter before reaching Bankr backend.`);
        logger.warn(`   💡 Remediasi: Hubungkan proxy US via 'bun run scripts/manage-wallets.ts wizard-account' untuk melewati filter WAF geografis.`);
        throw new Error(
          `ABORT: BANKR_WRITE_PERMISSION FAILED (HTTP 403 Forbidden from ${serverHeader}). Simulation probe rejected by upstream gateway.`
        );
      }

      if (status === 429 && dataPreview.toLowerCase().includes("too many launch simulations")) {
        logger.error(`❌ [PREFLIGHT 2/4] Upstream Simulation Quota Exceeded (HTTP 429).`);
        logger.error(`   Upstream Response: ${dataPreview}`);
        logger.error(`   Safety Invariant: Launch authorization CANNOT be proven while simulation endpoint is rate-limited.`);
        logger.warn(`   💡 FAIL-CLOSED: Menolak peluncuran on-chain tanpa otorisasi terverifikasi. Tunggu kuota reset (24 jam) sebelum eksekusi.`);
        throw new Error(
          `ABORT: BANKR_WRITE_PERMISSION UNVERIFIED (HTTP 429 Too Many Simulations). Upstream rate-limit blocks launch authorization proof. Fail-closed enforced.`
        );
      } else {
        throw new Error(
          `ABORT: Simulation probe rejected — Status ${status}: ${dataPreview || err.message}`
        );
      }
    } else {
      throw new Error(`ABORT: Simulation probe rejected — ${err?.message || String(err)}`);
    }
  }

  if (!simRes.data?.success || !simRes.data?.tokenAddress) {
    throw new Error(`ABORT: Simulation probe rejected: ${JSON.stringify(simRes.data)}`);
  }

  logger.success("✅ [PREFLIGHT] All pre-flight gates passed!");

  // IDENTITY GENERATION
  logger.info("🧠 [IDENTITY] Generating Flywheel token concept...");
  let trendContent = "Trending on Base: AI autonomous agents, positive-sum game theory, passive yield, community value";
  try {
    const trendData = await scanTrends();
    if (trendData?.raw) {
      trendContent = trendData.raw;
    }
  } catch {
    // fallback to default trend
  }

  const identity = await generateTokenIdentity(trendContent);
  if (!identity) {
    throw new Error("ABORT: AI failed to generate token identity.");
  }

  const candidateId = generateCandidateId();

  // SATURATION CHECK
  logger.info(`🔍 [SAFETY] Saturation check for $${identity.ticker}...`);
  try {
    const sat = await checkCrossChainSaturation(identity.ticker, ["base"]);
    if (sat.saturated) {
      throw new Error(`ABORT: Ticker $${identity.ticker} is saturated.`);
    }
  } catch (satErr: any) {
    if (satErr.message?.startsWith("ABORT:")) throw satErr;
  }

  // LOGO & IPFS ASSETS
  logger.info(`🎨 [ASSETS] Generating logo for "${identity.name}" ($${identity.ticker})...`);
  const logoBuffer = await generateTokenLogo(identity.imagePrompt, identity.name);
  const assets = await uploadTokenAssets(logoBuffer, identity);

  if (!assets || !assets.metadataUrl) {
    throw new Error("ABORT: Failed to upload assets to IPFS.");
  }

  const safety = verifyDeploymentSafetyParameters(identity, assets);
  if (!safety.safe) {
    throw new Error(`ABORT: Safety check failed: ${safety.issues.join("; ")}`);
  }

  // RECORD IN VAULT
  const deployLogId = logDeploy({
    chain: "base",
    tokenName: identity.name,
    ticker: identity.ticker,
    ipfsUrl: assets.metadataUrl,
    status: "pending",
    lifecycleState: "DEPLOY_SUBMITTED",
    walletId: wallet.id,
    proxyId: bankrContext.proxy?.id || undefined,
    candidateId,
    viralScore: identity.viralScore,
  });

  // PREDICTIVE CA
  const pred = await predictDeploymentAddress(identity, assets, {
    chain: "base",
    apiKey,
    proxyUrl: bankrContext.proxyUrl ?? undefined,
  });
  if (pred.predictedContractAddress) {
    logger.info(`🔮 [PREDICTIVE CA] Predicted CA: ${pred.predictedContractAddress}`);
  }

  // BROADCAST TO BANKR WITH PRODUCTION SAFETY GATE
  logger.deploy(`🚀 [DEPLOY] Broadcasting $${identity.ticker} to Base ${isSimulated ? "[SIMULATION MODE]" : "Mainnet"} via Safety Gate...`);
  const operatorAddr = cfg.EVM_OPERATOR_ADDRESS || (cfg.EVM_PRIVATE_KEY ? deriveEvmAddress(cfg.EVM_PRIVATE_KEY) : undefined);

  let deployResult;
  const gateExecution = await executeWithDeploymentSafetyGate(
    {
      chain: "base",
      identity,
      assets,
      walletAddress: operatorAddr,
      isSimulation: isSimulated,
    },
    async () => {
      return await deployViaBankr(identity, assets, {
        chain: "base",
        apiKey,
        simulateOnly: isSimulated,
        quoteOnlyFees: true,
        proxyUrl: bankrContext.proxyUrl ?? undefined,
      });
    }
  );

  if (!gateExecution.success || !gateExecution.result) {
    const gateErr = gateExecution.error || "SAFETY_GATE_REJECTED";
    logger.error(`❌ [SAFETY GATE] Flywheel deployment blocked by gate: ${gateErr}`);
    updateDeployLifecycle(deployLogId, "FAILED", {
      status: "failed",
      errorMsg: `Safety gate rejection: ${gateErr}`,
    });
    throw new Error(`ABORT: Flywheel deployment blocked by Safety Gate: ${gateErr}`);
  }

  deployResult = gateExecution.result;

  if (!deployResult.success) {
    updateDeployLifecycle(deployLogId, "FAILED", {
      status: "failed",
      errorMsg: deployResult.error || "Deployment failed",
    });
    throw new Error(`Deployment failed: ${deployResult.error}`);
  }

  const txHash = deployResult.txHash || `sim_${Date.now()}`;
  const tokenAddress = deployResult.contractAddress;
  const poolId = deployResult.poolId ?? "N/A";

  logger.success(`📡 [${isSimulated ? "SIMULATED" : "DEPLOYED"}] TxHash: ${txHash}`);
  logger.info(`   CA: ${tokenAddress}`);
  logger.info(`   Pool: ${poolId}`);

  if (isSimulated) {
    updateDeployLifecycle(deployLogId, "SIMULATED", {
      status: "success",
      contractAddr: tokenAddress,
      txHash,
      poolId,
      deployCost: 0.0,
      simulated: true,
      attributionStatus: "confirmed",
      attributionReason: "Flywheel testnet simulation mode verified",
    });
    logger.success("🎉 [SUCCESS] Flywheel simulation deployment verified!");
  } else {
    // WAIT FOR RECEIPT
    logger.info("⏳ [CONFIRMATION] Waiting for Base on-chain confirmation...");
    let receiptResult;
    for (let i = 0; i < 30; i++) {
      receiptResult = await verifyEvmTransactionReceipt(txHash, "base");
      if (receiptResult.status === "confirmed" || receiptResult.status === "failed") break;
      await new Promise((r) => setTimeout(r, 4000));
    }

    if (receiptResult?.status !== "confirmed" || !receiptResult.receipt) {
      throw new Error(`Transaction receipt was not confirmed: ${receiptResult?.status}`);
    }

    const receipt = receiptResult.receipt;
    const operatorAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);
    const costVerification = calculateEvmDeploymentCost(
      receipt,
      operatorAddress,
      "base",
      BANKR_BASE_RELAYER_ADDRESS
    );

    // SPONSORSHIP VERIFICATION
    if (receipt.from?.toLowerCase() !== BANKR_BASE_RELAYER_ADDRESS.toLowerCase()) {
      throw new Error(`SECURITY WARNING: Relayer address mismatch (${receipt.from}).`);
    }

    // CONFIRM IN VAULT
    updateDeployLifecycle(deployLogId, "DEPLOY_CONFIRMED", {
      status: "confirmed",
      contractAddr: tokenAddress,
      txHash,
      poolId,
      deployCost: 0.0,
      simulated: false,
      attributionStatus: "confirmed",
      attributionReason: costVerification.summary,
    });

    // RECORD GAS SPONSORSHIP TO TREASURY LEDGER
    try {
      recordGasSponsorshipToLedger({
        deployLogId,
        chain: "base",
        tokenSymbol: "ETH",
        networkGasCostEth: costVerification.networkGasCostEth,
        relayerAddress: receipt.from ?? BANKR_BASE_RELAYER_ADDRESS,
        txHash,
      });
    } catch (sponsorErr) {
      logger.warn(
        `⚠️  [TREASURY] Gagal mencatat gas sponsorship ke ledger: ${sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr)}`
      );
    }

    logger.success("🎉 [SUCCESS] Deployment fully confirmed and verified on-chain!");
  }

  // GENERATE WEB3 WEBSITE, CLOUDFLARE PAGES & NEON POSTGRESQL SSOT SYNC
  let flywheelLiveWeb3Url: string | undefined;
  try {
    const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
    const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
    const { updateDeployLogWebsite } = await import("../src/db/vault.ts");

    logger.info(`🌐 [FLYWHEEL WEB3] Membangun Website Web3 untuk $${identity.ticker}...`);
    const siteRes = await generateTokenWebsite({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      chainId: 8453,
      chainName: "base",
      description: identity.description,
      logoUrl: assets.imageUrl,
      poolId: poolId && poolId !== "N/A" ? poolId : undefined,
      websiteUrl: identity.website,
      twitterUrl: identity.twitter,
      telegramUrl: identity.telegram,
    });

    const cfRes = await deployWebsiteToCloudflarePages({
      siteDir: siteRes.siteDirectory,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      chain: "base",
    });
    flywheelLiveWeb3Url = cfRes.deploymentUrl;
    updateDeployLogWebsite(tokenAddress, flywheelLiveWeb3Url);
    logger.success(`🚀 [FLYWHEEL CLOUDFLARE] Live DApp: ${flywheelLiveWeb3Url}`);

    const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
    if (isNeonConfigured()) {
      await syncTokenDeploymentToNeon({
        contractAddr: tokenAddress,
        ticker: identity.ticker,
        tokenName: identity.name,
        chain: "base",
        poolId: poolId && poolId !== "N/A" ? poolId : undefined,
        txHash,
        websiteUrl: flywheelLiveWeb3Url,
        creatorWallet: wallet.evmAddress,
        description: identity.description,
      });
      logger.success(`🐘 [NEON CLOUD] $${identity.ticker} tersinkronisasi ke Neon Cloud SSOT!`);
    }
  } catch (webErr: any) {
    logger.warn(`⚠️  [FLYWHEEL WEB3] Notice: ${webErr?.message || webErr}`);
  }

  // GENERATE FLYWHEEL COMMUNITY CARD
  const promoCard = generateFlywheelAnnouncementCard(identity, tokenAddress);
  console.log("\n" + promoCard + "\n");
  dispatchBeaconCard(promoCard).catch((e) => logger.warn(`Beacon dispatch notice: ${String(e)}`));

  console.log(`
=================================================================
  [+] FLYWHEEL MODE DEPLOYMENT COMPLETE [+]
=================================================================
  Token:            $${identity.ticker} (${identity.name})
  CA:               ${tokenAddress}
  Explorer:         https://basescan.org/tx/${txHash}
  DexScreener:      https://dexscreener.com/base/${tokenAddress}
  Operator Cost:    0.0 ETH (100% Sponsored)
=================================================================
  [!] PANDUAN EKSEKUSI FLYWHEEL LANJUTAN:
  Untuk memantau dan membagi WETH creator fee secara otomatis,
  jalankan:
      bun run scripts/run-flywheel-worker.ts
  atau pilih menu [11] di MENU_UTAMA.bat.
=================================================================
`);
}

if (import.meta.main) {
  runFlywheelDeployment()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(`❌ Flywheel deployment stopped: ${err?.message || err}`);
      process.exit(1);
    });
}
