/**
 * index.ts — Orchestrator Utama: Omnichain Auto Viral Meme Deployer (Hardened V2.1)
 *
 * Explicit Lifecycle:
 *  DISCOVERED -> ANALYZED -> APPROVED -> ASSET_READY -> DEPLOY_SUBMITTED
 *  -> DEPLOY_CONFIRMED (or SIMULATED / UNRESOLVED_UNKNOWN / FAILED)
 *  -> BUY_SUBMITTED -> POSITION_OPEN -> POSITION_CLOSING -> POSITION_CLOSED
 *
 * Safety Guards:
 *  - simulation  -> NO BUY, NO POSITION
 *  - unknown     -> NO BUY, NO AUTO-RETRY, PERSIST FOR RECONCILIATION
 *  - failed      -> NO BUY, NO POSITION
 *  - confirmed   -> SAFE ANTI-SNIPE DELAY -> CONTROLLED BUY
 *  - Concurrency locks prevent cron overlap and duplicate execution
 *  - Wash trading (volume-bumper) prohibited & omitted
 */
import "dotenv/config";
import cron from "node-cron";
import { getConfig, getActiveChains } from "./config.ts";
import { logger } from "./logger.ts";
import { scanTrends } from "./modules/trend/firecrawl-radar.ts";
import { generateTokenIdentity } from "./modules/ai/gemini-brain.ts";
import { generateTokenLogo } from "./modules/image/pollinations-gen.ts";
import { uploadTokenAssets } from "./modules/ipfs/pinata-uploader.ts";
import { deployViaBankr } from "./modules/evm/bankr-deployer.ts";
import { deployViaPumpFun, sweepLeftoverSol } from "./modules/solana/pumpfun-deployer.ts";
import { snipeNewToken, snipeMultiAccountToken } from "./modules/sniper/basedbot-sniper.ts";
import { checkSaturation, type CrossChainSaturationResult } from "./modules/market/saturation-checker.ts";
import {
  buildIntelligenceSnapshot,
  buildDecisionInput,
  evaluateCandidateDecision,
} from "./modules/intelligence/decision-engine.ts";
import { checkAndExecuteExits } from "./modules/market/price-monitor.ts";
import { shillOnTwitter } from "./modules/social/twitter-shiller.ts";
import {
  confirmDeployment,
  verifyDeploymentSafetyParameters,
  predictDeploymentAddress,
  executeWithDeploymentSafetyGate,
} from "./modules/deploy-guard.ts";
import {
  runOnchainReconciliation,
  fetchOnchainTokenBalance,
  getWalletAddressForChain,
} from "./modules/reconciliation/onchain-reconciler.ts";
import { resolveCredential } from "./modules/identity/wallet-manager.ts";
import { resolveExecutableWalletForCycle } from "./modules/identity/execution-wallet-resolver.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  hasActiveOrPendingPosition,
  createPendingPosition,
  transitionPositionState,
  getTodayDeployCount,
  incrementTodayDeployCount,
  acquireLock,
  releaseLock,
  isLockHeld,
  generateCandidateId,
  recordSaturationObservations,
  type SaturationObservationInput,
  recordCycleStart,
  updateCycleOutcome,
  getRecentCycles,
  type CycleOutcomeUpdate,
  syncBotPoolFromEnv,
  acquireBotFromPool,
  peekNextAvailableBot,
  updateBotPoolUsername,
  updateDeploymentTelegramBot,
} from "./db/vault.ts";
import { generateTokenCharacterConfig } from "./modules/telegram/token-agent-bot.ts";
import { enrichAndSyncBankrProject } from "./modules/growth/project-enricher.ts";
import { broadcastTokenLaunchAnnouncement } from "./modules/social/beacon-broadcaster.ts";
import { checkAndEmitAlerts } from "./modules/owner/owner-alerts.ts";
import { buildSchedulingContext } from "./modules/intelligence/scheduling-context.ts";
import {
  evaluateSchedulingDecision,
  validateSchedulingPolicyConfig,
  type SchedulingPolicyConfig,
} from "./modules/intelligence/scheduling-policy.ts";

const ASCII_BANNER = `
╔═══════════════════════════════════════════════════════╗
║   🚀 OMNICHAIN AUTO VIRAL MEME DEPLOYER v2.1          ║
║   Gemini AI + Firecrawl + Pump.fun + Bankr (Hardened) ║
╚═══════════════════════════════════════════════════════╝
`;

/**
 * V2.5.2: Builds a SchedulingPolicyConfig from runtime environment configuration.
 * Validates the config at startup — invalid scheduling config surfaces as a thrown error,
 * not a silent fail-open. This is intentional: misconfigured policy bounds must not
 * silently produce an unrestricted deployment gate.
 */
function buildSchedulingPolicyConfig(cfg: ReturnType<typeof getConfig>): SchedulingPolicyConfig {
  const policyConfig: SchedulingPolicyConfig = {
    enabled: cfg.SCHEDULING_POLICY_ENABLED,
    baseIntervalMinutes: cfg.TREND_SCAN_INTERVAL_MINUTES,
    minIntervalMinutes: cfg.SCHEDULING_MIN_INTERVAL_MINUTES,
    maxIntervalMinutes: cfg.SCHEDULING_MAX_INTERVAL_MINUTES,
    cooldownMinutes: cfg.SCHEDULING_COOLDOWN_MINUTES,
    maxDeploysPerDay: cfg.MAX_DEPLOYS_PER_DAY,
    adaptiveEnabled: cfg.SCHEDULING_ADAPTIVE_ENABLED,
    adaptationFactor: cfg.SCHEDULING_ADAPTATION_FACTOR,
    warmupCycles: cfg.SCHEDULING_WARMUP_CYCLES,
  };

  const validation = validateSchedulingPolicyConfig(policyConfig);
  if (!validation.valid) {
    throw new Error(
      `[SCHED-GATE] Invalid scheduling policy configuration: ${validation.errors.join("; ")}`
    );
  }

  return policyConfig;
}

/**
 * Pipeline utama: satu siklus lengkap dari scan tren hingga deploy dan buy terkontrol.
 */
