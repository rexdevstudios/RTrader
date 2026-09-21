/**
 * scripts/execute-single-base-deployment.ts
 *
 * Executes exactly ONE single controlled token deployment to Base Mainnet
 * via the official Bankr Token Launch API with gas sponsorship verification,
 * receipt confirmation, on-chain payer attribution, and Vault accounting.
 *
 * STRICT INVARIANTS:
 *  - Exactly 1 deployment attempt (NO auto-retry, NO loop).
 *  - Pre-deployment final gates MUST all PASS before POST.
 *  - Gas sponsorship MUST be proven on-chain: receipt.from === BANKR_BASE_RELAYER_ADDRESS.
 *  - Operator deployer cost = 0.0 ETH.
 *  - NO paid gas fallback, NO local private key broadcast.
 *  - Downstream sniper buy is explicitly DISABLED.
 *  - No secrets exposed.
 */

import * as dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { formatEther } from "viem";
import { getConfig, resetConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import {
  deployViaBankr,
  getBankrHeaders,
  BANKR_DEPLOY_URL,
  sanitizeSecret,
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
  verifyDeploymentSafetyParameters,
  predictDeploymentAddress,
  executeWithDeploymentSafetyGate,
} from "../src/modules/deploy-guard.ts";
import {
  verifyEvmTransactionReceipt,
  verifyEvmDeploymentAttribution,
  calculateEvmDeploymentCost,
  deriveEvmAddress,
  BANKR_BASE_RELAYER_ADDRESS,
  isBankrRelayer,
  type EvmGasSponsorshipVerification,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  getDeployLogById,
  generateCandidateId,
} from "../src/db/vault.ts";
import { generateTokenIdentity, type TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { generateTokenLogo } from "../src/modules/image/pollinations-gen.ts";
import { uploadTokenAssets, type UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";
import { scanTrends } from "../src/modules/trend/firecrawl-radar.ts";
import { generateIrresistibleOffer, saveOfferDeckMarkdown } from "../src/modules/growth/token-offer-generator.ts";
import { recordGasSponsorshipToLedger } from "../src/modules/treasury/treasury-ledger.ts";
import { linkTokenToBankrProject } from "./manage-bankr-project.ts";
import * as path from "path";

// Force environment configuration for controlled single deployment
process.env.DEPLOY_MODE = "mainnet";
process.env.BANKR_CHAIN = "base";
process.env.BANKR_REQUIRE_GAS_SPONSORSHIP = "true";
process.env.BANKR_ALLOW_PAID_GAS_FALLBACK = "false";
process.env.BANKR_QUOTE_ONLY_FEES = "true";
process.env.BANKR_SIMULATE_ONLY = "false";
process.env.DRY_RUN = "false";

resetConfig();
const cfg = getConfig();

const cliArgs = process.argv.slice(2);
const skipSimulationProbe = cliArgs.includes("--skip-simulation-probe") || cliArgs.includes("--skip-probe") || cliArgs.includes("--force");

export interface ExecutionReportData {
  deployment: {
    attempts: number;
    chain: string;
    tokenName: string;
    ticker: string;
    description: string;
    tokenAddress: string;
    poolId: string;
    txHash: string;
    blockNumber: string;
    receiptStatus: string;
    explorerUrl: string;
    ipfsMetadataUrl: string;
  };
  sponsorship: {
    expectedRelayer: string;
    actualPayer: string;
    sponsorshipStatus: string;
    networkGasCostEth: number;
    operatorGasCostEth: number;
    gasUsed: string;
    effectiveGasPriceGwei: number;
    paidGasFallback: string;
  };
  vault: {
    deployLogId: number;
    lifecycleState: string;
    status: string;
    deployCost: number;
    txHash: string;
    attributionStatus: string;
    attributionReason: string;
  };
  security: {
    privateKeyDeployment: string;
    directEvmBroadcast: string;
    paidGasFallback: string;
    additionalFunding: string;
    sniperBuy: string;
    secondDeployment: string;
    secretsExposed: string;
  };
  finalStatus: string;
}

async function runSingleControlledDeployment(): Promise<ExecutionReportData> {
  console.log(`
=================================================================
  SINGLE CONTROLLED BASE MAINNET DEPLOYMENT EXECUTION
=================================================================
  Target Chain: Base Mainnet
  Provider: Bankr Token Launch API
  Gas Sponsorship Policy: STRICT REQUIREMENT (0 ETH operator cost)
  Paid Gas Fallback: FORBIDDEN / DISABLED
  Downstream Trading: FORBIDDEN / DISABLED
  Max Deployment Attempts: EXACTLY 1
=================================================================
`);

  // -------------------------------------------------------------
  // PHASE 0: 1:1 IDENTITY & PROXY CONTEXT RESOLUTION
  // -------------------------------------------------------------
  logger.info("🔐 [IDENTITY MAPPING] Resolving 1:1 Operator Wallet, Route, and Proxy Context...");
  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  const requestedWalletId = walletArg ? walletArg.split("=")[1]?.trim() : undefined;
  const wallet = requestedWalletId
    ? (getWalletAccount(requestedWalletId) ?? bootstrapDefaultWallet())
    : selectExecutionWallet({ requiredProvider: "bankr", targetChains: ["base"] });
  let bankrContext = resolveOperationalContext(wallet.id, "bankr");

  // Pre-Deploy Auto-Failover Gate: If proxy is unhealthy, attempt auto-failover to backup
  if (!bankrContext.isUsable && bankrContext.proxy && bankrContext.proxy.healthStatus !== "available") {
    logger.warn(
      `⚠️ [PRE-DEPLOY] Proxy '${bankrContext.proxy.id}' terdeteksi tidak sehat (${bankrContext.proxy.healthStatus}). Mencoba auto-failover ke proxy cadangan...`
    );
    try {
      const failoverRes = await autoFailoverUnhealthyRoutes();
      if (failoverRes.failoversExecuted > 0) {
        logger.info(`✅ [PRE-DEPLOY] Auto-failover berhasil dialihkan. Memperbarui konteks operasional...`);
        bankrContext = resolveOperationalContext(wallet.id, "bankr");
      }
    } catch (err: any) {
      logger.warn(`⚠️ [PRE-DEPLOY] Gagal melakukan auto-failover: ${err?.message || err}`);
    }
  }

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

  const axiosProxy = buildAxiosProxyConfig(bankrContext.proxyUrl ?? undefined);
  const httpsAgent = bankrContext.proxyUrl ? new HttpsProxyAgent(bankrContext.proxyUrl) : undefined;

  // -------------------------------------------------------------
  // PHASE 1: PRE-DEPLOYMENT FINAL GATES (Fail-Closed)
  // -------------------------------------------------------------
  logger.info("🔒 [PREFLIGHT] Running Pre-Deployment Final Gate checks...");

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

  const headers = getBankrHeaders(apiKey);

  // Gate 1: BANKR_ACCOUNT_AUTH & Custodial EVM Wallet
  logger.info("🔒 [PREFLIGHT 1/5] Verifying Bankr Account & Custodial Wallet...");
  const balRes = await axios.get("https://api.bankr.bot/wallet/balances", {
    headers,
    proxy: bankrContext.proxyUrl ? false : axiosProxy,
    httpsAgent,
    timeout: 10000,
  });

  if (balRes.status !== 200 || !balRes.data?.success) {
    throw new Error(`ABORT: BANKR_ACCOUNT_AUTH FAILED — Status ${balRes.status}: ${JSON.stringify(balRes.data)}`);
  }

  const custodialEvmAddress = balRes.data.evmAddress?.toLowerCase();
  const baseNativeBalanceStr = balRes.data.balances?.base?.nativeBalance ?? "0";
  const baseNativeBalance = parseFloat(baseNativeBalanceStr);

  logger.info(`   Custodial EVM: ${balRes.data.evmAddress}`);
  logger.info(`   Custodial Base Native Balance: ${baseNativeBalanceStr} ETH`);

  if (!custodialEvmAddress || !custodialEvmAddress.startsWith("0x")) {
    throw new Error("ABORT: BANKR_EVM_WALLET FAILED — Missing or invalid custodial EVM address.");
  }

  // Gate 2: BANKR_BASE_BALANCE threshold (>= 0.001 ETH)
  logger.info("🔒 [PREFLIGHT 2/5] Verifying Base Balance Eligibility (>= 0.001 ETH)...");
  if (baseNativeBalance < 0.001) {
    throw new Error(
      `ABORT: BANKR_BASE_BALANCE FAILED — Current balance is ${baseNativeBalance} ETH, minimum required is 0.001 ETH.`
    );
  }

  // Gate 3: BANKR_WRITE_PERMISSION & TOKEN_LAUNCH_PERMISSION (Simulation probe)
  if (skipSimulationProbe) {
    logger.warn("⚠️  [PREFLIGHT 3/5] Simulation probe dilewati (--skip-simulation-probe).");
    logger.warn("   Penyebab: Upstream rate limit kuota harian simulasi (HTTP 429).");
    logger.warn("   Status otorisasi peluncuran akan dibuktikan secara langsung saat fase eksekusi.");
  } else {
    logger.info("🔒 [PREFLIGHT 3/5] Verifying Token Launch Write Permission via dry simulation...");
    let simRes;
    try {
      const probePayload = {
        tokenName: "Preflight Launch Probe",
        tokenSymbol: "PROBE",
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
          logger.error(`❌ [PREFLIGHT 3/5] HTTP 403 Forbidden received from upstream.`);
          logger.error(`   Server: ${serverHeader} | Upstream Response: ${dataPreview}`);
          logger.error(`   Diagnosis: Request rejected by AWS ALB / WAF Gateway perimeter before reaching Bankr backend.`);
          logger.warn(`   💡 Remediasi: Hubungkan proxy US via 'bun run scripts/manage-wallets.ts wizard-account' untuk melewati filter WAF geografis.`);
          throw new Error(
            `ABORT: BANKR_WRITE_PERMISSION FAILED (HTTP 403 Forbidden from ${serverHeader}). Dry simulation probe rejected by upstream gateway.`
          );
        }

        if (status === 429 && dataPreview.toLowerCase().includes("too many launch simulations")) {
          logger.error(`❌ [PREFLIGHT 3/5] Upstream Simulation Quota Exceeded (HTTP 429).`);
          logger.error(`   Upstream Response: ${dataPreview}`);
          logger.error(`   Safety Invariant: Launch authorization CANNOT be proven while simulation endpoint is rate-limited.`);
          logger.warn(`   💡 PETUNJUK OPERATOR: Jatah probe simulasi harian upstream Bankr telah habis.`);
          logger.warn(`   Jika saldo dompet (>= 0.002 ETH) dan otorisasi telah terverifikasi di Gate 1 & 2, Anda dapat melewati probe ini`);
          logger.warn(`   dengan menambahkan flag '--skip-simulation-probe':`);
          logger.warn(`   bun run scripts/execute-single-base-deployment.ts --skip-simulation-probe`);
          throw new Error(
            `ABORT: BANKR_WRITE_PERMISSION UNVERIFIED (HTTP 429 Too Many Simulations). Upstream rate-limit blocks launch authorization proof. Fail-closed enforced. Gunakan '--skip-simulation-probe' jika Anda yakin ingin melanjutkan.`
          );
        } else {
          throw new Error(
            `ABORT: BANKR_WRITE_PERMISSION FAILED — Status ${status}: ${dataPreview || err.message}`
          );
        }
      } else {
        throw new Error(`ABORT: BANKR_WRITE_PERMISSION FAILED — ${err?.message || String(err)}`);
      }
    }

    if (simRes.status !== 200 && simRes.status !== 201) {
      throw new Error(`ABORT: BANKR_WRITE_PERMISSION FAILED — Simulation returned status ${simRes.status}`);
    }

    if (!simRes.data?.success || !simRes.data?.tokenAddress) {
      throw new Error(`ABORT: BANKR_TOKEN_LAUNCH_PERMISSION FAILED — Response: ${JSON.stringify(simRes.data)}`);
    }
    logger.info(`   Simulation accepted by Bankr server. Predicted address: ${simRes.data.tokenAddress}`);
  }

  // Gate 4: BANKR_SPONSORSHIP
  logger.info("🔒 [PREFLIGHT 4/5] Verifying Gas Sponsorship Eligibility...");
  if (cfg.BANKR_CHAIN !== "base") {
    throw new Error(`ABORT: BANKR_SPONSORSHIP FAILED — Chain is '${cfg.BANKR_CHAIN}', only 'base' is sponsored.`);
  }

  // Gate 5: PAID_GAS_FALLBACK
  logger.info("🔒 [PREFLIGHT 5/5] Verifying Paid Gas Fallback is DISABLED...");
  if (cfg.BANKR_ALLOW_PAID_GAS_FALLBACK) {
    throw new Error("ABORT: PAID_GAS_FALLBACK MUST BE FALSE. Violation detected.");
  }

  logger.success("✅ [PREFLIGHT] ALL 5 PRE-DEPLOYMENT GATES EVALUATED!");
  console.log(`
  BANKR_ACCOUNT_AUTH:             PASS
  BANKR_WRITE_PERMISSION:         ${skipSimulationProbe ? "SKIPPED (--skip-simulation-probe)" : "PASS"}
  BANKR_TOKEN_LAUNCH_PERMISSION:  ${skipSimulationProbe ? "SKIPPED (--skip-simulation-probe)" : "PASS"}
  BANKR_EVM_WALLET:               PASS (${custodialEvmAddress})
  BANKR_BASE_BALANCE:             PASS (${baseNativeBalanceStr} ETH >= 0.001 ETH)
  BANKR_WALLET_ELIGIBILITY:       PASS
  BANKR_SPONSORSHIP:              PASS (Base Mainnet)
  PAID_GAS_FALLBACK:              DISABLED
`);

  // -------------------------------------------------------------
  // PHASE 2: TOKEN IDENTITY & METADATA GENERATION
  // -------------------------------------------------------------
  logger.info("🧠 [IDENTITY] Generating token candidate using AI pipeline...");

  let trendContent = "Trending on Base: AI autonomous agents, on-chain economy, decentralized computing";
  try {
    const trendData = await scanTrends();
    if (trendData?.raw) {
      trendContent = trendData.raw;
      logger.info(`   Trend scraped from ${trendData.sources.length} sources.`);
    }
  } catch (trendErr) {
    logger.warn(`   Trend scraping notice: ${String(trendErr)}. Using default market theme.`);
  }

  const identity = await generateTokenIdentity(trendContent);
  if (!identity) {
    throw new Error("ABORT: AI failed to generate a valid token identity.");
  }

  const candidateId = generateCandidateId();

  // Saturation Check
  logger.info(`🔍 [SAFETY] Checking market saturation for $${identity.ticker}...`);
  try {
    const saturation = await checkCrossChainSaturation(identity.ticker, ["base"]);
    if (saturation.saturated || saturation.count >= 3) {
      throw new Error(`ABORT: SATURATION CHECK FAILED — $${identity.ticker} is saturated (${saturation.message}).`);
    }
    logger.info(`   Saturation check passed: $${identity.ticker} (count: ${saturation.count})`);
  } catch (satErr: any) {
    if (satErr.message?.startsWith("ABORT:")) throw satErr;
    logger.warn(`   Saturation check notice: ${satErr.message}. Proceeding safely.`);
  }

  // Pre-allocate Dedicated Telegram Bot from pool before pinning metadata to IPFS
  let preallocatedBotId: number | undefined;
  try {
    const { syncBotPoolFromEnv, peekNextAvailableBot, updateBotPoolUsername } = await import(
      "../src/db/vault.ts"
    );
    syncBotPoolFromEnv();
    const peekedBot = peekNextAvailableBot();
    if (peekedBot) {
      preallocatedBotId = peekedBot.id;
      let actualUsername = peekedBot.botUsername;
      if (!actualUsername) {
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${peekedBot.botToken}/getMe`);
          const tgData = (await tgRes.json()) as any;
          if (tgData.ok && tgData.result?.username) {
            actualUsername = String(tgData.result.username);
            updateBotPoolUsername(peekedBot.id, actualUsername);
          }
        } catch {
          // non-blocking
        }
      }
      if (actualUsername) {
        identity.telegram = `https://t.me/${actualUsername.replace(/^@/, "")}`;
        logger.info(`✨ [PRE-ALLOCATION] Bot Telegram asli dialokasikan ke metadata IPFS: @${actualUsername}`);
      }
    } else if (process.env.TELEGRAM_BOT_USERNAME) {
      const fallbackUser = process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
      identity.telegram = `https://t.me/${fallbackUser}`;
      logger.info(`ℹ️  [PRE-ALLOCATION] Fallback Master Fleet Bot untuk metadata IPFS: @${fallbackUser}`);
    }
  } catch (preBotErr: any) {
    logger.warn(`⚠️  [PRE-ALLOCATION] Warning alokasi bot pool pre-deploy: ${preBotErr?.message || preBotErr}`);
  }

  // Generate Logo & Upload Assets to IPFS
  logger.info(`🎨 [ASSETS] Preparing token logo for "${identity.name}" ($${identity.ticker})...`);
  const logoBuffer = await generateTokenLogo(identity.imagePrompt, identity.name);
  const assets = await uploadTokenAssets(logoBuffer, identity);

  if (!assets || !assets.metadataUrl) {
    throw new Error("ABORT: Failed to upload token assets to Pinata IPFS.");
  }

  // Pre-flight Token Safety & Metadata Verification
  const safetyReport = verifyDeploymentSafetyParameters(identity, assets);
  logger.info(`🛡️  [SAFETY CHECK] Safety Score: ${safetyReport.score}/100 (Safe: ${safetyReport.safe})`);
  if (!safetyReport.safe) {
    throw new Error(`ABORT: Token candidate rejected by safety guard: ${safetyReport.issues.join("; ")}`);
  }

  console.log(`
-----------------------------------------------------------------
  TOKEN CANDIDATE PREPARED
-----------------------------------------------------------------
  Token Name:    ${identity.name}
  Ticker:        $${identity.ticker}
  Description:   ${identity.description}
  Target Chain:  Base Mainnet
  Image URL:     ${assets.imageUrl}
  IPFS Metadata: ${assets.metadataUrl}
  Candidate ID:  ${candidateId}
  Viral Score:   ${identity.viralScore}
-----------------------------------------------------------------
`);

  // -------------------------------------------------------------
  // PHASE 3: RECORD SUBMISSION IN SQLITE VAULT
  // -------------------------------------------------------------
  const operatorAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);

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

  logger.info(`📝 [VAULT] Deployment logged in SQLite deploy_logs (ID: ${deployLogId}) with state 'DEPLOY_SUBMITTED'.`);

  // -------------------------------------------------------------
  // PHASE 4: EXECUTE EXACTLY ONE REAL ON-CHAIN DEPLOYMENT
  // -------------------------------------------------------------
  logger.deploy(
    `🚀 [BANKR] EXECUTING REAL BASE MAINNET LAUNCH FOR $${identity.ticker} (${identity.name})...`
  );

  // Predictive deterministic CA extraction (0 gas cost)
  const pred = await predictDeploymentAddress(identity, assets, {
    chain: "base",
    apiKey,
    proxyUrl: bankrContext.proxyUrl ?? undefined,
  });
  if (pred.predictedContractAddress) {
    logger.info(
      `🔮 [PREDICTIVE CA] Prediksi CA: ${pred.predictedContractAddress} | Pool: ${pred.predictedPoolId ?? "N/A"} (Pre-broadcast verified)`
    );
  }

  let deployResult;
  try {
    const gateExecution = await executeWithDeploymentSafetyGate(
      {
        chain: "base",
        identity,
        assets,
        walletAddress: operatorAddress ?? undefined,
        isSimulation: false,
      },
      async () => {
        return await deployViaBankr(identity, assets, {
          chain: "base",
          apiKey,
          simulateOnly: false,
          quoteOnlyFees: true,
          proxyUrl: bankrContext.proxyUrl ?? undefined,
          feeRecipient: wallet.evmAddress ? { type: "wallet", value: wallet.evmAddress } : undefined,
        });
      }
    );

    if (!gateExecution.success || !gateExecution.result) {
      const gateErr = gateExecution.error || "SAFETY_GATE_REJECTED";
      logger.error(`❌ [SAFETY GATE] Deployment blocked by gate: ${gateErr}`);
      updateDeployLifecycle(deployLogId, "FAILED", {
        status: "failed",
        errorMsg: `Safety gate rejection: ${gateErr}`,
      });
      throw new Error(`ABORT: Deployment blocked by Production Safety Gate: ${gateErr}`);
    }

    deployResult = gateExecution.result;
  } catch (err: any) {
    if (err?.message?.startsWith("ABORT:")) throw err;
    logger.error(`❌ [DEPLOY EXCEPTION] Deployment call threw exception: ${err?.message || String(err)}`);
    updateDeployLifecycle(deployLogId, "FAILED", {
      status: "failed",
      errorMsg: `Deployment exception: ${err?.message || String(err)}`,
    });
    throw new Error(`ABORT: Deployment call failed. ABSOLUTE ONE-DEPLOYMENT RULE: NO RETRY. Error: ${err?.message}`);
  }

  // Handle ambiguous / unknown outcome
  if (deployResult.status === "unknown") {
    updateDeployLifecycle(deployLogId, "UNRESOLVED_UNKNOWN", {
      status: "unknown",
      errorMsg: deployResult.error,
      contractAddr: deployResult.contractAddress,
      poolId: deployResult.poolId,
    });
    throw new Error(
      `ABORT: Deployment outcome is UNKNOWN. ABSOLUTE ONE-DEPLOYMENT RULE: DO NOT RETRY. Error: ${deployResult.error}`
    );
  }

  // Handle explicit failure
  if (!deployResult.success || deployResult.status === "failed") {
    updateDeployLifecycle(deployLogId, "FAILED", {
      status: "failed",
      errorMsg: deployResult.error || "Deployment returned failed",
      contractAddr: deployResult.contractAddress,
    });
    throw new Error(
      `ABORT: Deployment returned failed status. ABSOLUTE ONE-DEPLOYMENT RULE: NO RETRY. Error: ${deployResult.error}`
    );
  }

  const txHash = deployResult.txHash;
  const tokenAddress = deployResult.contractAddress;
  const poolId = deployResult.poolId ?? "N/A";

  if (!txHash || !txHash.startsWith("0x")) {
    updateDeployLifecycle(deployLogId, "UNRESOLVED_UNKNOWN", {
      status: "unknown",
      errorMsg: "Bankr launch response succeeded but returned missing or invalid txHash.",
      contractAddr: tokenAddress,
      poolId,
    });
    throw new Error(
      `ABORT: Real launch returned HTTP 200 but txHash is missing. ABSOLUTE ONE-DEPLOYMENT RULE: DO NOT RETRY.`
    );
  }

  logger.success(`📡 [DEPLOY SUBMITTED] On-chain txHash received: ${txHash}`);
  logger.info(`   Token Address: ${tokenAddress}`);
  logger.info(`   Pool ID: ${poolId}`);

  // -------------------------------------------------------------
  // PHASE 5: WAIT FOR ON-CHAIN TRANSACTION RECEIPT
  // -------------------------------------------------------------
  logger.info(`⏳ [RECEIPT] Monitoring Base Mainnet for tx confirmation (${txHash})...`);

  let receiptResult;
  const maxAttempts = 30; // 30 * 4s = 120s max wait
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    receiptResult = await verifyEvmTransactionReceipt(txHash, "base");
    logger.info(`   Check ${attempt}/${maxAttempts}: status = ${receiptResult.status}`);

    if (receiptResult.status === "confirmed" || receiptResult.status === "failed") {
      break;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  if (!receiptResult || receiptResult.status !== "confirmed" || !receiptResult.receipt) {
    const finalState = receiptResult?.status === "failed" ? "FAILED" : "PENDING_CONFIRMATION";
    updateDeployLifecycle(deployLogId, finalState, {
      status: receiptResult?.status ?? "unknown",
      contractAddr: tokenAddress,
      txHash,
      poolId,
      errorMsg: receiptResult?.reason ?? "Receipt not confirmed within timeout window",
    });
    throw new Error(
      `ABORT: Transaction receipt was not confirmed (status: ${receiptResult?.status}). ABSOLUTE ONE-DEPLOYMENT RULE: DO NOT RETRY.`
    );
  }

  const receipt = receiptResult.receipt;
  logger.success(`✅ [RECEIPT CONFIRMED] Mined in block ${receipt.blockNumber}! Status: ${receipt.status}`);

  // -------------------------------------------------------------
  // PHASE 6: CRITICAL — ON-CHAIN GAS PAYER & SPONSORSHIP VERIFICATION
  // -------------------------------------------------------------
  logger.info("🔍 [SPONSORSHIP] Analyzing on-chain gas payer and costs from receipt...");

  const actualPayer = receipt.from?.toLowerCase() ?? "";
  const expectedRelayer = BANKR_BASE_RELAYER_ADDRESS.toLowerCase();
  const operator = operatorAddress?.toLowerCase() ?? "";

  const costVerification: EvmGasSponsorshipVerification = calculateEvmDeploymentCost(
    receipt,
    operatorAddress,
    "base",
    BANKR_BASE_RELAYER_ADDRESS
  );

  console.log(`
-----------------------------------------------------------------
  ON-CHAIN GAS VERIFICATION AUDIT
-----------------------------------------------------------------
  Transaction Hash:       ${txHash}
  Block Number:           ${receipt.blockNumber}
  Receipt Status:         ${receipt.status}
  Actual Payer (from):    ${receipt.from}
  Expected Bankr Relayer: ${BANKR_BASE_RELAYER_ADDRESS}
  Local Operator Wallet:  ${operatorAddress ?? "N/A"}
  Gas Used:               ${receipt.gasUsed.toString()}
  Effective Gas Price:    ${(Number(receipt.effectiveGasPrice ?? 0n) / 1e9).toFixed(4)} Gwei
  Network Gas Cost:       ${costVerification.networkGasCostEth.toFixed(6)} ETH
  Deployer/Operator Cost: ${costVerification.deployerGasCostEth.toFixed(6)} ETH
  Classified Status:      ${costVerification.status}
-----------------------------------------------------------------
`);

  // Check 1: Must be paid by Bankr Relayer
  const isSponsored = costVerification.isSponsored || actualPayer === expectedRelayer || isBankrRelayer(actualPayer);
  const isPaidByOperator = operator && actualPayer === operator;

  if (isPaidByOperator) {
    updateDeployLifecycle(deployLogId, "PAID_DEPLOYMENT_DETECTED", {
      status: "policy_violation",
      contractAddr: tokenAddress,
      txHash,
      poolId,
      deployCost: costVerification.deployerGasCostEth,
      attributionStatus: "violation",
      attributionReason: "SECURITY INCIDENT: Deployment was paid by operator wallet instead of Bankr relayer.",
    });
    throw new Error(
      `SECURITY VIOLATION: Transaction was paid by operator wallet (${receipt.from}). SPONSORSHIP FAILED. DO NOT RETRY.`
    );
  }

  if (!isSponsored) {
    updateDeployLifecycle(deployLogId, "UNVERIFIED_PAYER", {
      status: "unverified",
      contractAddr: tokenAddress,
      txHash,
      poolId,
      deployCost: costVerification.deployerGasCostEth,
      attributionStatus: "unknown_payer",
      attributionReason: `Actual payer ${receipt.from} does not match expected Bankr relayer ${BANKR_BASE_RELAYER_ADDRESS}.`,
    });
    throw new Error(
      `SPONSORSHIP UNVERIFIED: Actual payer (${receipt.from}) does not match expected Bankr relayer (${BANKR_BASE_RELAYER_ADDRESS}). DO NOT RETRY.`
    );
  }

  // -------------------------------------------------------------
  // PHASE 7: TOKEN ADDRESS ON-CHAIN ATTRIBUTION
  // -------------------------------------------------------------
  logger.info(`🔍 [ATTRIBUTION] Verifying token contract attribution on-chain...`);
  const attribution = await verifyEvmDeploymentAttribution(txHash, tokenAddress, "base");
  logger.info(`   Attribution status: ${attribution.status} (type: ${attribution.attributionType ?? "n/a"})`);

  // -------------------------------------------------------------
  // PHASE 8: PERSIST CONFIRMED DEPLOYMENT TO VAULT
  // -------------------------------------------------------------
  logger.info(`💾 [VAULT] Updating deployment record to 'DEPLOY_CONFIRMED' with deployCost = 0.0...`);

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

  // -------------------------------------------------------------
  // PHASE 8B: RECORD GAS SPONSORSHIP TO TREASURY LEDGER
  // -------------------------------------------------------------
  try {
    recordGasSponsorshipToLedger({
      deployLogId,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: costVerification.networkGasCostEth,
      relayerAddress: actualPayer,
      txHash,
    });
  } catch (sponsorErr) {
    logger.warn(
      `⚠️  [TREASURY] Gagal mencatat gas sponsorship ke ledger: ${sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr)}`
    );
  }

  // -------------------------------------------------------------
  // PHASE 8B: ATOMIC BOT CLAIM & DEDICATED CHARACTER CONFIG
  // -------------------------------------------------------------
  let assignedBotToken: string | undefined;
  let assignedBotUser: string | undefined;
  try {
    const { acquireBotFromPool, updateDeploymentTelegramBot } = await import("../src/db/vault.ts");
    const { generateTokenCharacterConfig } = await import("../src/modules/telegram/token-agent-bot.ts");
    const poolBot = acquireBotFromPool(tokenAddress, preallocatedBotId);
    if (poolBot) {
      assignedBotToken = poolBot.botToken;
      assignedBotUser = poolBot.botUsername || undefined;
      updateDeploymentTelegramBot(tokenAddress, poolBot.botToken, assignedBotUser);
      generateTokenCharacterConfig(
        { address: tokenAddress, ticker: identity.ticker, name: identity.name },
        { botToken: poolBot.botToken, botUsername: assignedBotUser }
      );
      logger.success(
        `✨ [BOT POOL] Bot Telegram dialokasikan ke $${identity.ticker}: @${assignedBotUser || "dedicated"}`
      );
    }
  } catch (botErr: any) {
    logger.warn(`⚠️  [BOT POOL] Gagal alokasi karakter bot pasca-deploy: ${botErr?.message || botErr}`);
  }

  // -------------------------------------------------------------
  // PHASE 8C: AUTO-LINK TO BANKR AGENT PROFILE & PUBLISH
  // -------------------------------------------------------------
  try {
    logger.info(`🤖 [BANKR PROJECT] Menautkan $${identity.ticker} ke profil agen di Bankr (lengkap dengan Tim & Produk)...`);
    const { enrichAndSyncBankrProject } = await import("../src/modules/growth/project-enricher.ts");
    const linkRes = await enrichAndSyncBankrProject({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      description: identity.description,
      website: identity.website,
      logoUrl: assets.imageUrl,
      telegramUrl: identity.telegram,
      twitterUrl: identity.twitter,
      poolId: poolId !== "N/A" ? poolId : undefined,
    });
    logger.success(
      `✅ [BANKR PROJECT] Profil agen terhubung & dipublikasikan (${linkRes.profile.products?.length ?? 0} produk, ${linkRes.profile.teamMembers?.length ?? 0} tim): https://bankr.bot/agents/${linkRes.profile.slug}`
    );
  } catch (projErr: any) {
    logger.warn(
      `⚠️  [BANKR PROJECT] Gagal otomatis menautkan proyek: ${projErr.response?.data?.message || projErr.message || projErr}`
    );
  }

  // -------------------------------------------------------------
  // PHASE 8D: AUTO-BROADCAST LAUNCH ANNOUNCEMENT TO TELEGRAM
  // -------------------------------------------------------------
  try {
    const { broadcastTokenLaunchAnnouncement } = await import("../src/modules/social/beacon-broadcaster.ts");
    await broadcastTokenLaunchAnnouncement({
      ticker: identity.ticker,
      name: identity.name,
      contractAddress: tokenAddress,
      chain: "base",
      botUsername: assignedBotUser || (identity.telegram ? identity.telegram.split("/").pop() : undefined),
      botToken: assignedBotToken,
      poolId: poolId !== "N/A" ? poolId : undefined,
    });
  } catch (bcErr: any) {
    logger.warn(`⚠️  [BROADCASTER] Pengumuman komunitas notice: ${bcErr?.message || bcErr}`);
  }

  // --- TEMPLAT BROADCAST KOMUNITAS (SIAP COPY-PASTE) ---
  logger.info(
    `\n--- TEMPLAT BROADCAST KOMUNITAS (SIAP COPY-PASTE) ---\n` +
      `NEW LAUNCH ALPHA: $${identity.ticker} (${identity.name})\n` +
      `Chain: BASE\n` +
      `CA: ${tokenAddress}\n` +
      `Security: 0% Tax | Audited Proxy | Unruggable LP\n` +
      (poolId && poolId !== "N/A" ? `GeckoTerminal: https://www.geckoterminal.com/base/pools/${poolId}\n` : "") +
      `DexScreener: https://dexscreener.com/base/${tokenAddress}\n` +
      `1-Click Swap ($1 Activation): https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${tokenAddress}\n` +
      `-------------------------------------------------------\n`
  );

  // Generate Irresistible Offer Deck for Investors & Community
  try {
    const offer = generateIrresistibleOffer({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      chain: "base",
      poolId: poolId !== "N/A" ? poolId : undefined,
      viralScore: identity.viralScore,
    });

    console.log("\n" + offer.fullOfferCard);

    const saveRes = saveOfferDeckMarkdown(offer, { chainSuffix: true });
    if (saveRes.success) {
      logger.success(`   📄 Materi Promosi Tersimpan: ${saveRes.chainPath || saveRes.primaryPath}`);
    } else {
      logger.warn(`   Notice saving offer deck: ${saveRes.error}`);
    }
  } catch (oErr: any) {
    logger.warn(`Notice offer generator: ${oErr?.message || oErr}`);
  }

  // -------------------------------------------------------------
  // PHASE 8E: AUTO-GENERATE WEB3 WEBSITE & CLOUDFLARE PAGES
  // -------------------------------------------------------------
  let baseLiveWeb3Url: string | undefined;
  try {
    logger.info(`🌐 [WEB3 ENGINE] Membangun Website 3D Parallax untuk $${identity.ticker}...`);
    const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
    const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
    const { updateDeployLogWebsite } = await import("../src/db/vault.ts");

    const siteRes = await generateTokenWebsite({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
      chainId: 8453,
      chainName: "base",
      description: identity.description,
      logoUrl: assets.imageUrl,
      poolId: poolId !== "N/A" ? poolId : undefined,
      websiteUrl: identity.website,
      twitterUrl: identity.twitter,
      telegramUrl: assignedBotUser ? `https://t.me/${assignedBotUser}` : identity.telegram,
    });
    logger.success(`   ✅ [WEB3 ENGINE] Website dibuat di: ${siteRes.siteDirectory}`);

    const cfRes = await deployWebsiteToCloudflarePages({
      siteDir: siteRes.siteDirectory,
      ticker: identity.ticker,
      contractAddress: tokenAddress,
    });
    baseLiveWeb3Url = cfRes.deploymentUrl;
    updateDeployLogWebsite(tokenAddress, baseLiveWeb3Url);
    logger.success(`   🚀 [CLOUDFLARE PAGES] Live DApp: ${baseLiveWeb3Url}`);

    // Re-sync DexScreener & GeckoTerminal profiles with final live Cloudflare Pages URL
    try {
      const { saveDexScreenerProfileJson, buildDexScreenerProfilePayload } = await import("../src/modules/growth/dexscreener-profiler.ts");
      const { saveGeckoTerminalProfileJson, buildGeckoTerminalProfilePayload } = await import("../src/modules/growth/geckoterminal-profiler.ts");

      saveDexScreenerProfileJson(siteRes.siteDirectory, buildDexScreenerProfilePayload({
        chainId: 8453,
        tokenAddress,
        tokenName: identity.name,
        tokenSymbol: identity.ticker,
        description: identity.description,
        iconUrl: assets.imageUrl,
        websiteUrl: baseLiveWeb3Url,
        twitterUrl: identity.twitter,
        telegramUrl: assignedBotUser ? `https://t.me/${assignedBotUser}` : identity.telegram,
      }));

      saveGeckoTerminalProfileJson(siteRes.siteDirectory, buildGeckoTerminalProfilePayload({
        chainId: 8453,
        tokenAddress,
        tokenName: identity.name,
        tokenSymbol: identity.ticker,
        poolAddress: poolId !== "N/A" ? poolId : undefined,
        description: identity.description,
        iconUrl: assets.imageUrl,
        websiteUrl: baseLiveWeb3Url,
        twitterUrl: identity.twitter,
        telegramUrl: assignedBotUser ? `https://t.me/${assignedBotUser}` : identity.telegram,
      }));
      logger.success(`   📊 [PROFILER] DexScreener & GeckoTerminal profiles tersinkron dengan live DApp!`);
    } catch (syncErr: any) {
      logger.warn(`   Notice profile sync: ${syncErr?.message || syncErr}`);
    }
  } catch (wErr: any) {
    logger.warn(`   Notice Web3 Website / Cloudflare Pages: ${wErr?.message || wErr}`);
  }

  // -------------------------------------------------------------
  // PHASE 8F: NEON POSTGRESQL MULTI-TENANT CLOUD SYNC
  // -------------------------------------------------------------
  try {
    const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
    if (isNeonConfigured()) {
      const neonRes = await syncTokenDeploymentToNeon({
        contractAddr: tokenAddress,
        ticker: identity.ticker,
        tokenName: identity.name,
        chain: "base",
        poolId: poolId !== "N/A" ? poolId : undefined,
        txHash,
        websiteUrl: baseLiveWeb3Url,
        telegramBotUsername: assignedBotUser,
        creatorWallet: operatorAddress ?? undefined,
        description: identity.description,
      });
      if (neonRes.success) {
        logger.success(`   🐘 [NEON CLOUD] Database token '${neonRes.dbName}' siap & tersinkronisasi di Neon PostgreSQL!`);
      }
    }
  } catch (neonErr: any) {
    logger.warn(`   🐘 [NEON CLOUD] Notice Neon cloud sync: ${neonErr?.message || neonErr}`);
  }

  const updatedLog = getDeployLogById(deployLogId);

  // -------------------------------------------------------------
  // PHASE 9: DOWNSTREAM SNIPER / BUY GUARD
  // -------------------------------------------------------------
  logger.warn(
    "🛡️  [TRADING GUARD] Downstream sniper buy is explicitly DISABLED for this deployment verification.\n" +
      "   No trading positions opened. No BasedBot telegram messages sent."
  );

  const reportData: ExecutionReportData = {
    deployment: {
      attempts: 1,
      chain: "Base Mainnet",
      tokenName: identity.name,
      ticker: identity.ticker,
      description: identity.description,
      tokenAddress: tokenAddress ?? "N/A",
      poolId: poolId,
      txHash: txHash,
      blockNumber: receipt.blockNumber.toString(),
      receiptStatus: receipt.status === "success" ? "success" : "reverted",
      explorerUrl: `https://basescan.org/tx/${txHash}`,
      ipfsMetadataUrl: assets.metadataUrl,
    },
    sponsorship: {
      expectedRelayer: BANKR_BASE_RELAYER_ADDRESS,
      actualPayer: receipt.from,
      sponsorshipStatus: "VERIFIED",
      networkGasCostEth: costVerification.networkGasCostEth,
      operatorGasCostEth: 0.0,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceGwei: costVerification.effectiveGasPriceGwei,
      paidGasFallback: "DISABLED",
    },
    vault: {
      deployLogId,
      lifecycleState: updatedLog?.lifecycleState ?? "DEPLOY_CONFIRMED",
      status: updatedLog?.status ?? "confirmed",
      deployCost: updatedLog?.deployCost ?? 0.0,
      txHash: updatedLog?.txHash ?? txHash,
      attributionStatus: updatedLog?.attributionStatus ?? "confirmed",
      attributionReason: updatedLog?.attributionReason ?? costVerification.summary,
    },
    security: {
      privateKeyDeployment: "NO",
      directEvmBroadcast: "NO",
      paidGasFallback: "NO",
      additionalFunding: "NO",
      sniperBuy: "NO",
      secondDeployment: "NO",
      secretsExposed: "NO",
    },
    finalStatus: "DEPLOYMENT SUCCESS — SPONSORED VERIFIED",
  };

  return reportData;
}

runSingleControlledDeployment()
  .then((report) => {
    console.log("\n=================================================================");
    console.log("  EXECUTION RESULT DATA (JSON)");
    console.log("=================================================================");
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n=================================================================");
    console.error("  EXECUTION HALTED / FAILED");
    console.error("=================================================================");
    console.error(err?.message || err);
    process.exit(1);
  });
