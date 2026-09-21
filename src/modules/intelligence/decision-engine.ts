/**
 * decision-engine.ts — Intelligence-to-Decision Interface (V2.4.4)
 *
 * Establishes a clean architectural boundary between:
 *   INTELLIGENCE (Candidate, Radar, AI, Saturation, Analytics)
 *       ↓
 *   DECISION INPUT (Normalized, credential-free decision payload)
 *       ↓
 *   DECISION RESULT (Deterministic evaluation outcome: approved, rejection reason, eligible chains)
 *       ↓
 *   EXECUTION (Deployers, Wallets, Positions, Reconciliation)
 *
 * Principles:
 *  - Pure, deterministic, side-effect free evaluation.
 *  - ZERO wallet credentials, private keys, or ledger balance dependencies.
 *  - Candidate identity (candidateId) preserved end-to-end.
 *  - Execution behavior in V2.4.4 remains 100% identical to V2.4.3 (no winner selection, no adaptive skipping).
 */

import type { TokenIdentity } from "../ai/gemini-brain.ts";
import type { CrossChainSaturationResult, ChainSaturationDetail } from "../market/saturation-checker.ts";

export type RejectionReason =
  | "LOW_VIRAL_SCORE"
  | "SATURATED"
  | "ASSET_GENERATION_FAILED"
  | "ASSET_UPLOAD_FAILED";

/**
 * Raw intelligence observation and derived analytics captured for a single candidate.
 * Contains explicit provenance for every field.
 */
export interface IntelligenceSnapshot {
  // Provenance: Generated in index.ts via generateCandidateId()
  candidateId: string;

  // Provenance: Raw AI output from gemini-brain.ts (generateTokenIdentity)
  tokenIdentity: TokenIdentity;

  // Provenance: Raw discovery signal from firecrawl-radar.ts (scanTrends)
  discoverySignal: {
    sources: string[];
    scrapedAt: string;
    rawTrendLength: number;
  };

  // Provenance: Raw cross-chain market observation from saturation-checker.ts (checkSaturation)
  saturationObservation?: {
    count: number;
    saturated: boolean;
    byChain: Record<string, ChainSaturationDetail>;
    observedChains: string[];
    source: string;
    providerStatus: "available" | "unavailable";
    observedAt: string;
  };

  // Provenance: Derived historical analytics from owner-reporter.ts / vault.ts (read-only context)
  historicalContext?: {
    totalCandidatesEvaluated?: number;
    overallSuccessRate?: number;
    historicalWinRateForViralTier?: number;
  };

  // Metadata: Timestamp when intelligence snapshot was frozen
  capturedAt: string;
}

/**
 * Clean, credential-free input payload for candidate deployment evaluation.
 * Excludes all wallet private keys, provider routing, RPCs, and financial ledger data.
 */
export interface DecisionInput {
  candidateId: string;
  tokenName: string;
  ticker: string;
  viralScore: number;
  minViralScoreThreshold: number;

  saturationCount?: number;
  saturationThreshold: number;
  isSaturationCheckEnabled: boolean;

  crossChainObservations?: Record<string, ChainSaturationDetail>;

  configuredChains: string[];

  // Optional contextual intelligence for auditing (does not alter deterministic threshold logic)
  historicalContext?: {
    totalCandidatesEvaluated?: number;
    overallSuccessRate?: number;
  };
}

/**
 * Deterministic outcome of the candidate decision evaluation.
 */
export interface DecisionResult {
  candidateId: string;
  approved: boolean;
  rejectionReason?: RejectionReason;
  rejectionMessage?: string;
  eligibleChains: string[];
  evaluatedAt: string;
}

/**
 * Pure builder function: constructs an IntelligenceSnapshot from disparate pipeline pieces.
 */
