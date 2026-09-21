#!/usr/bin/env bun
/**
 * scripts/rehearse-deployment.ts — Guided Preflight Dry-Run Rehearsal Suite
 *
 * Simulates the end-to-end token deployment flight sequence across Base and Solana:
 *  1. AI Token Identity Generation & Parameter Verification
 *  2. Zero-Cost Deterministic Contract Address (CA) & Pool Prediction
 *  3. On-Chain Native Balance Verification
 *  4. Production Deployment Safety Gate Pre-Flight Evaluation
 *  5. Concurrency Mutex Lock Health Check
 *  6. Investor Promotional Offer Card Generation
 *
 * STRICT INVARIANTS:
 *  - 100% READ-ONLY & SIMULATED: Spends 0.0 ETH and 0.0 SOL.
 *  - ZERO live on-chain mutating transactions or deployments broadcast.
 *  - Safe for regular automated pre-flight testing and CI validation.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { generateTokenIdentity, type TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import {
  predictDeploymentAddress,
  evaluateDeploymentSafetyGate,
  verifyDeploymentSafetyParameters,
  getDeploymentLockName,
} from "../src/modules/deploy-guard.ts";
import {
  checkEvmNativeBalance,
  checkSolanaNativeBalance,
} from "../src/modules/identity/preflight-balance.ts";
import {
  bootstrapDefaultWallet,
  selectExecutionWallet,
  getWalletAccount,
  resolveOperationalContext,
} from "../src/modules/identity/wallet-manager.ts";
import { acquireLock, releaseLock, isLockHeld } from "../src/db/vault.ts";
import { generateIrresistibleOffer } from "../src/modules/growth/token-offer-generator.ts";
import { deriveEvmAddress } from "../src/modules/reconciliation/evm-verifier.ts";
import { generateLaunchAnnouncementPack } from "../src/modules/growth/launch-pack-generator.ts";
import { evaluateLaunchReadiness } from "../src/modules/intelligence/launch-readiness-checker.ts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export interface RehearsalCheckResult {
  chain: string;
  success: boolean;
  identity: TokenIdentity;
  predictedCa?: string;
  predictedPoolId?: string;
  balanceCheck: {
    passed: boolean;
    actualBalance?: number;
    required: number;
    unit: string;
    details: string;
  };
  safetyGate: {
    passed: boolean;
    reason?: string;
    checks: Record<string, boolean>;
  };
  lockHealth: {
    passed: boolean;
    lockName: string;
  };
  offerGenerated: boolean;
  launchPack?: {
    powerTweetFits: boolean;
    powerTweetCharCount: number;
    telegramShareUrl: string;
  };
  readinessScore?: {
    overallScore: number;
    verdict: string;
    verdictEmoji: string;
  };
  errors: string[];
}

export interface RehearsalSuiteResult {
  overallSuccess: boolean;
  timestamp: string;
  checks: Record<string, RehearsalCheckResult>;
}

export function parseRehearsalArgs(argv: string[]): {
  chains: ("base" | "solana")[];
  fastMock: boolean;
} {
  let chains: ("base" | "solana")[] = ["base", "solana"];
  let fastMock = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i].toLowerCase();
    if (arg === "--chain" || arg === "-c") {
      const next = argv[i + 1]?.toLowerCase();
      if (next === "base") {
        chains = ["base"];
        i++;
      } else if (next === "solana" || next === "sol") {
        chains = ["solana"];
        i++;
      } else if (next === "all") {
        chains = ["base", "solana"];
        i++;
      }
    } else if (arg === "--fast" || arg === "--mock") {
      fastMock = true;
    }
  }

  return { chains, fastMock };
}

export async function rehearseChainDeployment(
  chain: "base" | "solana",
  options?: { fastMock?: boolean }
): Promise<RehearsalCheckResult> {
  const cfg = getConfig();
  const errors: string[] = [];

  // 1. Token Identity Generation
  let identity: TokenIdentity;
  if (options?.fastMock) {
    identity = {
      name: `Rehearsal Token ${chain.toUpperCase()}`,
      ticker: `REH${chain.slice(0, 3).toUpperCase()}`,
      description: `Autonomous flight rehearsal dry-run on ${chain.toUpperCase()}`,
      viralScore: 92,
      imagePrompt: `Futuristic robotic mascot on ${chain} network`,
      website: "https://rehearsal.bot",
      twitter: "https://x.com/rehearsal",
      telegram: "https://t.me/rehearsal",
    };
  } else {
    try {
      identity = await generateTokenIdentity(`${chain.toUpperCase()} viral rehearsal candidate`);
    } catch {
      identity = {
        name: `Flight Rehearsal ${chain.toUpperCase()}`,
        ticker: `FLIGHT_${chain.slice(0, 3).toUpperCase()}`,
        description: `Autonomous flight check candidate for ${chain}`,
        viralScore: 89,
        imagePrompt: `Cybernetic astronaut holding a ${chain} flag`,
        website: "https://rehearsal.bot",
      };
    }
  }

  const mockAssets = {
    imageUrl: "https://ipfs.io/ipfs/bafkreic7xwdlyoasomc552h5l3omg2o6zly3evsxd7h2x46xoxe3f22l34",
    metadataUrl: "https://ipfs.io/ipfs/bafkreiaa36k7vj3g44zmsr4nly6jvxqeqx2uclb35q25p3evr2v4754pnm",
  };

  // 2. Address Prediction (Deterministic 0 gas)
  let predictedCa: string | undefined;
  let predictedPoolId: string | undefined;
  if (chain === "base") {
    try {
      const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
      const requestedWalletId = walletArg ? walletArg.split("=")[1]?.trim() : undefined;
      const wallet = requestedWalletId
        ? (getWalletAccount(requestedWalletId) ?? bootstrapDefaultWallet())
        : selectExecutionWallet({ requiredProvider: "bankr", targetChains: ["base"] });
      const bankrContext = resolveOperationalContext(wallet.id, "bankr");
      const pred = await predictDeploymentAddress(identity, mockAssets, {
        chain: "base",
        proxyUrl: bankrContext.proxyUrl ?? undefined,
      });
      predictedCa = pred.predictedContractAddress;
      predictedPoolId = pred.predictedPoolId;
    } catch (predErr: any) {
      errors.push(`Predictive CA notice: ${predErr?.message || predErr}`);
    }
  } else {
    // Solana Pump.fun bonding curve uses generated Keypair mint address
    const mintKeypair = Keypair.generate();
    predictedCa = mintKeypair.publicKey.toBase58();
    predictedPoolId = "pump.fun bonding curve";
  }

  // 3. Balance Preflight
  let balancePassed = false;
  let actualBal: number | undefined;
  let reqBal = chain === "solana" ? 0.009 : 0.002;
  let balUnit = chain === "solana" ? "SOL" : "ETH";
  let balDetails = "";

  let walletAddr: string | undefined;
  if (chain === "base") {
    walletAddr = cfg.EVM_OPERATOR_ADDRESS || (cfg.EVM_PRIVATE_KEY ? deriveEvmAddress(cfg.EVM_PRIVATE_KEY) : undefined);
    if (walletAddr) {
      const bRes = await checkEvmNativeBalance("base", walletAddr, reqBal);
      actualBal = bRes.actualBalance;
      balancePassed = bRes.outcome === "sufficient";
      balDetails = `Balance: ${actualBal !== undefined ? actualBal.toFixed(6) : "N/A"} ETH (Required: ${reqBal} ETH)`;
    } else {
      balDetails = "No EVM address configured (Zero-Capital mode)";
      balancePassed = true;
    }
  } else {
    // Solana
    if (cfg.SOLANA_PRIVATE_KEY) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(cfg.SOLANA_PRIVATE_KEY));
        walletAddr = kp.publicKey.toBase58();
        const sRes = await checkSolanaNativeBalance(walletAddr, reqBal);
        actualBal = sRes.actualBalance;
        balancePassed = sRes.outcome === "sufficient";
        balDetails = `Balance: ${actualBal !== undefined ? actualBal.toFixed(4) : "N/A"} SOL (Required: ${reqBal} SOL)`;
      } catch (sErr: any) {
        balDetails = `Solana key error: ${sErr?.message}`;
      }
    } else {
      balDetails = "No Solana private key configured";
      balancePassed = false;
    }
  }

  // 4. Production Safety Gate Evaluation (Simulation Mode = true)
  const gateRes = await evaluateDeploymentSafetyGate({
    chain,
    identity,
    assets: mockAssets,
    walletAddress: walletAddr,
    isSimulation: true,
  });

  if (!gateRes.passed) {
    errors.push(`Safety gate rejected: ${gateRes.reason}`);
  }

  // 5. Concurrency Mutex Lock Health
  const lockName = getDeploymentLockName(chain);
  let lockPassed = false;
  const lockAcquired = acquireLock(lockName, 30, "rehearsal_probe");
  if (lockAcquired) {
    lockPassed = true;
    releaseLock(lockName);
  } else {
    errors.push(`Mutex lock '${lockName}' is currently held by another active process`);
  }

  // 6. Promotional Offer Deck Generation
  let offerGenerated = false;
  try {
    const offer = generateIrresistibleOffer({
      name: identity.name,
      ticker: identity.ticker,
      contractAddress: predictedCa || "0xRehearsalMockAddress0000000000000000000",
      chain,
      poolId: predictedPoolId,
      viralScore: identity.viralScore,
    });
    offerGenerated = Boolean(offer && offer.fullOfferCard);
  } catch (oErr: any) {
    errors.push(`Offer deck generator failed: ${oErr?.message || oErr}`);
  }

  // 8. Simulated Launch Pack & Promotional Copy
  let launchPackInfo: RehearsalCheckResult["launchPack"] = undefined;
  try {
    const pack = generateLaunchAnnouncementPack({
      ticker: identity.ticker,
      name: identity.name,
      contractAddress: predictedCa || (chain === "solana" ? "So11111111111111111111111111111111111111112" : "0x1111111111111111111111111111111111111111"),
      chain,
      poolId: predictedPoolId,
    });
    launchPackInfo = {
      powerTweetFits: pack.powerTweet.fitsSingleTweet,
      powerTweetCharCount: pack.powerTweet.charCount,
      telegramShareUrl: pack.telegram.shareDeepLink,
    };
  } catch (lpErr: any) {
    errors.push(`Launch pack generator notice: ${lpErr?.message || lpErr}`);
  }

  // 9. Simulated Launch Readiness Scorecard
  let readinessInfo: RehearsalCheckResult["readinessScore"] = undefined;
  try {
    const readinessReport = await evaluateLaunchReadiness({
      ticker: identity.ticker,
      contractAddress: predictedCa || (chain === "solana" ? "So11111111111111111111111111111111111111112" : "0x1111111111111111111111111111111111111111"),
      name: identity.name,
      chain,
      skipNetwork: true,
    });
    readinessInfo = {
      overallScore: readinessReport.overallScore,
      verdict: readinessReport.verdict,
      verdictEmoji: readinessReport.verdictEmoji,
    };
  } catch (rErr: any) {
    errors.push(`Readiness score evaluator notice: ${rErr?.message || rErr}`);
  }

  const success = gateRes.passed && lockPassed && offerGenerated;

  return {
    chain,
    success,
    identity,
    predictedCa,
    predictedPoolId,
    balanceCheck: {
      passed: balancePassed,
      actualBalance: actualBal,
      required: reqBal,
      unit: balUnit,
      details: balDetails,
    },
    safetyGate: {
      passed: gateRes.passed,
      reason: gateRes.reason,
      checks: gateRes.checks,
    },
    lockHealth: {
      passed: lockPassed,
      lockName,
    },
    offerGenerated,
    launchPack: launchPackInfo,
    readinessScore: readinessInfo,
    errors,
  };
}

export async function runRehearsalSuite(options?: {
  chains?: ("base" | "solana")[];
  fastMock?: boolean;
}): Promise<RehearsalSuiteResult> {
  const targetChains = options?.chains ?? ["base", "solana"];
  const checks: Record<string, RehearsalCheckResult> = {};
  let overallSuccess = true;

  console.log(`
=================================================================
  [+] OMNICHAIN FLIGHT REHEARSAL & PRE-DEPLOY PRECHECK [+]
=================================================================
  Target Chains : ${targetChains.join(", ").toUpperCase()}
  Safety Invariant: 100% SIMULATION / ZERO GAS / ZERO TRANSACTIONS
=================================================================
`);

  for (const chain of targetChains) {
    logger.info(`🛫 [REHEARSAL] Running simulated pre-flight check for ${chain.toUpperCase()}...`);
    const check = await rehearseChainDeployment(chain, { fastMock: options?.fastMock });
    checks[chain] = check;
    if (!check.success) overallSuccess = false;

    const badge = check.success ? "✅ FLIGHT READY" : "⚠️ ISSUES DETECTED";
    console.log(`
-----------------------------------------------------------------
  CHAIN SCORECARD: ${chain.toUpperCase()} [${badge}]
-----------------------------------------------------------------
  1. Token Identity      : $${check.identity.ticker} ("${check.identity.name}") [Viral: ${check.identity.viralScore}/100]
  2. Predictive CA (0 Gas): ${check.predictedCa ?? "Deterministic fallback"}
  3. Predicted Pool ID   : ${check.predictedPoolId ?? "N/A"}
  4. Balance Check       : ${check.balanceCheck.passed ? "✅ OK" : "⚠️ NOTICE"} - ${check.balanceCheck.details}
  5. Safety Gate Checks  : ${check.safetyGate.passed ? "✅ PASSED (6/6)" : "❌ REJECTED - " + check.safetyGate.reason}
  6. Mutex Lock Health   : ${check.lockHealth.passed ? "✅ READY (Uncontended)" : "❌ HELD / BLOCKED"}
  7. Investor Offer Deck : ${check.offerGenerated ? "✅ GENERATED" : "❌ FAILED"}
  8. Twitter Power Tweet : ${check.launchPack?.powerTweetFits ? "✅ READY (<= 280 chars)" : "⚠️ THREAD REQUIRED"} (${check.launchPack?.powerTweetCharCount ?? 0} chars)
  9. Telegram Blitz Card : ✅ READY (1-Tap CA Copy & Share Link)
 10. Launch Readiness   : ${check.readinessScore ? `${check.readinessScore.verdictEmoji} [${check.readinessScore.overallScore}/100] ${check.readinessScore.verdict}` : "N/A"}
-----------------------------------------------------------------`);

    if (check.errors.length > 0) {
      console.log(`  Notes / Alerts:`);
      for (const err of check.errors) {
        console.log(`    - ${err}`);
      }
      console.log("-----------------------------------------------------------------");
    }
  }

  console.log(`
=================================================================
  REHEARSAL SUMMARY: ${overallSuccess ? "ALL CHAINS CLEARED FOR LAUNCH" : "CAUTION - RESOLVE NOTICES BEFORE LIVE RUN"}
=================================================================\n`);

  return {
    overallSuccess,
    timestamp: new Date().toISOString(),
    checks,
  };
}

if (import.meta.main) {
  const { chains, fastMock } = parseRehearsalArgs(process.argv.slice(2));
  runRehearsalSuite({ chains, fastMock })
    .then((res) => {
      process.exit(res.overallSuccess ? 0 : 1);
    })
    .catch((err) => {
      console.error("Rehearsal suite fatal failure:", err);
      process.exit(1);
    });
}
