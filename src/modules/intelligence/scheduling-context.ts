/**
 * scheduling-context.ts — Read-Only Analytical View of Pipeline Activity (V2.5.0)
 *
 * Provides historical observability and funnel metrics to inform future scheduling
 * decisions without coupling to execution, token selection, or autonomous trading logic.
 *
 * Rules:
 *  - Read-only analytics derived strictly from persistent data (pipeline_cycles).
 *  - Deterministic calculations with safe defaults (zero cycles -> safe defaults, no NaN or Infinity).
 *  - Clear denominators for approvalRate and deploymentRate.
 *  - ZERO modification to candidate decision evaluation or financial ledger.
 */

import { getRecentCycles, type PipelineCycleRow } from "../../db/vault.ts";

export interface RecentCyclesMetrics {
  count: number;
  avgDurationMs: number | null;
  approvalRate: number | null;     // approved / total candidates evaluated (decision_approved !== null)
  deploymentRate: number | null;   // deploymentsConfirmed / deploymentsAttempted
  dailyLimitHits: number;
  lockSkips: number;
}

export interface CandidateFunnelMetrics {
  windowDays: number;
  discovered: number;             // trendDataFound === true
  analyzed: number;               // identityFound === true
  approved: number;               // decisionApproved === true
  rejectedLowScore: number;       // rejectionReason === 'LOW_VIRAL_SCORE'
  rejectedSaturated: number;      // rejectionReason === 'SATURATED'
  deployed: number;               // total deploymentsAttempted
  deploymentsConfirmed: number;   // total deploymentsConfirmed
}

export interface SchedulingContext {
  generatedAt: string;
  recentCycles: RecentCyclesMetrics;
  candidateFunnel: CandidateFunnelMetrics;
}

/**
 * Builds a read-only SchedulingContext across the specified window of days (default: 7).
 */
export function buildSchedulingContext(windowDays = 7): SchedulingContext {
  const cycles = getRecentCycles(windowDays);
  const now = new Date().toISOString();

  if (cycles.length === 0) {
    return {
      generatedAt: now,
      recentCycles: {
        count: 0,
        avgDurationMs: null,
        approvalRate: null,
        deploymentRate: null,
        dailyLimitHits: 0,
        lockSkips: 0,
      },
      candidateFunnel: {
        windowDays,
        discovered: 0,
        analyzed: 0,
        approved: 0,
        rejectedLowScore: 0,
        rejectedSaturated: 0,
        deployed: 0,
        deploymentsConfirmed: 0,
      },
    };
  }

  let totalDuration = 0;
  let durationCount = 0;
  let evaluatedCandidatesCount = 0;
  let approvedCandidatesCount = 0;
  let totalDeploymentsAttempted = 0;
  let totalDeploymentsConfirmed = 0;
  let dailyLimitHits = 0;
  let lockSkips = 0;

  let discovered = 0;
  let analyzed = 0;
  let approved = 0;
  let rejectedLowScore = 0;
  let rejectedSaturated = 0;

  for (const c of cycles) {
    if (!c.lockAcquired) {
      lockSkips++;
    }
    if (c.dailyLimitHit) {
      dailyLimitHits++;
    }
    if (c.durationMs !== null && c.durationMs >= 0) {
      totalDuration += c.durationMs;
      durationCount++;
    }

    if (c.trendDataFound) {
      discovered++;
    }
    if (c.identityFound) {
      analyzed++;
    }

    if (c.decisionApproved !== null) {
      evaluatedCandidatesCount++;
      if (c.decisionApproved) {
        approvedCandidatesCount++;
        approved++;
      }
    }

    if (c.rejectionReason === "LOW_VIRAL_SCORE") {
      rejectedLowScore++;
    } else if (c.rejectionReason === "SATURATED") {
      rejectedSaturated++;
    }

    totalDeploymentsAttempted += c.deploymentsAttempted;
    totalDeploymentsConfirmed += c.deploymentsConfirmed;
  }

  const avgDurationMs = durationCount > 0 ? Math.round(totalDuration / durationCount) : null;
  const approvalRate = evaluatedCandidatesCount > 0 ? approvedCandidatesCount / evaluatedCandidatesCount : null;
  const deploymentRate = totalDeploymentsAttempted > 0 ? totalDeploymentsConfirmed / totalDeploymentsAttempted : null;

  return {
    generatedAt: now,
    recentCycles: {
      count: cycles.length,
      avgDurationMs,
      approvalRate,
      deploymentRate,
      dailyLimitHits,
      lockSkips,
    },
    candidateFunnel: {
      windowDays,
      discovered,
      analyzed,
      approved,
      rejectedLowScore,
      rejectedSaturated,
      deployed: totalDeploymentsAttempted,
      deploymentsConfirmed: totalDeploymentsConfirmed,
    },
  };
}