export function buildIntelligenceSnapshot(params: {
  candidateId: string;
  tokenIdentity: TokenIdentity;
  sources: string[];
  scrapedAt: string;
  rawTrendLength: number;
  saturationResult?: CrossChainSaturationResult;
  historicalContext?: {
    totalCandidatesEvaluated?: number;
    overallSuccessRate?: number;
    historicalWinRateForViralTier?: number;
  };
}): IntelligenceSnapshot {
  return {
    candidateId: params.candidateId,
    tokenIdentity: params.tokenIdentity,
    discoverySignal: {
      sources: params.sources,
      scrapedAt: params.scrapedAt,
      rawTrendLength: params.rawTrendLength,
    },
    saturationObservation: params.saturationResult
      ? {
          count: params.saturationResult.count,
          saturated: params.saturationResult.saturated,
          byChain: params.saturationResult.byChain,
          observedChains: params.saturationResult.observedChains,
          source: params.saturationResult.source,
          providerStatus: params.saturationResult.providerStatus,
          observedAt: params.saturationResult.timestamp,
        }
      : undefined,
    historicalContext: params.historicalContext,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Pure builder function: maps an IntelligenceSnapshot and operational configuration into DecisionInput.
 * Guarantees zero credential or ledger leakage.
 */
export function buildDecisionInput(
  snapshot: IntelligenceSnapshot,
  config: {
    minViralScore: number;
    saturationThreshold?: number;
    saturationCheckEnabled: boolean;
    configuredChains: string[];
  }
): DecisionInput {
  return {
    candidateId: snapshot.candidateId,
    tokenName: snapshot.tokenIdentity.name,
    ticker: snapshot.tokenIdentity.ticker,
    viralScore: snapshot.tokenIdentity.viralScore,
    minViralScoreThreshold: config.minViralScore,
    saturationCount: snapshot.saturationObservation?.count,
    saturationThreshold: config.saturationThreshold ?? 3,
    isSaturationCheckEnabled: config.saturationCheckEnabled,
    crossChainObservations: snapshot.saturationObservation?.byChain,
    configuredChains: [...config.configuredChains],
    historicalContext: snapshot.historicalContext
      ? {
          totalCandidatesEvaluated: snapshot.historicalContext.totalCandidatesEvaluated,
          overallSuccessRate: snapshot.historicalContext.overallSuccessRate,
        }
      : undefined,
  };
}

/**
 * Pure, deterministic evaluation function for candidate deployment approval.
 *
 * Implements exact gates from V2.4.3:
 * 1. Viral score gate: viralScore >= minViralScoreThreshold
 * 2. Saturation gate: if enabled, (saturationCount ?? 0) < saturationThreshold
 *
 * If approved: eligibleChains equals input.configuredChains (zero change to execution routing).
 * If rejected: approved is false, eligibleChains is empty, rejectionReason is populated.
 */
export function evaluateCandidateDecision(input: DecisionInput): DecisionResult {
  const evaluatedAt = new Date().toISOString();

  // Gate 1: Viral Score
  if (input.viralScore < input.minViralScoreThreshold) {
    return {
      candidateId: input.candidateId,
      approved: false,
      rejectionReason: "LOW_VIRAL_SCORE",
      rejectionMessage: `Skor viral terlalu rendah (${input.viralScore} < ${input.minViralScoreThreshold}).`,
      eligibleChains: [],
      evaluatedAt,
    };
  }

  // Gate 2: Saturation Check
  if (input.isSaturationCheckEnabled) {
    const count = input.saturationCount ?? 0;
    if (count >= input.saturationThreshold) {
      return {
        candidateId: input.candidateId,
        approved: false,
        rejectionReason: "SATURATED",
        rejectionMessage: `${count} token $${input.ticker} sudah ada di pasar (batas: ${input.saturationThreshold}).`,
        eligibleChains: [],
        evaluatedAt,
      };
    }
  }

  // Gate 3: Candidate Approved
  return {
    candidateId: input.candidateId,
    approved: true,
    eligibleChains: [...input.configuredChains],
    evaluatedAt,
  };
}
