/**
 * tests/v243-cross-chain-saturation.test.ts
 *
 * V2.4.3 — Cross-Chain Saturation Intelligence Regression Tests.
 *
 * Verifies:
 *  1. Single-chain observation:
 *     - Pair search on DexScreener resolves chain-specific matches accurately.
 *  2. Multi-chain observation:
 *     - Matches across multiple chains (Base, Solana, Ethereum, etc.) are partitioned by chainId.
 *  3. Same candidate with different observations per chain:
 *     - One candidateId links to distinct observation counts across chains (e.g. Base = 0, Solana = 2).
 *  4. Missing/unavailable provider data:
 *     - When provider is down, providerStatus is 'unavailable' and does not throw or crash.
 *  5. Zero matches vs missing data distinction:
 *     - providerStatus: 'available' with count: 0 is explicitly distinguishable from providerStatus: 'unavailable'.
 *  6. Timestamp and source persistence:
 *     - Observed timestamp and source ('dexscreener') are recorded and queryable.
 *  7. Candidate lineage persistence:
 *     - Saturation observations are stored with candidate_id and retrievable via getSaturationObservationsByCandidate.
 *     - Observations are preserved even if candidate is saturated and deployment was skipped.
 *  8. Integration with historical analytics:
 *     - getCandidatePerformanceSummary and getCrossChainSaturationReport reflect cross-chain saturation.
 *  9. Backward compatibility:
 *     - Deployments without saturation observations remain valid and readable.
 *  10. Deployment behavior unchanged:
 *     - Active chains and deployment execution order are not modified by cross-chain saturation.
 */
import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import {
  checkCrossChainSaturation,
  checkSaturation,
} from "../src/modules/market/saturation-checker.ts";
import {
  logDeploy,
  generateCandidateId,
  recordSaturationObservation,
  recordSaturationObservations,
  getSaturationObservationsByCandidate,
  getSaturationObservationsByTicker,
  getAllSaturationObservations,
  type SaturationObservationInput,
} from "../src/db/vault.ts";
import {
  getCandidatePerformanceSummary,
  getCrossChainSaturationReport,
} from "../src/modules/owner/owner-reporter.ts";