export async function runDeployPipeline(): Promise<void> {
  const cfg = getConfig();
  const activeChains = getActiveChains();
  const lockTtlSeconds = (cfg.TREND_SCAN_INTERVAL_MINUTES || 30) * 60;

  // ─── V2.5.2: Adaptive Scheduling Gate ────────────────────────
  // Evaluated BEFORE cycle telemetry so gate-rejected cycles are not recorded.
  // Fails open ONLY when SchedulingContext cannot be built (missing data → conservative fallback).
  // Invalid configuration throws — it must not silently become an unrestricted gate.
  try {
    const policyConfig = buildSchedulingPolicyConfig(cfg);

    // Read scheduling inputs from persistent state
    const recentCompleted = getRecentCycles(1).find((c) => c.completedAt !== null);
    const lastCycleCompletedAt = recentCompleted?.completedAt ?? null;
    const todayDeployCount = getTodayDeployCount();
    const lockCurrentlyHeld = isLockHeld("deploy_pipeline", lockTtlSeconds);

    // Build SchedulingContext (fail-open: context errors → base interval fallback)
    let schedulingCtx;
    try {
      schedulingCtx = buildSchedulingContext(cfg.SCHEDULING_CONTEXT_WINDOW_DAYS);
    } catch (ctxErr) {
      logger.warn(`⚠️  [SCHED-GATE] Gagal membangun SchedulingContext, fallback ke base interval: ${String(ctxErr)}`);
      schedulingCtx = undefined;
    }

    const gateDecision = evaluateSchedulingDecision(policyConfig, {
      now: new Date().toISOString(),
      lastCycleCompletedAt,
      todayDeployCount,
      isLockHeld: lockCurrentlyHeld,
      context: schedulingCtx,
    });

    if (!gateDecision.canExecute) {
      logger.info(
        `[SCHED-GATE] action=${gateDecision.action} reason=${gateDecision.reason} ` +
        `adaptationReason=${gateDecision.adaptationReason} ` +
        `effectiveInterval=${gateDecision.effectiveIntervalMinutes}m ` +
        `baseInterval=${gateDecision.adaptationDetails.baseIntervalMinutes}m ` +
        `approvalRate=${gateDecision.adaptationDetails.approvalRate ?? "n/a"} ` +
        `dailyLimitPressure=${gateDecision.adaptationDetails.dailyLimitPressure ?? "n/a"} ` +
        `waitDurationMs=${gateDecision.waitDurationMs === Infinity ? "∞" : gateDecision.waitDurationMs} ` +
        `nextRunAt=${gateDecision.nextRunAt ?? "n/a"} ` +
        `lastCycleCompletedAt=${lastCycleCompletedAt ?? "none"} ` +
        `— ${gateDecision.message}`
      );
      return;
    }

    logger.info(
      `[SCHED-GATE] action=RUN reason=${gateDecision.reason} ` +
      `adaptationReason=${gateDecision.adaptationReason} ` +
      `effectiveInterval=${gateDecision.effectiveIntervalMinutes}m ` +
      `baseInterval=${gateDecision.adaptationDetails.baseIntervalMinutes}m ` +
      `approvalRate=${gateDecision.adaptationDetails.approvalRate ?? "n/a"} ` +
      `dailyLimitPressure=${gateDecision.adaptationDetails.dailyLimitPressure ?? "n/a"}`
    );
  } catch (gateErr) {
    // Invalid policy configuration must not be silently swallowed — re-throw
    logger.error(`[SCHED-GATE] Konfigurasi policy tidak valid: ${String(gateErr)}`);
    throw gateErr;
  }
  // ─── End V2.5.2 Gate ──────────────────────────────────────────

  // V2.5.0: Cycle Telemetry tracking
  let cycleId: number | undefined;
  const cycleStartTime = Date.now();
  const cycleOutcome: CycleOutcomeUpdate = {
    lockAcquired: false,
    dailyLimitHit: false,
    trendDataFound: false,
    identityFound: false,
    deploymentsAttempted: 0,
    deploymentsConfirmed: 0,
  };

  try {
    try {
      cycleId = recordCycleStart();
    } catch (err) {
      logger.warn(`⚠️  [TELEMETRY] Gagal record cycle start: ${String(err)}`);
    }

    // ─── Concurrency Guard: Cegah Cron Overlap ────────────────
    if (!acquireLock("deploy_pipeline", lockTtlSeconds)) {
      logger.warn("⚠️  [LOCK] Pipeline deploy sedang berjalan di proses/siklus lain. Siklus ini dilewati.");
      cycleOutcome.lockAcquired = false;
      return;
    }
    cycleOutcome.lockAcquired = true;

    try {
      logger.info("═══════════════ SIKLUS BARU DIMULAI ═══════════════");

      // ─── Safety Check: Batas Deploy Harian ───────────────────
      const todayCount = getTodayDeployCount();
      if (todayCount >= cfg.MAX_DEPLOYS_PER_DAY) {
        logger.warn(`⛔ Batas deploy harian tercapai (${todayCount}/${cfg.MAX_DEPLOYS_PER_DAY}). Tunggu besok.`);
        cycleOutcome.dailyLimitHit = true;
        return;
      }

      // ─── LIFECYCLE 1: DISCOVERED ─────────────────────────────
      const trendData = await scanTrends();
      if (!trendData) {
        logger.warn("⏭️  Tidak ada data tren. Siklus dilewati.");
        cycleOutcome.trendDataFound = false;
        return;
      }
      cycleOutcome.trendDataFound = true;

      // ─── LIFECYCLE 2: ANALYZED ───────────────────────────────
      const identity = await generateTokenIdentity(trendData.raw);
      if (!identity) {
        logger.warn("⏭️  AI gagal generate identitas. Siklus dilewati.");
        cycleOutcome.identityFound = false;
        return;
      }
      cycleOutcome.identityFound = true;

      // V2.4.1: Establish candidate identity for this discovery & evaluation cycle.
      // Ties asset generation, pre-deploy failures, saturation observations, and all multi-chain deployments together under one candidate lineage.
      const candidateId = generateCandidateId();
      cycleOutcome.candidateId = candidateId;

    // V2.4.3: Cross-chain saturation observation & persistence.
    // Recorded if saturation check is enabled; observations stored under candidateId for intelligence lineage.
    let saturationResult: CrossChainSaturationResult | undefined;
    let saturationCount: number | undefined;
    if (cfg.SATURATION_CHECK_ENABLED && identity.viralScore >= cfg.MIN_VIRAL_SCORE) {
      saturationResult = await checkSaturation(identity.ticker);
      saturationCount = saturationResult.count;

      const observations: SaturationObservationInput[] = [
        {
          candidateId,
          ticker: identity.ticker,
          chain: "global",
          observedCount: saturationResult.count,
          isSaturated: saturationResult.saturated,
          threshold: 3,
          source: saturationResult.source,
          providerStatus: saturationResult.providerStatus,
          observedAt: saturationResult.timestamp,
        },
        ...Object.values(saturationResult.byChain).map((d) => ({
          candidateId,
          ticker: identity.ticker,
          chain: d.chain,
          observedCount: d.observedCount,
          isSaturated: d.saturated,
          threshold: 3,
          source: saturationResult!.source,
          providerStatus: saturationResult!.providerStatus,
          observedAt: saturationResult!.timestamp,
        })),
      ];
      recordSaturationObservations(observations);
    }

    // ─── V2.4.4: INTELLIGENCE-TO-DECISION INTERFACE ───────────
    // Build IntelligenceSnapshot & DecisionInput without any wallet credentials or ledger state
    const intelligenceSnapshot = buildIntelligenceSnapshot({
      candidateId,
      tokenIdentity: identity,
      sources: trendData.sources,
      scrapedAt: trendData.scrapedAt,
      rawTrendLength: trendData.raw.length,
      saturationResult,
    });

    const decisionInput = buildDecisionInput(intelligenceSnapshot, {
      minViralScore: cfg.MIN_VIRAL_SCORE,
      saturationThreshold: 3,
      saturationCheckEnabled: cfg.SATURATION_CHECK_ENABLED,
      configuredChains: activeChains,
    });

    // ─── LIFECYCLE 3: APPROVED (DECISION EVALUATION) ──────────
    const decision = evaluateCandidateDecision(decisionInput);
    cycleOutcome.decisionApproved = decision.approved;

    if (!decision.approved) {
      cycleOutcome.rejectionReason = decision.rejectionReason;
      if (decision.rejectionReason === "LOW_VIRAL_SCORE") {
        logger.warn(`⏭️  Skor viral terlalu rendah (${identity.viralScore} < ${cfg.MIN_VIRAL_SCORE}). Siklus dilewati.`);
      } else if (decision.rejectionReason === "SATURATED") {
        logger.warn(`⏭️  Ticker $${identity.ticker} jenuh (${saturationResult?.message ?? decision.rejectionMessage}). Siklus dilewati.`);
      } else {
        logger.warn(`⏭️  Candidate ditolak [${decision.rejectionReason}]: ${decision.rejectionMessage} Siklus dilewati.`);
      }
      return;
    }

    logger.success(`🔥 Token kandidat disetujui: $${identity.ticker} — "${identity.name}" (skor: ${identity.viralScore})`);

    // ─── V2.8 & V2.9.1: CAPABILITY-AWARE MULTI-ACCOUNT RESOLUTION WITH FAULT-TOLERANT PREFLIGHT ───
    // Iteratively selects and validates eligible active operator wallets against provider routes,
    // operational readiness, and native balance preflight (Policy C).
    // If an underfunded wallet fails balance preflight, it is excluded for this cycle only and the resolver
    // selects from remaining candidates, preventing cycle starvation.
    const needsBankr = decision.eligibleChains.some((c) => c !== "solana");
    const resolution = await resolveExecutableWalletForCycle({
      requiredProvider: needsBankr ? "bankr" : "basedbot",
      targetChains: decision.eligibleChains,
      minEth: cfg.PREFLIGHT_MIN_BALANCE_ETH,
      minSol: cfg.PREFLIGHT_MIN_BALANCE_SOL,
      telegramBotTokenPresent: Boolean(cfg.TELEGRAM_BOT_TOKEN),
    });

    if (!resolution.success || !resolution.operatorWallet || !resolution.readinessDecision) {
      cycleOutcome.rejectionReason = resolution.rejectionReason ?? "PREFLIGHT_ABORTED";
      return;
    }

    const operatorWallet = resolution.operatorWallet;
    const bankrContext = resolution.bankrContext!;
    const basedbotContext = resolution.basedbotContext!;
    const readinessDecision = resolution.readinessDecision;
    // ─── End V2.9.1 Multi-Account Preflight Resolution ───────

    // ─── LIFECYCLE 4: ASSET_READY ────────────────────────────
    // Pre-allocate Dedicated Telegram Bot from pool before pinning metadata to IPFS
    syncBotPoolFromEnv();
    const peekedBot = peekNextAvailableBot();
    let preallocatedBotId: number | undefined;

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

    const logoBuffer = await generateTokenLogo(identity.imagePrompt, identity.name);
    const assets = await uploadTokenAssets(logoBuffer, identity);
    if (!assets) {
      cycleOutcome.assetsUploaded = false;
      logDeploy({
        chain: "all",
        tokenName: identity.name,
        ticker: identity.ticker,
        status: "failed",
        errorMsg: "IPFS upload gagal",
        lifecycleState: "FAILED",
        candidateId,
        viralScore: identity.viralScore,
        saturationCount,
        signalSources: trendData.sources,
        signalScrapedAt: trendData.scrapedAt,
      });
      logger.error("❌ Upload IPFS gagal. Siklus dibatalkan.");
      return;
    }
    cycleOutcome.assetsUploaded = true;

    // ─── SAFETY VERIFICATION: Scanner & Anti-Rug Criteria ──────
    const safetyReport = verifyDeploymentSafetyParameters(identity, assets);
    logger.info(`🛡️  [SAFETY CHECK] Safety Score: ${safetyReport.score}/100 (Safe: ${safetyReport.safe})`);
    if (!safetyReport.safe) {
      logger.warn(`⚠️  [SAFETY CHECK] Candidate rejected: ${safetyReport.issues.join("; ")}. Siklus dibatalkan.`);
      return;
    }

    // ─── LIFECYCLE 5 & 6: DEPLOY_SUBMITTED & EVALUATION ───────
    for (const chain of readinessDecision.executableChains) {
      cycleOutcome.deploymentsAttempted = (cycleOutcome.deploymentsAttempted ?? 0) + 1;
      logger.info(`🚀 Memproses deployment untuk chain '${chain.toUpperCase()}'...`);

      // V2.4.3: Chain-specific observed saturation count if available, fallback to global count
      const chainSaturationCount = saturationResult?.byChain[chain]?.observedCount ?? saturationCount;

      // Catat awal pengajuan deployment di database
      const deployLogId = logDeploy({
        chain,
        tokenName: identity.name,
        ticker: identity.ticker,
        ipfsUrl: assets.metadataUrl,
        status: "pending",
        lifecycleState: "DEPLOY_SUBMITTED",
        walletId: operatorWallet.id,
        proxyId: bankrContext.proxy?.id,
        // V2.4.1: Candidate identity across multi-chain deployments in this cycle
        candidateId,
        // V2.4.0/V2.4.3: Intelligence signal lineage
        viralScore: identity.viralScore,
        saturationCount: chainSaturationCount,
        signalSources: trendData.sources,
        signalScrapedAt: trendData.scrapedAt,
      });

      let result;
      let resolvedApiKey: string | undefined;

      try {
        if (chain === "base" || chain === "robinhood" || chain === "arbitrum") {
          if (bankrContext.credentialRef) {
            resolvedApiKey = resolveCredential(bankrContext.credentialRef);
            if (!resolvedApiKey) {
              logger.warn(
                `⚠️  [DEPLOY] Route untuk wallet '${operatorWallet.id}' memiliki credentialRef '${bankrContext.credentialRef}' namun tidak dapat di-resolve dari environment. Deployment dilewati.`
              );
              updateDeployLifecycle(deployLogId, "FAILED", {
                status: "failed",
                errorMsg: `Failed to resolve credential from ref '${bankrContext.credentialRef}' for wallet '${operatorWallet.id}'. Strict account isolation prevents fallback to global key.`,
              });
              continue;
            }
          } else {
            // Backward compatibility: default/unrouted wallet without route credentialRef uses global key
            resolvedApiKey = cfg.BANKR_API_KEY;
          }

          const feeRecipientAddress = cfg.TREASURY_EVM_DESTINATION || operatorWallet.evmAddress || undefined;

          // V2.9.2: Pre-broadcast deterministic CA & Pool ID calculation (0 gas cost)
          const pred = await predictDeploymentAddress(identity, assets, {
            chain: chain as "base" | "robinhood" | "arbitrum",
            apiKey: resolvedApiKey,
            proxyUrl: bankrContext.proxyUrl ?? undefined,
          });
          if (pred.predictedContractAddress) {
            logger.info(
              `🔮 [PREDICTIVE CA] Prediksi CA: ${pred.predictedContractAddress} | Pool: ${pred.predictedPoolId ?? "N/A"} (Pre-broadcast verified)`
            );
          }

          const gateExecution = await executeWithDeploymentSafetyGate(
            {
              chain,
              identity,
              assets,
              walletAddress: operatorWallet.evmAddress || undefined,
              isSimulation: cfg.DEPLOY_MODE === "testnet",
            },
            async () => {
              return await deployViaBankr(identity, assets, {
                proxyUrl: bankrContext.proxyUrl ?? undefined,
                chain: chain as "base" | "robinhood" | "arbitrum",
                apiKey: resolvedApiKey,
                quoteOnlyFees: cfg.BANKR_QUOTE_ONLY_FEES,
                feeRecipient: feeRecipientAddress ? { type: "wallet", value: feeRecipientAddress } : undefined,
              });
            }
          );

          if (!gateExecution.success || !gateExecution.result) {
            const gateErr = gateExecution.error || "SAFETY_GATE_REJECTED";
            logger.error(`❌ [SAFETY GATE] Deployment ke ${chain} diblokir oleh Safety Gate: ${gateErr}`);
            result = {
              success: false,
              status: "failed" as const,
              error: `Safety gate rejection: ${gateErr}`,
            };
          } else {
            result = gateExecution.result;
          }
        } else if (chain === "bsc" || chain === "ethereum") {
          logger.warn(`⚠️  Chain '${chain}' is not supported by Bankr API (only base, robinhood, arbitrum). Deployment dilewati.`);
          updateDeployLifecycle(deployLogId, "FAILED", {
            status: "failed",
            errorMsg: `Chain '${chain}' is not supported by Bankr Token Launch API`,
          });
          continue;
        } else if (chain === "solana") {
          const gateExecution = await executeWithDeploymentSafetyGate(
            {
              chain: "solana",
              identity,
              assets,
              walletAddress: operatorWallet.solanaAddress || undefined,
              isSimulation: cfg.DEPLOY_MODE === "testnet",
            },
            async () => {
              return await deployViaPumpFun(identity, assets);
            }
          );

          if (!gateExecution.success || !gateExecution.result) {
            const gateErr = gateExecution.error || "SAFETY_GATE_REJECTED";
            logger.error(`❌ [SAFETY GATE] Deployment Solana diblokir oleh Safety Gate: ${gateErr}`);
            result = {
              success: false,
              status: "failed" as const,
              error: `Safety gate rejection: ${gateErr}`,
            };
          } else {
            result = gateExecution.result;
          }
        } else {
          logger.warn(`⚠️  Chain tidak didukung: ${chain}. Dilewati.`);
          updateDeployLifecycle(deployLogId, "FAILED", {
            status: "failed",
            errorMsg: `Unsupported chain: ${chain}`,
          });
          continue;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ [DEPLOY] Exception saat deploy ke ${chain}: ${errorMsg}`);
        updateDeployLifecycle(deployLogId, "FAILED", {
          status: "failed",
          errorMsg,
        });
        continue;
      }

      // ─── CRITICAL GUARD: Verifikasi Hasil Deployment ─────────
      const confirmation = confirmDeployment(result, chain);

      // Skenario 1: SIMULATION
      if (confirmation.isSimulation) {
        updateDeployLifecycle(deployLogId, "SIMULATED", {
          status: "unknown", // tidak boleh status 'success' on-chain
          contractAddr: result?.contractAddress,
          poolId: result?.poolId,
          simulated: true,
        });
        logger.info(
          `🧪 [SIMULATION GUARD] Deployment $${identity.ticker} pada ${chain.toUpperCase()} adalah simulasi. ` +
            `DOWNSTREAM BUY DIBATALKAN. Tidak ada posisi trading nyata dibuka.`
        );
        continue;
      }

      // Skenario 2: UNKNOWN / AMBIGUOUS OUTCOME
      if (confirmation.isUnknown) {
        updateDeployLifecycle(deployLogId, "UNRESOLVED_UNKNOWN", {
          status: "unknown",
          errorMsg: confirmation.reason,
          contractAddr: result?.contractAddress,
          poolId: result?.poolId,
        });
        logger.error(
          `⚠️  [UNKNOWN GUARD] Deployment $${identity.ticker} pada ${chain.toUpperCase()} berstatus AMBIGU/UNKNOWN. ` +
            `DOWNSTREAM BUY DIBATALKAN. AUTO-RETRY DILARANG untuk mencegah duplikasi.`
        );
        continue;
      }

      // Skenario 3: FAILED
      if (!confirmation.confirmed || !result?.success) {
        updateDeployLifecycle(deployLogId, "FAILED", {
          status: "failed",
          errorMsg: confirmation.reason || result?.error || "Deployment failed",
          contractAddr: result?.contractAddress,
        });
        logger.error(`❌ [DEPLOY GUARD] Deployment gagal: ${confirmation.reason}`);
        continue;
      }

      // Skenario 4: CONFIRMED DEPLOYMENT
      const contractAddress = result.contractAddress!;
      const txHash = result.txHash!;
      const walletAddress =
        (chain === "solana" ? operatorWallet.solanaAddress : operatorWallet.evmAddress) ||
        getWalletAddressForChain(chain);
      cycleOutcome.deploymentsConfirmed = (cycleOutcome.deploymentsConfirmed ?? 0) + 1;

      updateDeployLifecycle(deployLogId, "DEPLOY_CONFIRMED", {
        status: "success",
        contractAddr: contractAddress,
        txHash,
        poolId: result.poolId,
      });

      incrementTodayDeployCount();
      logger.deploy(
        `\n🎉 TOKEN CONFIRMED LIVE!\n` +
          `   Nama    : ${identity.name} ($${identity.ticker})\n` +
          `   Chain   : ${chain.toUpperCase()}\n` +
          `   Contract: ${contractAddress}\n` +
          `   TX      : ${txHash}\n` +
          `   Explorer: ${result.explorerUrl ?? "N/A"}\n` +
          `   IPFS    : ${assets.metadataUrl}`
      );

      // ─── TEMPLAT BROADCAST KOMUNITAS (SIAP COPY-PASTE) ───────
      logger.info(
        `\n📋 ─── TEMPLAT BROADCAST KOMUNITAS (SIAP COPY-PASTE) ───\n` +
          `🚀 NEW LAUNCH ALPHA: $${identity.ticker} (${identity.name})\n` +
          `⛓️ Chain: ${chain.toUpperCase()}\n` +
          `📍 CA: ${contractAddress}\n` +
          `🛡️ Security: 0% Tax | Audited Proxy | Unruggable LP\n` +
          `🔗 DexScreener: https://dexscreener.com/${chain}/${contractAddress}\n` +
          `───────────────────────────────────────────────────────\n`
      );

      // ─── AUTONOMOUS ZERO-PROMPT BOT POOL & BANKR ENRICHMENT ───
      let assignedBotUsername: string | undefined;
      try {
        // 1. Sinkronkan token bot dari .env jika tersedia
        syncBotPoolFromEnv();

        // 2. Klaim 1 bot dari pre-provisioned pool secara atomik
        const poolBot = acquireBotFromPool(contractAddress, preallocatedBotId);
        let botTokenForChar: string | undefined;

        if (poolBot) {
          botTokenForChar = poolBot.botToken;
          assignedBotUsername = poolBot.botUsername || undefined;
          logger.success(`✨ [AUTOPILOT BOT POOL] Bot dialokasikan dari pool untuk $${identity.ticker}!`);

          // Verifikasi dan update username via getMe jika belum tersimpan
          try {
            const tgRes = await fetch(`https://api.telegram.org/bot${poolBot.botToken}/getMe`);
            const tgData = (await tgRes.json()) as any;
            if (tgData.ok && tgData.result?.username) {
              assignedBotUsername = tgData.result.username;
              logger.success(`   ✅ Terhubung ke Telegram Bot: @${assignedBotUsername}`);
            }
          } catch (tgErr: any) {
            logger.warn(`   ⚠️  Koneksi verifikasi Telegram API: ${tgErr?.message || tgErr}`);
          }

          updateDeploymentTelegramBot(contractAddress, poolBot.botToken, assignedBotUsername);
        } else if (process.env.TELEGRAM_BOT_USERNAME) {
          // Fallback graceful ke Master Fleet Bot jika pool kosong tanpa menghentikan proses
          assignedBotUsername = process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
          logger.info(`ℹ️  [AUTOPILOT BOT POOL] Pool kosong, menggunakan fallback Master Fleet Bot: @${assignedBotUsername}`);
        }

        // 3. Generate character profile config di characters/<ticker>_agent.json
        generateTokenCharacterConfig(
          {
            address: contractAddress,
            ticker: identity.ticker,
            name: identity.name,
          },
          { botToken: botTokenForChar, botUsername: assignedBotUsername }
        );

        // 4. Enrich & sync Bankr Agent Project (Base & Robinhood)
        if (chain === "base" || chain === "robinhood") {
          const telegramUrl = assignedBotUsername ? `https://t.me/${assignedBotUsername}` : identity.telegram;
          await enrichAndSyncBankrProject(
            {
              name: identity.name,
              ticker: identity.ticker,
              contractAddress: contractAddress,
              telegramUrl: telegramUrl || undefined,
              twitterUrl: identity.twitter || undefined,
              website: identity.website || undefined,
              description: identity.description || undefined,
            },
            {
              apiKey: resolvedApiKey,
              proxyUrl: bankrContext.proxyUrl ?? undefined,
            }
          );
        }

        // 5. Broadcast official launch announcement ke Telegram channel komunitas
        try {
          await broadcastTokenLaunchAnnouncement({
            ticker: identity.ticker,
            name: identity.name,
            contractAddress: contractAddress,
            chain: chain,
            botUsername: assignedBotUsername,
            botToken: botTokenForChar,
          });
        } catch (bcErr: any) {
          logger.warn(`⚠️  [AUTOPILOT] Launch broadcast notice: ${bcErr?.message || bcErr}`);
        }
      } catch (enrichErr: any) {
        logger.warn(`⚠️  [AUTOPILOT] Warning auto-enrich Bankr / Bot: ${enrichErr?.message || enrichErr}`);
      }

      // ─── AUTONOMOUS WEB3 WEBSITE, CLOUDFLARE PAGES & SSOT SYNC ──
      let liveWeb3Url: string | undefined;
      try {
        const { generateTokenWebsite } = await import("./modules/growth/website-generator.ts");
        const { deployWebsiteToCloudflarePages } = await import("./modules/growth/website-deployer.ts");
        const { updateDeployLogWebsite } = await import("./db/vault.ts");

        logger.info(`🌐 [AUTOPILOT WEB3] Membangun Website Web3 untuk $${identity.ticker}...`);
        const siteRes = await generateTokenWebsite({
          name: identity.name,
          ticker: identity.ticker,
          contractAddress: contractAddress,
          chainId: chain === "solana" ? 101 : chain === "base" ? 8453 : 4663,
          chainName: chain,
          description: identity.description,
          logoUrl: assets.imageUrl,
          poolId: result.poolId && result.poolId !== "N/A" ? result.poolId : undefined,
          websiteUrl: identity.website,
          twitterUrl: identity.twitter,
          telegramUrl: assignedBotUsername ? `https://t.me/${assignedBotUsername}` : identity.telegram,
        });

        const cfRes = await deployWebsiteToCloudflarePages({
          siteDir: siteRes.siteDirectory,
          ticker: identity.ticker,
          contractAddress: contractAddress,
          chain,
        });
        liveWeb3Url = cfRes.deploymentUrl;
        updateDeployLogWebsite(contractAddress, liveWeb3Url);
        logger.success(`🚀 [AUTOPILOT CLOUDFLARE] Live DApp: ${liveWeb3Url}`);

        // Profiler fast-track files
        try {
          const { saveDexScreenerProfileJson, buildDexScreenerProfilePayload } = await import("./modules/growth/dexscreener-profiler.ts");
          const { saveGeckoTerminalProfileJson, buildGeckoTerminalProfilePayload } = await import("./modules/growth/geckoterminal-profiler.ts");

          saveDexScreenerProfileJson(siteRes.siteDirectory, buildDexScreenerProfilePayload({
            chainId: chain === "base" ? 8453 : 4663,
            tokenAddress: contractAddress,
            tokenName: identity.name,
            tokenSymbol: identity.ticker,
            description: identity.description,
            iconUrl: assets.imageUrl,
            websiteUrl: liveWeb3Url,
            twitterUrl: identity.twitter,
            telegramUrl: assignedBotUsername ? `https://t.me/${assignedBotUsername}` : identity.telegram,
          }));

          saveGeckoTerminalProfileJson(siteRes.siteDirectory, buildGeckoTerminalProfilePayload({
            chainId: chain === "base" ? 8453 : 4663,
            tokenAddress: contractAddress,
            tokenName: identity.name,
            tokenSymbol: identity.ticker,
            poolAddress: result.poolId && result.poolId !== "N/A" ? result.poolId : undefined,
            description: identity.description,
            iconUrl: assets.imageUrl,
            websiteUrl: liveWeb3Url,
            twitterUrl: identity.twitter,
            telegramUrl: assignedBotUsername ? `https://t.me/${assignedBotUsername}` : identity.telegram,
          }));
        } catch (profErr: any) {
          logger.warn(`⚠️  [AUTOPILOT PROFILER] Notice: ${profErr?.message || profErr}`);
        }

        // Neon PostgreSQL SSOT Cloud Sync
        try {
          const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("./db/neon-vault.ts");
          if (isNeonConfigured()) {
            await syncTokenDeploymentToNeon({
              contractAddr: contractAddress,
              ticker: identity.ticker,
              tokenName: identity.name,
              chain: chain,
              poolId: result.poolId && result.poolId !== "N/A" ? result.poolId : undefined,
              txHash,
              websiteUrl: liveWeb3Url,
              telegramBotUsername: assignedBotUsername,
              creatorWallet: walletAddress,
              description: identity.description,
            });
            logger.success(`🐘 [AUTOPILOT NEON SSOT] $${identity.ticker} tersinkronisasi ke Neon Cloud SSOT!`);
          }
        } catch (neonErr: any) {
          logger.warn(`⚠️  [AUTOPILOT NEON SSOT] Notice: ${neonErr?.message || neonErr}`);
        }
      } catch (siteErr: any) {
        logger.warn(`⚠️  [AUTOPILOT WEB3] Warning generate website: ${siteErr?.message || siteErr}`);
      }

      // ─── LIFECYCLE 7: CONTROLLED BUY & POSITION OPENING ──────
      // 1. Guard duplikasi posisi
      if (hasActiveOrPendingPosition(contractAddress)) {
        logger.warn(`⚠️  [POSITION GUARD] Posisi untuk ${contractAddress} sudah ada. Skip duplicate buy.`);
        continue;
      }

      // 2. Anti-Snipe Delay (Wajib delay terkontrol sebelum buy)
      const antiSnipeDelay = cfg.ANTI_SNIPE_DELAY_MS ?? 12000;
      logger.info(`⏳ [ANTI-SNIPE] Menunggu ${antiSnipeDelay / 1000}s sebelum mengeksekusi buy order...`);
      await new Promise((r) => setTimeout(r, antiSnipeDelay));

      // 3. Catat saldo baseline on-chain sebelum order buy dikirim
      let baselineBalance = "0";
      let tokenDecimals = 18;

      if (walletAddress) {
        const initialBal = await fetchOnchainTokenBalance(chain, contractAddress, walletAddress);
        if (initialBal) {
          baselineBalance = initialBal.rawBalance;
          tokenDecimals = initialBal.decimals;
        }
      }

      // 4. Buka pending position secara atomik di database dengan baseline balance
      const rawSnipe = chain === "solana" ? cfg.SNIPE_AMOUNT_SOL : cfg.SNIPE_AMOUNT_ETH;
      const safeCapEth = cfg.SNIPE_SAFE_CAP_ETH ?? 0.02;
      const snipeAmount = chain !== "solana" && rawSnipe > safeCapEth ? safeCapEth : rawSnipe;

      // V2.9.2: Zero-Capital Guard (Modal Rp 0)
      if (!cfg.SNIPER_ENABLED || snipeAmount <= 0) {
        logger.info(
          `ℹ️  [ZERO-CAPITAL MODE] Sniper dinonaktifkan (SNIPER_ENABLED=false atau snipeAmount=0). Order buy dilewati (Rp 0 modal).`
        );
        logger.info(
          `📢 [COMMUNITY EARLY ACCESS] Bagikan CA ke komunitas Anda: ${contractAddress}`
        );
        await shillOnTwitter(identity, contractAddress, chain).catch((err) =>
          logger.warn(`[TWITTER] Error: ${String(err)}`)
        );
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const positionCreated = createPendingPosition({
        deployLogId,
        chain,
        contractAddr: contractAddress,
        ticker: identity.ticker,
        snipeAmount,
        takeProfitX: cfg.TAKE_PROFIT_MULTIPLIER,
        stopLossPct: cfg.STOP_LOSS_PERCENT,
        walletAddress: walletAddress ?? undefined,
        balanceBefore: baselineBalance,
        deploymentTxHash: txHash,
        tokenDecimals,
        walletId: operatorWallet.id,
        proxyId: basedbotContext.proxy?.id,
      });

      if (!positionCreated) {
        logger.error(`❌ [POSITION GUARD] Gagal membuat pending position di database. Skip buy.`);
        updateDeployLifecycle(deployLogId, "POSITION_ABORTED", {
          exitStatus: "buy_failed",
          errorMsg: "Failed to create pending position in database",
        });
        continue;
      }

      // 5. Kirim order buy ke BasedBot (Multi-Account atau Single)
      let buyDispatched = false;
      if (cfg.SNIPE_WALLET_COUNT > 1 && chain !== "solana") {
        const multiResult = await snipeMultiAccountToken(contractAddress, chain, identity.ticker, {
          totalAmount: snipeAmount,
          walletCount: cfg.SNIPE_WALLET_COUNT,
        });
        buyDispatched = multiResult.success;
      } else {
        buyDispatched = await snipeNewToken(contractAddress, chain, identity.ticker);
      }

      if (buyDispatched) {
        logger.success(`✅ [POSITION] Buy order berhasil dikirim. State -> BUY_SUBMITTED.`);
      } else {
        logger.warn(`⚠️  [POSITION] Buy order gagal dikirim. State -> BUY_FAILED.`);
        transitionPositionState(contractAddress, "buy_submitted", "buy_failed", {
          exitReason: "buy_dispatch_failed",
        });
        updateDeployLifecycle(deployLogId, "POSITION_ABORTED", {
          exitStatus: "buy_failed",
          errorMsg: "Downstream buy dispatch failed",
        });
      }

      // ─── Broadcast Resmi (Twitter) ───────────────────────────
      await shillOnTwitter(identity, contractAddress, chain).catch((err) =>
        logger.warn(`[TWITTER] Error: ${String(err)}`)
      );

      // Jeda antar-chain
      await new Promise((r) => setTimeout(r, 3000));
    }

    // ─── Sweep Sisa SOL dari Dompet Bekas ────────────────────
    if (activeChains.includes("solana")) {
      await sweepLeftoverSol();
    }

    logger.info("═══════════════ SIKLUS SELESAI ═════════════════════\n");
    } finally {
      // ─── Concurrency Guard: Selalu Lepas Lock ────────────────
      if (cycleOutcome.lockAcquired) {
        releaseLock("deploy_pipeline");
      }
    }
  } finally {
    // ─── V2.5.0: Finalisasi Cycle Telemetry ──────────────────
    if (cycleId !== undefined) {
      try {
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - cycleStartTime;
        updateCycleOutcome(cycleId, {
          ...cycleOutcome,
          completedAt,
          durationMs,
        });
      } catch (telemetryErr) {
        logger.warn(`⚠️  [TELEMETRY] Gagal update cycle outcome: ${String(telemetryErr)}`);
      }
    }
  }
}

/**
 * Entry point — Jalankan bot dengan safe scheduler & shutdown hooks.
 */
async function main(): Promise<void> {
  console.log(ASCII_BANNER);

  const cliArgs = process.argv.slice(2);
  const isDryRunArg = cliArgs.includes("--dry-run") || cliArgs.includes("--simulate") || cliArgs.includes("-d");
  const isOnce = cliArgs.includes("--once") || cliArgs.includes("-1");

  if (isDryRunArg) {
    process.env.DRY_RUN = "true";
    process.env.DEPLOY_MODE = "testnet";
    process.env.BANKR_SIMULATE_ONLY = "true";
    const { resetConfig } = await import("./config.ts");
    resetConfig();
  }

  const cfg = getConfig();

  logger.info(`🌐 Mode        : ${cfg.DEPLOY_MODE.toUpperCase()}`);
  logger.info(`⛓️  Chain Aktif : ${getActiveChains().join(", ").toUpperCase()}`);
  logger.info(`⏱️  Interval    : Setiap ${cfg.TREND_SCAN_INTERVAL_MINUTES} menit`);
  logger.info(`📊 Skor Min    : ${cfg.MIN_VIRAL_SCORE}/100`);
  logger.info(`🔒 Max Deploy  : ${cfg.MAX_DEPLOYS_PER_DAY}/hari`);
  logger.info(`💰 Take Profit : ${cfg.TAKE_PROFIT_MULTIPLIER}x | Stop Loss: -${cfg.STOP_LOSS_PERCENT * 100}%`);
  logger.info(`⏳ Anti-Snipe  : Delay ${((cfg.ANTI_SNIPE_DELAY_MS ?? 12000) / 1000).toFixed(1)} detik\n`);

  // Jalankan siklus pertama saat booting
  logger.info("▶️  Menjalankan siklus pertama...");
  await runDeployPipeline();

  if (isOnce) {
    logger.success("🏁 [RUN-ONCE] Siklus tunggal autopilot selesai (--once). Keluar secara bersih.");
    process.exit(0);
  }

  // Cron 1: Deploy pipeline (setiap N menit)
  const intervalMin = cfg.TREND_SCAN_INTERVAL_MINUTES;
  cron.schedule(`*/${intervalMin} * * * *`, async () => {
    await runDeployPipeline();
  });

  // Cron 2: Price monitor & verified exit (setiap 5 menit dengan concurrency lock)
  cron.schedule("*/5 * * * *", async () => {
    if (!acquireLock("price_monitor", 300)) {
      logger.warn("⚠️  [LOCK] Price monitor sedang berjalan. Melewati iterasi ini.");
      return;
    }
    try {
      await checkAndExecuteExits();
    } catch (err) {
      logger.error(`[MONITOR] Unexpected error: ${String(err)}`);
    } finally {
      releaseLock("price_monitor");
    }
  });

  // Cron 3: On-chain reconciliation (setiap 2 menit dengan concurrency lock)
  cron.schedule("*/2 * * * *", async () => {
    await runOnchainReconciliation().catch((err) => {
      logger.error(`[RECONCILER] Unexpected error: ${String(err)}`);
    });
    // V2.3: Check and emit owner alerts after each reconciliation cycle (log-only)
    try {
      checkAndEmitAlerts();
    } catch (err) {
      logger.warn(`[OWNER-ALERTS] Alert check failed: ${String(err)}`);
    }

    // V3.0: Creator Fee Scanning & Auto-Claiming
    if (cfg.TREASURY_AUTO_CLAIM_ENABLED) {
      if (!acquireLock("treasury_auto_claim", 120)) {
        logger.warn("⚠️  [LOCK] Treasury auto-claim sedang berjalan. Melewati iterasi ini.");
      } else {
        try {
          const { scanCreatorFees } = await import("./modules/treasury/fee-scanner.ts");
          const { claimAllAvailableFees, reconcileInFlightFeeClaims } = await import("./modules/treasury/fee-claimer.ts");
          // 1. Reconcile any in-flight or unposted claims first
          await reconcileInFlightFeeClaims();
          // 2. Scan latest creator fee state
          await scanCreatorFees();
          // 3. Claim any eligible fees
          await claimAllAvailableFees(undefined, { executeOnchain: true });

          // 4. Positive-Sum Flywheel Revenue Recycler (Auto Buyback, Burn, Dividends, Jackpot)
          if (cfg.FLYWHEEL_ENABLED) {
            try {
              const { executeFlywheelCycle } = await import("./modules/growth/flywheel-engine.ts");
              const { getAllDeployLogs } = await import("./db/vault.ts");
              const activeBaseDeployments = getAllDeployLogs().filter(
                (d) => d.chain === "base" && !d.simulated && Boolean(d.contractAddr && d.contractAddr.startsWith("0x"))
              );
              for (const dep of activeBaseDeployments) {
                const fwRes = await executeFlywheelCycle({
                  tokenAddress: dep.contractAddr!,
                  tokenSymbol: dep.ticker || "TOKEN",
                  walletId: dep.walletId ?? undefined,
                });
                if (fwRes.success) {
                  logger.success(`🌪️  [AUTOPILOT FLYWHEEL] Executed positive-sum recycling for $${dep.ticker}!`);
                }
              }
            } catch (fwErr) {
              logger.warn(`⚠️  [AUTOPILOT FLYWHEEL] Notice: ${String(fwErr)}`);
            }
          }
        } catch (feeErr) {
          logger.warn(`⚠️  [TREASURY AUTO-CLAIM] Periodic fee sync failed: ${String(feeErr)}`);
        } finally {
          releaseLock("treasury_auto_claim");
        }
      }
    }
  });

  // Cron 4: DexScreener Profile & Boost Watchdog (setiap 10 menit dengan concurrency lock)
  cron.schedule("*/10 * * * *", async () => {
    if (!acquireLock("dexscreener_watchdog", 180)) {
      logger.warn("⚠️  [LOCK] DexScreener watchdog sedang berjalan. Melewati iterasi ini.");
      return;
    }
    try {
      const { runDexScreenerWatchdog } = await import("./modules/intelligence/dexscreener-monitor.ts");
      await runDexScreenerWatchdog();
    } catch (err: any) {
      logger.warn(`⚠️  [DEXSCREENER WATCHDOG] Periodic watchdog notice: ${err?.message || err}`);
    } finally {
      releaseLock("dexscreener_watchdog");
    }
  });

  logger.success(
    `✅ Bot v2.1 Hardened berjalan!\n` +
      `   Deploy: setiap ${intervalMin} menit (concurrency locked)\n` +
      `   Monitor: setiap 5 menit (concurrency locked)\n` +
      `   Reconciliation: setiap 2 menit (concurrency locked)\n` +
      `   DexScreener Watchdog: setiap 10 menit (concurrency locked)\n` +
      `   Tekan Ctrl+C untuk menghentikan.\n`
  );
}

process.on("uncaughtException", (err) => {
  logger.error("💥 UNCAUGHT EXCEPTION:", err.message);
  releaseLock("deploy_pipeline");
  releaseLock("price_monitor");
  releaseLock("onchain_reconciler");
  releaseLock("treasury_auto_claim");
  releaseLock("dexscreener_watchdog");
});
process.on("unhandledRejection", (reason) => {
  logger.error("💥 UNHANDLED REJECTION:", String(reason));
});

// Jalankan hanya jika dieksekusi langsung (bukan saat di-import oleh unit test)
if (import.meta.main) {
  main();
}
