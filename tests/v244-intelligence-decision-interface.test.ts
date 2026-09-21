import { describe, it, expect } from "bun:test";
import {
  buildIntelligenceSnapshot,
  buildDecisionInput,
  evaluateCandidateDecision,
  type IntelligenceSnapshot,
  type DecisionInput,
} from "../src/modules/intelligence/decision-engine.ts";
import type { TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import type { CrossChainSaturationResult } from "../src/modules/market/saturation-checker.ts";

const mockTokenIdentity: TokenIdentity = {
  name: "Decision Token",
  ticker: "DCSN",
  description: "Token for testing decision engine boundary",
  viralScore: 85,
  imagePrompt: "futuristic brain deciding token fate",
  website: "https://decision.token",
  twitter: "https://x.com/decisiontoken",
  telegram: "https://t.me/decisiontoken",
};

const mockSaturationResult: CrossChainSaturationResult = {
  saturated: false,
  count: 1,
  message: "OK",
  byChain: {
    base: { chain: "base", observedCount: 1, saturated: false },
    solana: { chain: "solana", observedCount: 0, saturated: false },
  },
  observedChains: ["base"],
  timestamp: "2026-09-04T12:00:00.000Z",
  source: "dexscreener",
  providerStatus: "available",
};

describe("V2.4.4 — Intelligence-to-Decision Interface", () => {
  // ─── 1. Candidate Decision Evaluation: Approval ─────────────
  describe("1. Pure Evaluator: Approval Semantics", () => {
    it("1.1 approves candidate when viralScore >= threshold and saturation < threshold", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_approve",
        tokenName: "Decision Token",
        ticker: "DCSN",
        viralScore: 85,
        minViralScoreThreshold: 80,
        saturationCount: 1,
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(true);
      expect(result.candidateId).toBe("cand_test_approve");
      expect(result.rejectionReason).toBeUndefined();
      expect(result.eligibleChains).toEqual(["base", "solana"]);
      expect(result.evaluatedAt).toBeDefined();
    });

    it("1.2 approves candidate exactly at threshold boundaries (boundary value test)", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_boundary",
        tokenName: "Boundary Token",
        ticker: "BND",
        viralScore: 80, // exactly min threshold
        minViralScoreThreshold: 80,
        saturationCount: 2, // 2 is < 3
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(true);
      expect(result.rejectionReason).toBeUndefined();
    });
  });

  // ─── 2. Candidate Decision Evaluation: Rejections ───────────
  describe("2. Pure Evaluator: Rejection Semantics", () => {
    it("2.1 rejects candidate when viralScore < minViralScoreThreshold with LOW_VIRAL_SCORE", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_low_score",
        tokenName: "Low Score Token",
        ticker: "LOW",
        viralScore: 79,
        minViralScoreThreshold: 80,
        saturationCount: 0,
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(false);
      expect(result.candidateId).toBe("cand_test_low_score");
      expect(result.rejectionReason).toBe("LOW_VIRAL_SCORE");
      expect(result.rejectionMessage).toContain("79 < 80");
      expect(result.eligibleChains).toEqual([]);
    });

    it("2.2 rejects candidate when saturationCount >= saturationThreshold with SATURATED", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_sat",
        tokenName: "Saturated Token",
        ticker: "SAT",
        viralScore: 90,
        minViralScoreThreshold: 80,
        saturationCount: 3, // >= threshold 3
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(false);
      expect(result.candidateId).toBe("cand_test_sat");
      expect(result.rejectionReason).toBe("SATURATED");
      expect(result.rejectionMessage).toContain("3 token $SAT sudah ada");
      expect(result.eligibleChains).toEqual([]);
    });

    it("2.3 prioritizes viral score rejection before saturation when both fail", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_both_fail",
        tokenName: "Double Fail Token",
        ticker: "FAIL",
        viralScore: 50,
        minViralScoreThreshold: 80,
        saturationCount: 10,
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(false);
      expect(result.rejectionReason).toBe("LOW_VIRAL_SCORE");
    });
  });

  // ─── 3. Saturation Toggle & Missing Data Handling ───────────
  describe("3. Saturation Toggle & Missing Data Resilience", () => {
    it("3.1 approves candidate even with high saturationCount when isSaturationCheckEnabled is false", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_sat_disabled",
        tokenName: "Ignore Saturation",
        ticker: "IGN",
        viralScore: 95,
        minViralScoreThreshold: 80,
        saturationCount: 10, // would normally reject
        saturationThreshold: 3,
        isSaturationCheckEnabled: false, // saturation check bypass
        configuredChains: ["base"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(true);
      expect(result.eligibleChains).toEqual(["base"]);
    });

    it("3.2 gracefully treats undefined saturationCount as 0 (safe fallback)", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_sat_undef",
        tokenName: "Undefined Saturation",
        ticker: "UNDEF",
        viralScore: 88,
        minViralScoreThreshold: 80,
        saturationCount: undefined,
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(true);
      expect(result.eligibleChains).toEqual(["base", "solana"]);
    });
  });

  // ─── 4. Intelligence Snapshot Construction & Provenance ────
  describe("4. IntelligenceSnapshot Formation & Provenance", () => {
    it("4.1 constructs snapshot with complete lineage and explicit source attribution", () => {
      const snapshot: IntelligenceSnapshot = buildIntelligenceSnapshot({
        candidateId: "cand_prov_123",
        tokenIdentity: mockTokenIdentity,
        sources: ["dexscreener", "coingecko"],
        scrapedAt: "2026-09-04T12:00:00.000Z",
        rawTrendLength: 1540,
        saturationResult: mockSaturationResult,
        historicalContext: {
          totalCandidatesEvaluated: 42,
          overallSuccessRate: 65.5,
          historicalWinRateForViralTier: 72.0,
        },
      });

      expect(snapshot.candidateId).toBe("cand_prov_123");
      expect(snapshot.tokenIdentity.ticker).toBe("DCSN");
      expect(snapshot.tokenIdentity.viralScore).toBe(85);
      expect(snapshot.discoverySignal.sources).toEqual(["dexscreener", "coingecko"]);
      expect(snapshot.discoverySignal.scrapedAt).toBe("2026-09-04T12:00:00.000Z");
      expect(snapshot.discoverySignal.rawTrendLength).toBe(1540);
      expect(snapshot.saturationObservation).toBeDefined();
      expect(snapshot.saturationObservation?.count).toBe(1);
      expect(snapshot.saturationObservation?.source).toBe("dexscreener");
      expect(snapshot.saturationObservation?.providerStatus).toBe("available");
      expect(snapshot.historicalContext?.totalCandidatesEvaluated).toBe(42);
      expect(snapshot.capturedAt).toBeDefined();
    });

    it("4.2 constructs snapshot cleanly without saturationResult when check is omitted", () => {
      const snapshot: IntelligenceSnapshot = buildIntelligenceSnapshot({
        candidateId: "cand_prov_no_sat",
        tokenIdentity: mockTokenIdentity,
        sources: ["twitter"],
        scrapedAt: "2026-09-04T12:00:00.000Z",
        rawTrendLength: 500,
      });

      expect(snapshot.candidateId).toBe("cand_prov_no_sat");
      expect(snapshot.saturationObservation).toBeUndefined();
      expect(snapshot.historicalContext).toBeUndefined();
    });
  });

  // ─── 5. Decision Input Mapping & Separation of Concerns ────
  describe("5. DecisionInput Mapping & Separation of Concerns", () => {
    it("5.1 maps IntelligenceSnapshot to DecisionInput without financial credentials", () => {
      const snapshot = buildIntelligenceSnapshot({
        candidateId: "cand_map_test",
        tokenIdentity: mockTokenIdentity,
        sources: ["coingecko"],
        scrapedAt: "2026-09-04T12:00:00.000Z",
        rawTrendLength: 1000,
        saturationResult: mockSaturationResult,
        historicalContext: {
          totalCandidatesEvaluated: 10,
          overallSuccessRate: 50.0,
        },
      });

      const decisionInput = buildDecisionInput(snapshot, {
        minViralScore: 75,
        saturationThreshold: 3,
        saturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      });

      expect(decisionInput.candidateId).toBe("cand_map_test");
      expect(decisionInput.tokenName).toBe("Decision Token");
      expect(decisionInput.ticker).toBe("DCSN");
      expect(decisionInput.viralScore).toBe(85);
      expect(decisionInput.minViralScoreThreshold).toBe(75);
      expect(decisionInput.saturationCount).toBe(1);
      expect(decisionInput.saturationThreshold).toBe(3);
      expect(decisionInput.isSaturationCheckEnabled).toBe(true);
      expect(decisionInput.configuredChains).toEqual(["base", "solana"]);

      // AUDIT: Verify no wallet or financial state exists on decisionInput
      const keys = Object.keys(decisionInput);
      expect(keys).not.toContain("privateKey");
      expect(keys).not.toContain("walletId");
      expect(keys).not.toContain("mnemonic");
      expect(keys).not.toContain("balance");
      expect(keys).not.toContain("proxyUrl");
      expect(keys).not.toContain("pnl");
    });
  });

  // ─── 6. Execution Invariance Guard ─────────────────────────
  describe("6. Execution Invariance Guard", () => {
    it("6.1 preserves exact configuredChains order without dropping or reordering chains", () => {
      const input: DecisionInput = {
        candidateId: "cand_test_invariance",
        tokenName: "Invariant Token",
        ticker: "INVR",
        viralScore: 92,
        minViralScoreThreshold: 80,
        saturationCount: 0,
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["solana", "base", "robinhood"],
      };

      const result = evaluateCandidateDecision(input);

      expect(result.approved).toBe(true);
      // Order and elements must be exactly identical
      expect(result.eligibleChains).toEqual(["solana", "base", "robinhood"]);
    });

    it("6.2 ensures decision evaluator is pure and does not mutate input object", () => {
      const input: DecisionInput = {
        candidateId: "cand_pure_test",
        tokenName: "Pure Token",
        ticker: "PURE",
        viralScore: 85,
        minViralScoreThreshold: 80,
        saturationCount: 1,
        saturationThreshold: 3,
        isSaturationCheckEnabled: true,
        configuredChains: ["base", "solana"],
      };

      const inputBefore = JSON.parse(JSON.stringify(input));
      const result1 = evaluateCandidateDecision(input);
      const result2 = evaluateCandidateDecision(input);

      expect(input).toEqual(inputBefore);
      expect(result1.approved).toBe(result2.approved);
      expect(result1.rejectionReason).toBe(result2.rejectionReason);
      expect(result1.eligibleChains).toEqual(result2.eligibleChains);
    });
  });
});
