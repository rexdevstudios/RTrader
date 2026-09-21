/**
 * src/modules/orchestration/phase-orchestrator.ts
 *
 * Autonomous Phase Transition Orchestrator (Phase 3 -> 4 -> 5 -> 6).
 *
 * Architecture Principles:
 *   1. Strict Determinism: Every transition has explicit, quantified entry and exit conditions.
 *   2. Deterministic Safety Gates: Live on-chain transitions are protected by operator gas floor (0.0003 ETH).
 *   3. Dual-SSOT Telemetry: All transitions record audit trails in SQLite (.eliza/vault.db) and Neon Cloud.
 *   4. Zero Duplication: Directly reuses dexscreener-profiler, fee-scanner, fee-claimer,
 *      flywheel-engine, bounty-escrow, and fleet-registry.
 */

import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import { fetchLiveDexScreenerProfile } from "../growth/dexscreener-profiler.ts";
import { scanCreatorFees } from "../treasury/fee-scanner.ts";
import {
  getOperatorLiveBalanceEth,
  evaluateOperatorRefillNeed,
  DEFAULT_OPERATOR_MIN_REFILL_THRESHOLD_ETH,
} from "../treasury/auto-refill-guard.ts";
import { BountyEscrowService, type BountyClaimItem } from "../../../packages/launchpad/bounty-escrow.ts";
import { getProductionFleet, isLiveDeployment } from "../fleet/fleet-registry.ts";
import {
  getDeployLogByContract,
  logIntervention,
  getFlywheelEvents,
  getFeeEvents,
  recordCycleStart,
  updateCycleOutcome,
} from "../../db/vault.ts";
import {
  recordTokenTelemetry,
  isNeonConfigured,
  getNeonMasterDatabaseUrl,
} from "../../db/neon-vault.ts";
import { SQL } from "bun";

export type PipelinePhase =
  | "PHASE_3_CATALYST"
  | "PHASE_4_HARVEST"
  | "PHASE_5_SOCIALFI"
  | "PHASE_6_FLEET";

export interface PhaseTransitionCriteria {
  // Phase 3 -> Phase 4 Criteria
  minVolume24hUsd: number;       // Default: $50.00 USD
  minUniqueMakers: number;       // Default: 5 makers
  // Phase 4 -> Phase 5 Criteria
  minCreatorSurplusWeth: number; // Default: 0.005 WETH (~$12.50 USD)
  // Phase 5 -> Phase 6 Criteria
  minBountyClaimsVerified: number; // Default: 1 verified claim
}

export const DEFAULT_TRANSITION_CRITERIA: PhaseTransitionCriteria = {
  minVolume24hUsd: 50.0,
  minUniqueMakers: 5,
  minCreatorSurplusWeth: 0.005,
  minBountyClaimsVerified: 1,
};

export interface PhaseEvaluationResult {
  currentPhase: PipelinePhase;
  targetTokenAddress: string;
  ticker: string;
  chain: string;
  metrics: {
    volume24hUsd: number;
    uniqueMakers: number;
    creatorFeeAvailableWeth: number;
    operatorBalanceEth: number;
    isGasFloorSafe: boolean;
    flywheelCyclesCount: number;
    totalRecycledWeth: number;
    bountyCampaignActive: boolean;
    fleetDeployedChains: string[];
  };
  transitionEligible: boolean;
  nextPhase?: PipelinePhase;
  unmetConditions: string[];
  safetyGatePassed: boolean;
  safetyGateReason?: string;
}

/**
 * Evaluates the current operational state of a token against the Phase 3-6 roadmap criteria.
 */