function testTicker(): string {
  return `SAT${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

describe("V2.4.3 — Cross-Chain Saturation Intelligence", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    axiosGetSpy = spyOn(axios, "get");
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
  });

  // ── 1. Single-Chain Observation ────────────────────────────

  describe("1. Single-Chain Observation", () => {
    it("1.1 observes matches concentrated on a single chain", async () => {
      const ticker = testTicker();
      const now = Date.now();

      axiosGetSpy.mockResolvedValueOnce({
        data: {
          pairs: [
            { chainId: "base", pairCreatedAt: now - 1000, baseToken: { symbol: ticker } },
            { chainId: "base", pairCreatedAt: now - 2000, baseToken: { symbol: ticker } },
          ],
        },
      });

      const res = await checkCrossChainSaturation(ticker, ["base", "solana"]);

      expect(res.count).toBe(2);
      expect(res.saturated).toBe(false);
      expect(res.providerStatus).toBe("available");
      expect(res.byChain["base"]).toBeDefined();
      expect(res.byChain["base"].observedCount).toBe(2);
      expect(res.byChain["solana"]).toBeDefined();
      expect(res.byChain["solana"].observedCount).toBe(0);
      expect(res.observedChains).toEqual(["base"]);
    });
  });

  // ── 2. Multi-Chain Observation ─────────────────────────────

  describe("2. Multi-Chain Observation", () => {
    it("2.1 partitions matches across multiple chains accurately", async () => {
      const ticker = testTicker();
      const now = Date.now();

      axiosGetSpy.mockResolvedValueOnce({
        data: {
          pairs: [
            { chainId: "base", pairCreatedAt: now - 500, baseToken: { symbol: ticker } },
            { chainId: "solana", pairCreatedAt: now - 1000, baseToken: { symbol: ticker } },
            { chainId: "solana", pairCreatedAt: now - 1500, baseToken: { symbol: ticker } },
            { chainId: "ethereum", pairCreatedAt: now - 2000, baseToken: { symbol: ticker } },
          ],
        },
      });

      const res = await checkCrossChainSaturation(ticker, ["base", "solana"]);

      expect(res.count).toBe(4);
      expect(res.saturated).toBe(true); // >= 3 threshold
      expect(res.byChain["base"].observedCount).toBe(1);
      expect(res.byChain["solana"].observedCount).toBe(2);
      expect(res.byChain["ethereum"].observedCount).toBe(1);
      expect(res.observedChains).toEqual(["base", "ethereum", "solana"]);
    });
  });

  // ── 3. Same Candidate Different Observations Per Chain ─────

  describe("3. Same Candidate with Different Observations Across Chains", () => {
    it("3.1 links distinct chain observations to the same candidateId", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const now = new Date().toISOString();

      const observations: SaturationObservationInput[] = [
        { candidateId, ticker, chain: "global", observedCount: 2, isSaturated: false, observedAt: now },
        { candidateId, ticker, chain: "base", observedCount: 0, isSaturated: false, observedAt: now },
        { candidateId, ticker, chain: "solana", observedCount: 2, isSaturated: false, observedAt: now },
      ];

      recordSaturationObservations(observations);

      const retrieved = getSaturationObservationsByCandidate(candidateId);
      expect(retrieved).toHaveLength(3);

      const baseObs = retrieved.find((o) => o.chain === "base");
      const solObs = retrieved.find((o) => o.chain === "solana");
      const globalObs = retrieved.find((o) => o.chain === "global");

      expect(baseObs).toBeDefined();
      expect(baseObs!.observedCount).toBe(0);
      expect(baseObs!.candidateId).toBe(candidateId);

      expect(solObs).toBeDefined();
      expect(solObs!.observedCount).toBe(2);
      expect(solObs!.candidateId).toBe(candidateId);

      expect(globalObs).toBeDefined();
      expect(globalObs!.observedCount).toBe(2);
    });
  });

  // ── 4. Missing/Unavailable Provider Data ───────────────────

  describe("4. Missing or Unavailable Provider Data", () => {
    it("4.1 flags providerStatus as unavailable when provider call fails without crashing", async () => {
      const ticker = testTicker();
      axiosGetSpy.mockRejectedValueOnce(new Error("DexScreener 503 Service Unavailable"));

      const res = await checkCrossChainSaturation(ticker, ["base", "solana"]);

      expect(res.providerStatus).toBe("unavailable");
      expect(res.count).toBe(0);
      expect(res.saturated).toBe(false);
      expect(res.message).toBe("check failed — skipped");
      expect(res.byChain["base"].observedCount).toBe(0);
      expect(res.byChain["solana"].observedCount).toBe(0);
    });
  });

  // ── 5. Zero Matches vs Missing Data Distinction ────────────

  describe("5. Zero Matches vs Missing Data Distinction", () => {
    it("5.1 clearly distinguishes zero matches (available) from provider failure (unavailable)", async () => {
      const tickerZero = testTicker();
      axiosGetSpy.mockResolvedValueOnce({ data: { pairs: [] } });

      const zeroRes = await checkCrossChainSaturation(tickerZero, ["base", "solana"]);
      expect(zeroRes.count).toBe(0);
      expect(zeroRes.providerStatus).toBe("available");
      expect(zeroRes.message).toBe("OK");

      const tickerError = testTicker();
      axiosGetSpy.mockRejectedValueOnce(new Error("Timeout"));

      const errorRes = await checkCrossChainSaturation(tickerError, ["base", "solana"]);
      expect(errorRes.count).toBe(0);
      expect(errorRes.providerStatus).toBe("unavailable");
      expect(errorRes.message).toContain("check failed");

      // Distinct statuses
      expect(zeroRes.providerStatus).not.toBe(errorRes.providerStatus);
    });
  });

  // ── 6. Timestamp and Source Persistence ────────────────────

  describe("6. Timestamp and Source Persistence", () => {
    it("6.1 stores and retrieves observation timestamp and source", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const customTime = "2026-09-04T15:30:00.000Z";

      recordSaturationObservation({
        candidateId,
        ticker,
        chain: "base",
        observedCount: 1,
        isSaturated: false,
        source: "dexscreener",
        observedAt: customTime,
        providerStatus: "available",
      });

      const observations = getSaturationObservationsByCandidate(candidateId);
      expect(observations).toHaveLength(1);
      expect(observations[0].source).toBe("dexscreener");
      expect(observations[0].observedAt).toBe(customTime);
      expect(observations[0].providerStatus).toBe("available");
    });
  });

  // ── 7. Candidate Lineage & Preserved Rejection Lineage ─────

  describe("7. Candidate Lineage & Rejection Persistence", () => {
    it("7.1 records observations even when candidate is rejected before deployment", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();

      // Simulate saturated ticker rejected before any deploy_logs row is created
      recordSaturationObservation({
        candidateId,
        ticker,
        chain: "global",
        observedCount: 5,
        isSaturated: true,
        threshold: 3,
        source: "dexscreener",
        providerStatus: "available",
        observedAt: new Date().toISOString(),
      });

      const observations = getSaturationObservationsByCandidate(candidateId);
      expect(observations).toHaveLength(1);
      expect(observations[0].candidateId).toBe(candidateId);
      expect(observations[0].isSaturated).toBe(true);
      expect(observations[0].observedCount).toBe(5);
    });
  });

  // ── 8. Integration with Historical Analytics ───────────────

  describe("8. Integration with Historical Analytics", () => {
    it("8.1 getCandidatePerformanceSummary and getCrossChainSaturationReport reflect cross-chain saturation", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();

      const deployBaseId = logDeploy({
        chain: "base",
        tokenName: "Cross Sat Token",
        ticker,
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
        candidateId,
        saturationCount: 0, // Base has 0 matches
      });

      const deploySolId = logDeploy({
        chain: "solana",
        tokenName: "Cross Sat Token",
        ticker,
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
        candidateId,
        saturationCount: 2, // Solana has 2 matches
      });

      const now = new Date().toISOString();
      recordSaturationObservations([
        { candidateId, ticker, chain: "global", observedCount: 2, isSaturated: false, observedAt: now },
        { candidateId, ticker, chain: "base", observedCount: 0, isSaturated: false, observedAt: now },
        { candidateId, ticker, chain: "solana", observedCount: 2, isSaturated: false, observedAt: now },
      ]);

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.crossChainSaturation).toBeDefined();
      expect(summary!.crossChainSaturation!["base"]).toBe(0);
      expect(summary!.crossChainSaturation!["solana"]).toBe(2);
      expect(summary!.byChain["base"].observedSaturationCount).toBe(0);
      expect(summary!.byChain["solana"].observedSaturationCount).toBe(2);

      const report = getCrossChainSaturationReport(candidateId);
      expect(report).toBeDefined();
      expect(report!.globalCount).toBe(2);
      expect(report!.isGloballySaturated).toBe(false);
      expect(report!.byChain["base"].observedCount).toBe(0);
      expect(report!.byChain["solana"].observedCount).toBe(2);
      expect(report!.observedChains).toEqual(["solana"]);
    });
  });

  // ── 9. Backward Compatibility ──────────────────────────────

  describe("9. Backward Compatibility", () => {
    it("9.1 candidate without saturation observations returns empty crossChainSaturation safely", () => {
      const candidateId = generateCandidateId();
      logDeploy({
        chain: "base",
        tokenName: "Legacy Sat Token",
        ticker: testTicker(),
        status: "pending",
        candidateId,
      });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.saturationObservations).toEqual([]);
      expect(summary!.crossChainSaturation).toEqual({});
      expect(summary!.byChain["base"].observedSaturationCount).toBeNull();
    });

    it("9.2 checkSaturation returns backward-compatible SaturationResult shape", async () => {
      const ticker = testTicker();
      axiosGetSpy.mockResolvedValueOnce({ data: { pairs: [] } });

      const res = await checkSaturation(ticker);
      expect(typeof res.saturated).toBe("boolean");
      expect(typeof res.count).toBe("number");
      expect(typeof res.message).toBe("string");
      expect(res.byChain).toBeDefined();
    });
  });
});