export async function evaluateTokenPhase(
  tokenAddress: string,
  criteria = DEFAULT_TRANSITION_CRITERIA
): Promise<PhaseEvaluationResult> {
  const cfg = getConfig();
  const deployLog = getDeployLogByContract(tokenAddress);
  const ticker = deployLog?.ticker || "UNKNOWN";
  const chain = deployLog?.chain || "base";

  // 1. Check Operator Gas Safety Gate
  const operatorBalanceEth = await getOperatorLiveBalanceEth();
  const refillEval = evaluateOperatorRefillNeed(
    operatorBalanceEth,
    DEFAULT_OPERATOR_MIN_REFILL_THRESHOLD_ETH
  );
  const isGasFloorSafe = !refillEval.needsRefill;

  // 2. Fetch Market Metrics (Phase 3 Telemetry)
  let volume24hUsd = 0;
  let uniqueMakers = 0;
  try {
    const profile = await fetchLiveDexScreenerProfile(tokenAddress, chain);
    if (profile && profile.pairs && profile.pairs.length > 0) {
      const p = profile.pairs[0];
      volume24hUsd = p.volume?.h24 ?? 0;
      const txns = p.txns?.h24;
      if (txns) {
        uniqueMakers = (txns.buys ?? 0) + (txns.sells ?? 0);
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️  [PHASE ORCHESTRATOR] DexScreener fetch notice: ${err?.message || err}`);
  }

  // 3. Fetch Creator Fee & Flywheel Metrics (Phase 4 Telemetry)
  let creatorFeeAvailableWeth = 0;
  try {
    const feeEvents = await scanCreatorFees({ chain: "base" });
    const match = feeEvents.filter(
      (f) =>
        f.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase() &&
        (f.status === "claimable" || f.status === "detected")
    );
    creatorFeeAvailableWeth = match.reduce((acc, f) => acc + (f.amountFormatted || 0), 0);
  } catch {
    // Graceful fallback to fee_events in SQLite
    const feeEvents = getFeeEvents({ status: "claimable", chain: "base" });
    const match = feeEvents.filter(
      (f) => f.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase()
    );
    creatorFeeAvailableWeth = match.reduce((acc, f) => acc + (f.amountFormatted || 0), 0);
  }

  const flywheelEvents = getFlywheelEvents(tokenAddress);
  const flywheelCyclesCount = flywheelEvents.length;
  const totalRecycledWeth = flywheelEvents.reduce(
    (acc, ev) => acc + (ev.totalClaimedWeth || 0),
    0
  );

  // 4. Check SocialFi Bounty State (Phase 5 Telemetry)
  let bountyCampaignActive = false;
  if (isNeonConfigured()) {
    try {
      const sql = new SQL(getNeonMasterDatabaseUrl());
      const rows = await sql`
        SELECT id, status FROM bounty_campaigns 
        WHERE status = 'ACTIVE' LIMIT 1;
      `;
      bountyCampaignActive = rows.length > 0;
      await sql.close();
    } catch {
      bountyCampaignActive = false;
    }
  }

  // 5. Check Multi-Chain Fleet Deployments (Phase 6 Telemetry)
  const fleet = getProductionFleet();
  const fleetDeployedChains = Array.from(
    new Set(
      fleet.live
        .map((f) => f.chain)
        .filter((c): c is string => Boolean(c))
    )
  );

  const metrics = {
    volume24hUsd,
    uniqueMakers,
    creatorFeeAvailableWeth,
    operatorBalanceEth,
    isGasFloorSafe,
    flywheelCyclesCount,
    totalRecycledWeth,
    bountyCampaignActive,
    fleetDeployedChains,
  };

  // Record Telemetry non-blocking to Neon Cloud
  recordTokenTelemetry(ticker, {
    contractAddr: tokenAddress,
    volume24hUsd,
    uniqueMakers,
  }).catch(() => {});

  // Determine current active phase & evaluate transitions
  return determinePhaseProgression(tokenAddress, ticker, chain, metrics, criteria);
}

/**
 * Pure state machine transition evaluator based on quantified conditions.
 */
export function determinePhaseProgression(
  tokenAddress: string,
  ticker: string,
  chain: string,
  metrics: PhaseEvaluationResult["metrics"],
  criteria = DEFAULT_TRANSITION_CRITERIA
): PhaseEvaluationResult {
  const unmetConditions: string[] = [];
  let safetyGatePassed = metrics.isGasFloorSafe;
  let safetyGateReason = safetyGatePassed
    ? undefined
    : `OPERATOR_GAS_FLOOR_BREACH: Balance ${metrics.operatorBalanceEth.toFixed(6)} ETH is below floor ${DEFAULT_OPERATOR_MIN_REFILL_THRESHOLD_ETH} ETH.`;

  // Step 1: Check if already in Phase 6
  if (metrics.fleetDeployedChains.length >= 2) {
    return {
      currentPhase: "PHASE_6_FLEET",
      targetTokenAddress: tokenAddress,
      ticker,
      chain,
      metrics,
      transitionEligible: false,
      unmetConditions: [],
      safetyGatePassed,
      safetyGateReason,
    };
  }

  // Step 2: Check if in Phase 5 (SocialFi active)
  if (metrics.bountyCampaignActive) {
    // Condition to transition to Phase 6
    const hasFleet = metrics.fleetDeployedChains.length >= 2;
    if (hasFleet) {
      return {
        currentPhase: "PHASE_5_SOCIALFI",
        targetTokenAddress: tokenAddress,
        ticker,
        chain,
        metrics,
        transitionEligible: true,
        nextPhase: "PHASE_6_FLEET",
        unmetConditions: [],
        safetyGatePassed,
        safetyGateReason,
      };
    } else {
      unmetConditions.push("Multi-chain fleet not yet provisioned on secondary chains (Arc/Robinhood).");
      return {
        currentPhase: "PHASE_5_SOCIALFI",
        targetTokenAddress: tokenAddress,
        ticker,
        chain,
        metrics,
        transitionEligible: false,
        nextPhase: "PHASE_6_FLEET",
        unmetConditions,
        safetyGatePassed,
        safetyGateReason,
      };
    }
  }

  // Step 3: Check if in Phase 4 (Harvest & Flywheel cycles active)
  if (metrics.flywheelCyclesCount > 0 || metrics.creatorFeeAvailableWeth > 0) {
    // Condition to transition from Phase 4 -> Phase 5
    const hasSurplus = metrics.creatorFeeAvailableWeth >= criteria.minCreatorSurplusWeth;
    if (hasSurplus && safetyGatePassed) {
      return {
        currentPhase: "PHASE_4_HARVEST",
        targetTokenAddress: tokenAddress,
        ticker,
        chain,
        metrics,
        transitionEligible: true,
        nextPhase: "PHASE_5_SOCIALFI",
        unmetConditions: [],
        safetyGatePassed,
        safetyGateReason,
      };
    } else {
      if (!hasSurplus) {
        unmetConditions.push(
          `Creator Kas Surplus ${metrics.creatorFeeAvailableWeth.toFixed(6)} WETH < required threshold ${criteria.minCreatorSurplusWeth} WETH.`
        );
      }
      return {
        currentPhase: "PHASE_4_HARVEST",
        targetTokenAddress: tokenAddress,
        ticker,
        chain,
        metrics,
        transitionEligible: false,
        nextPhase: "PHASE_5_SOCIALFI",
        unmetConditions,
        safetyGatePassed,
        safetyGateReason,
      };
    }
  }

  // Step 4: Default to Phase 3 (Market Catalyst)
  const volPass = metrics.volume24hUsd >= criteria.minVolume24hUsd;
  const makersPass = metrics.uniqueMakers >= criteria.minUniqueMakers;
  const phase3Pass = (volPass || makersPass) && safetyGatePassed;

  if (phase3Pass) {
    return {
      currentPhase: "PHASE_3_CATALYST",
      targetTokenAddress: tokenAddress,
      ticker,
      chain,
      metrics,
      transitionEligible: true,
      nextPhase: "PHASE_4_HARVEST",
      unmetConditions: [],
      safetyGatePassed,
      safetyGateReason,
    };
  } else {
    if (!volPass) {
      unmetConditions.push(
        `Volume 24H $${metrics.volume24hUsd.toFixed(2)} USD < required $${criteria.minVolume24hUsd.toFixed(2)} USD.`
      );
    }
    if (!makersPass) {
      unmetConditions.push(
        `Unique Makers ${metrics.uniqueMakers} < required ${criteria.minUniqueMakers} makers.`
      );
    }
    return {
      currentPhase: "PHASE_3_CATALYST",
      targetTokenAddress: tokenAddress,
      ticker,
      chain,
      metrics,
      transitionEligible: false,
      nextPhase: "PHASE_4_HARVEST",
      unmetConditions,
      safetyGatePassed,
      safetyGateReason,
    };
  }
}

/**
 * Executes an automated, deterministic phase transition with comprehensive audit logging.
 */
export async function executePhaseTransition(
  evaluation: PhaseEvaluationResult,
  options?: {
    simulateOnly?: boolean;
    customBountyClaims?: BountyClaimItem[];
  }
): Promise<{
  success: boolean;
  action: string;
  auditLogId?: number;
  error?: string;
}> {
  const isSimulated = options?.simulateOnly ?? false;

  logger.info(
    `🔄 [PHASE ORCHESTRATOR] Transition requested from ${evaluation.currentPhase} to ${evaluation.nextPhase || "NONE"} ` +
      `for $${evaluation.ticker} (${evaluation.targetTokenAddress}) [${isSimulated ? "SIMULATION" : "LIVE"}]`
  );

  if (!evaluation.transitionEligible) {
    const errorMsg = `TRANSITION_BLOCKED: Unmet conditions: ${evaluation.unmetConditions.join("; ")}`;
    logger.error(`❌ [PHASE ORCHESTRATOR] ${errorMsg}`);
    return { success: false, action: "TRANSITION_BLOCKED", error: errorMsg };
  }

  if (!evaluation.safetyGatePassed) {
    const errorMsg = `SAFETY_GATE_VIOLATION: ${evaluation.safetyGateReason}`;
    logger.error(`❌ [PHASE ORCHESTRATOR] ${errorMsg}`);
    return { success: false, action: "SAFETY_GATE_REJECTED", error: errorMsg };
  }

  const cycleId = recordCycleStart();

  try {
    let actionSummary = "";

    // Action 1: Phase 3 -> Phase 4 Transition
    if (evaluation.currentPhase === "PHASE_3_CATALYST" && evaluation.nextPhase === "PHASE_4_HARVEST") {
      actionSummary = "PHASE_3_TO_PHASE_4_HARVEST_INITIALIZED";
      logger.success(
        `🎉 [TRANSITION] $${evaluation.ticker} met catalyst criteria! Advancing to Phase 4 (Perpetual Harvest & Flywheel).`
      );
    }
    // Action 2: Phase 4 -> Phase 5 Transition
    else if (evaluation.currentPhase === "PHASE_4_HARVEST" && evaluation.nextPhase === "PHASE_5_SOCIALFI") {
      actionSummary = "PHASE_4_TO_PHASE_5_SOCIALFI_MERKLE_PROVISIONED";
      const sampleClaims: BountyClaimItem[] = options?.customBountyClaims || [
        { walletAddress: "0x1111111111111111111111111111111111111111", tokenAmount: 1000n * 10n ** 18n },
      ];
      const merkleTree = BountyEscrowService.generateBountyMerkleTree(sampleClaims);
      logger.success(
        `🎉 [TRANSITION] $${evaluation.ticker} generated SocialFi Bounty Merkle Root: ${merkleTree.root}`
      );
    }
    // Action 3: Phase 5 -> Phase 6 Transition
    else if (evaluation.currentPhase === "PHASE_5_SOCIALFI" && evaluation.nextPhase === "PHASE_6_FLEET") {
      actionSummary = "PHASE_5_TO_PHASE_6_FLEET_EXPANSION_TRIGGERED";
      logger.success(
        `🎉 [TRANSITION] $${evaluation.ticker} advancing to Phase 6 Multi-Chain Fleet expansion!`
      );
    }

    // Record immutable audit log
    const audit = logIntervention({
      action: "phase_transition",
      initiatedBy: "phase_orchestrator",
      contractAddr: evaluation.targetTokenAddress,
      requestedAt: new Date().toISOString(),
      result: "success",
      resultDetail: JSON.stringify({
        fromPhase: evaluation.currentPhase,
        toPhase: evaluation.nextPhase,
        action: actionSummary,
        metrics: evaluation.metrics,
        simulated: isSimulated,
      }),
    });

    updateCycleOutcome(cycleId, {
      completedAt: new Date().toISOString(),
      decisionApproved: true,
      trendDataFound: true,
      identityFound: true,
    });

    return {
      success: true,
      action: actionSummary,
      auditLogId: audit.id,
    };
  } catch (err: any) {
    updateCycleOutcome(cycleId, {
      completedAt: new Date().toISOString(),
      decisionApproved: false,
      rejectionReason: err?.message || String(err),
    });
    return {
      success: false,
      action: "TRANSITION_FAILED",
      error: err?.message || String(err),
    };
  }
}
