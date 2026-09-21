/**
 * tests/v242-historical-performance-analytics.test.ts
 *
 * V2.4.2 — Historical Performance Analytics Regression Tests.
 *
 * Verifies:
 *  1. Candidate with single deployment:
 *     - Summary includes counts, deployments, positions, PnL
 *  2. Cross-chain candidate:
 *     - Candidate-level aggregate and per-chain breakdown
 *  3. Multiple positions under one candidate:
 *     - Open vs closed positions properly partitioned
 *  4. PnL status separation:
 *     - Realized monetary PnL calculated strictly from pnl_status === 'calculated'
 *     - pnl_pending is counted, never included in monetary sum
 *  5. Signed PnL values:
 *     - Positive profit, negative loss, zero PnL accurately aggregated
 *  6. Price return isolation:
 *     - price_return_percent tracked only as market metric, NEVER added to realized PnL
 *  7. Legacy deployments (candidate_id IS NULL):
 *     - Handled safely via 'legacy_unassigned' or null query without crashing
 *  8. Missing signal metadata:
 *     - Preserved as null, bucketed as 'unrecorded', NOT fabricated as zero/defaults
 *  9. Candidate history filtering:
 *     - Filter by chain, viral score range, hasPositions, limit
 *  10. Historical signal performance reporting:
 *     - Bucketing by viralScore tiers (90-100, 80-89, 70-79, <70, unrecorded)
 *     - Bucketing by saturationCount (0, 1, 2, 3+, unrecorded)
 *     - Bucketing by signalSource
 *     - Observational and non-causal
 *  11. Financial ledger isolation:
 *     - Analytics does NOT modify or pollute treasury_ledger or platform financial summaries
 */
import { describe, it, expect } from "bun:test";
import {
  logDeploy,
  createPendingPosition,
  transitionPositionState,
  generateCandidateId,
  type DeployLog,
} from "../src/db/vault.ts";
import {
  getCandidatePerformanceSummary,
  getCandidatePerformanceHistory,
  getHistoricalSignalPerformance,
  getPlatformPnlSummary,
  type CandidatePerformanceSummary,
} from "../src/modules/owner/owner-reporter.ts";

function testWalletId(): string {
  return `v242-wallet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function testTicker(): string {
  return `A${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function testContract(): string {
  return `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;
}

const BASE_DEPLOY = {
  tokenName: "Analytics Token",
  status: "pending" as const,
  lifecycleState: "DEPLOY_SUBMITTED",
};

describe("V2.4.2 — Historical Performance Analytics", () => {

  // ── 1. Candidate with Single Deployment ────────────────────

  describe("1. Single Deployment Candidate", () => {
    it("1.1 aggregates deployment and position counts accurately", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletId = testWalletId();

      const deployId = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker,
        walletId,
        candidateId,
        status: "success",
        viralScore: 82,
        saturationCount: 0,
        signalSources: ["https://dexscreener.com/new-pairs"],
        signalScrapedAt: "2026-09-04T12:00:00.000Z",
      });

      const contract = testContract();
      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker,
        snipeAmount: 0.1,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId,
      });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.candidateId).toBe(candidateId);
      expect(summary!.ticker).toBe(ticker);
      expect(summary!.viralScore).toBe(82);
      expect(summary!.saturationCount).toBe(0);
      expect(summary!.signalSources).toEqual(["https://dexscreener.com/new-pairs"]);
      expect(summary!.signalScrapedAt).toBe("2026-09-04T12:00:00.000Z");

      expect(summary!.totalDeployments).toBe(1);
      expect(summary!.successfulDeployments).toBe(1);
      expect(summary!.failedDeployments).toBe(0);

      expect(summary!.totalPositions).toBe(1);
      expect(summary!.openPositions).toBe(1);
      expect(summary!.closedPositions).toBe(0);
      expect(summary!.chains).toEqual(["base"]);
      expect(summary!.byChain["base"]).toBeDefined();
      expect(summary!.byChain["base"].deploymentCount).toBe(1);
      expect(summary!.byChain["base"].positionCount).toBe(1);
    });
  });

  // ── 2. Cross-Chain Candidate ───────────────────────────────

  describe("2. Cross-Chain Candidate Lineage", () => {
    it("2.1 aggregates multiple chains with per-chain breakdown", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletId = testWalletId();

      const deployBaseId = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker,
        walletId,
        candidateId,
        status: "success",
        viralScore: 91,
      });

      const deploySolId = logDeploy({
        ...BASE_DEPLOY,
        chain: "solana",
        ticker,
        walletId,
        candidateId,
        status: "failed",
        errorMsg: "RPC error",
        viralScore: 91,
      });

      const contractBase = testContract();
      createPendingPosition({
        deployLogId: deployBaseId,
        chain: "base",
        contractAddr: contractBase,
        ticker,
        snipeAmount: 0.1,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId,
      });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.totalDeployments).toBe(2);
      expect(summary!.successfulDeployments).toBe(1);
      expect(summary!.failedDeployments).toBe(1);

      expect(summary!.chains).toEqual(["base", "solana"]);
      expect(summary!.byChain["base"].successfulDeployments).toBe(1);
      expect(summary!.byChain["base"].failedDeployments).toBe(0);
      expect(summary!.byChain["base"].positionCount).toBe(1);

      expect(summary!.byChain["solana"].successfulDeployments).toBe(0);
      expect(summary!.byChain["solana"].failedDeployments).toBe(1);
      expect(summary!.byChain["solana"].positionCount).toBe(0);
    });
  });

  // ── 3. Realized PnL vs pnl_pending ─────────────────────────

  describe("3. Financial PnL vs Pending PnL Aggregation", () => {
    it("3.1 calculated PnL is aggregated into totalRealizedPnl; pnl_pending is counted separately", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletId = testWalletId();

      const deployId = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker,
        walletId,
        candidateId,
        status: "success",
      });

      // Position 1: Calculated profit (0.05 ETH)
      const contract1 = testContract();
      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract1,
        ticker,
        snipeAmount: 0.1,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId,
      });
      transitionPositionState(contract1, "buy_submitted", "sold_tp", {
        realizedPnl: 0.05,
        pnlStatus: "calculated",
        closedAt: new Date().toISOString(),
      });

      // Position 2: pnl_pending (BasedBot scenario, exit proceeds not yet verified)
      const contract2 = testContract();
      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract2,
        ticker,
        snipeAmount: 0.1,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId,
      });
      transitionPositionState(contract2, "buy_submitted", "sold_tp", {
        priceReturnPercent: 80,
        pnlStatus: "pnl_pending",
        closedAt: new Date().toISOString(),
      });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.totalPositions).toBe(2);
      expect(summary!.closedPositions).toBe(2);

      // Realized PnL is strictly from Position 1 (0.05)
      expect(summary!.totalRealizedPnl).toBeCloseTo(0.05, 5);
      expect(summary!.totalRealizedProfit).toBeCloseTo(0.05, 5);
      expect(summary!.totalRealizedLoss).toBe(0);
      expect(summary!.calculatedPnlCount).toBe(1);

      // Pending PnL count is strictly 1 (Position 2)
      expect(summary!.pendingPnlCount).toBe(1);
    });
  });

  // ── 4. Signed PnL Aggregation (Profit vs Loss) ──────────────

  describe("4. Signed PnL Aggregation", () => {
    it("4.1 correctly aggregates positive, negative, and zero realized PnL", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletId = testWalletId();

      const deployId = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker,
        walletId,
        candidateId,
        status: "success",
      });

      // Position 1: Profit +0.10
      const c1 = testContract();
      createPendingPosition({ deployLogId: deployId, chain: "base", contractAddr: c1, ticker, snipeAmount: 0.1, takeProfitX: 2, stopLossPct: 0.3, walletId });
      transitionPositionState(c1, "buy_submitted", "sold_tp", { realizedPnl: 0.10, pnlStatus: "calculated" });

      // Position 2: Loss -0.03
      const c2 = testContract();
      createPendingPosition({ deployLogId: deployId, chain: "base", contractAddr: c2, ticker, snipeAmount: 0.1, takeProfitX: 2, stopLossPct: 0.3, walletId });
      transitionPositionState(c2, "buy_submitted", "sold_sl", { realizedPnl: -0.03, pnlStatus: "calculated" });

      // Position 3: Breakeven 0.00
      const c3 = testContract();
      createPendingPosition({ deployLogId: deployId, chain: "base", contractAddr: c3, ticker, snipeAmount: 0.1, takeProfitX: 2, stopLossPct: 0.3, walletId });
      transitionPositionState(c3, "buy_submitted", "manual_closed", { realizedPnl: 0.0, pnlStatus: "calculated" });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.totalRealizedProfit).toBeCloseTo(0.10, 5);
      expect(summary!.totalRealizedLoss).toBeCloseTo(0.03, 5);
      expect(summary!.totalRealizedPnl).toBeCloseTo(0.07, 5); // 0.10 - 0.03
      expect(summary!.calculatedPnlCount).toBe(3);
      expect(summary!.pendingPnlCount).toBe(0);
    });
  });

  // ── 5. Price Return Percent Isolation ──────────────────────

  describe("5. Price Return Isolation", () => {
    it("5.1 price_return_percent is isolated to market metric and NOT mixed into monetary realized PnL", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletId = testWalletId();

      const deployId = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, walletId, candidateId });

      const contract = testContract();
      createPendingPosition({ deployLogId: deployId, chain: "base", contractAddr: contract, ticker, snipeAmount: 0.1, takeProfitX: 2, stopLossPct: 0.3, walletId });

      // Position closed with 150% price return, but pnl_pending (no monetary realized PnL)
      transitionPositionState(contract, "buy_submitted", "sold_tp", {
        priceReturnPercent: 150,
        pnlStatus: "pnl_pending",
      });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();

      // Monetary realized PnL must be 0 (NOT 150!)
      expect(summary!.totalRealizedPnl).toBe(0);
      expect(summary!.totalRealizedProfit).toBe(0);

      // Price return is correctly captured as market metric
      expect(summary!.priceReturns).toEqual([150]);
      expect(summary!.averagePriceReturnPercent).toBe(150);
    });
  });

  // ── 6. Backward Compatibility with NULL candidate_id ───────

  describe("6. Backward Compatibility with NULL candidate_id", () => {
    it("6.1 querying unknown or non-existent candidateId returns null safely", () => {
      const result = getCandidatePerformanceSummary("non_existent_candidate_xyz");
      expect(result).toBeNull();
    });

    it("6.2 querying legacy_unassigned aggregates deployments with candidate_id IS NULL", () => {
      const ticker = testTicker();
      const legacyDeployId = logDeploy({
        chain: "base",
        tokenName: "Legacy Deploy",
        ticker,
        status: "pending",
        // candidateId intentionally omitted
      });

      const summary = getCandidatePerformanceSummary("legacy_unassigned");
      expect(summary).toBeDefined();
      expect(summary!.candidateId).toBe("legacy_unassigned");
      expect(summary!.totalDeployments).toBeGreaterThanOrEqual(1);
      const containsLegacy = summary!.deployments.some((d) => d.id === legacyDeployId);
      expect(containsLegacy).toBe(true);
    });
  });

  // ── 7. Missing Signal Metadata ─────────────────────────────

  describe("7. Missing Signal Metadata Representation", () => {
    it("7.1 candidate with missing signals preserves them as null, not fabricated zeros", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();

      logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker,
        candidateId,
        // viralScore, saturationCount, signalSources, signalScrapedAt omitted
      });

      const summary = getCandidatePerformanceSummary(candidateId);
      expect(summary).toBeDefined();
      expect(summary!.viralScore).toBeNull();
      expect(summary!.saturationCount).toBeNull();
      expect(summary!.signalSources).toBeNull();
      expect(summary!.signalScrapedAt).toBeNull();
    });
  });

  // ── 8. Candidate History Filtering ─────────────────────────

  describe("8. Candidate History & Filtering", () => {
    it("8.1 filters candidates by viral score range and chain", () => {
      const candA = generateCandidateId();
      const candB = generateCandidateId();

      logDeploy({ ...BASE_DEPLOY, chain: "base", ticker: testTicker(), candidateId: candA, viralScore: 95 });
      logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker: testTicker(), candidateId: candB, viralScore: 72 });

      // Filter: minViralScore = 90
      const highViral = getCandidatePerformanceHistory({ minViralScore: 90 });
      const ids = highViral.map((c) => c.candidateId);
      expect(ids).toContain(candA);
      expect(ids).not.toContain(candB);

      // Filter: chain = solana
      const solanaOnly = getCandidatePerformanceHistory({ chain: "solana" });
      const solanaIds = solanaOnly.map((c) => c.candidateId);
      expect(solanaIds).toContain(candB);
      expect(solanaIds).not.toContain(candA);
    }, 15000);

    it("8.2 limits results when limit parameter is provided", () => {
      const history = getCandidatePerformanceHistory({ limit: 1 });
      expect(history.length).toBeLessThanOrEqual(1);
    });
  });

  // ── 9. Historical Signal Performance Bucketing ─────────────

  describe("9. Historical Signal Performance Reporting", () => {
    it("9.1 buckets candidates by viral score tier, saturation count, and signal source", () => {
      const candHigh = generateCandidateId();
      const candMid = generateCandidateId();
      const candMissing = generateCandidateId();

      logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        candidateId: candHigh,
        viralScore: 92,
        saturationCount: 0,
        signalSources: ["https://dexscreener.com/new-pairs"],
        status: "success",
      });

      logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        candidateId: candMid,
        viralScore: 78,
        saturationCount: 2,
        signalSources: ["https://pump.fun"],
        status: "failed",
      });

      logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        candidateId: candMissing,
        // no viral score, no saturation, no sources
        status: "pending",
      });

      const report = getHistoricalSignalPerformance();
      expect(report.summary.totalCandidatesEvaluated).toBeGreaterThanOrEqual(3);

      // Viral Score Tiers
      expect(report.byViralScoreTier["90-100"].candidateCount).toBeGreaterThanOrEqual(1);
      expect(report.byViralScoreTier["70-79"].candidateCount).toBeGreaterThanOrEqual(1);
      expect(report.byViralScoreTier["unrecorded"].candidateCount).toBeGreaterThanOrEqual(1);

      // Saturation Tiers
      expect(report.bySaturationCount["0"].candidateCount).toBeGreaterThanOrEqual(1);
      expect(report.bySaturationCount["2"].candidateCount).toBeGreaterThanOrEqual(1);
      expect(report.bySaturationCount["unrecorded"].candidateCount).toBeGreaterThanOrEqual(1);

      // Signal Sources
      expect(report.bySignalSource["https://dexscreener.com/new-pairs"]).toBeDefined();
      expect(report.bySignalSource["https://pump.fun"]).toBeDefined();
      expect(report.bySignalSource["unrecorded"]).toBeDefined();
    });
  });

  // ── 10. Financial Isolation Guardrail ───────────────────────

  describe("10. Financial Isolation Guardrail", () => {
    it("10.1 performance analytics functions do not pollute platform financial summary", () => {
      const beforeSummary = getPlatformPnlSummary();

      // Run queries
      getCandidatePerformanceHistory();
      getHistoricalSignalPerformance();

      const afterSummary = getPlatformPnlSummary();
      expect(afterSummary.totalRealizedPnl).toBe(beforeSummary.totalRealizedPnl);
      expect(afterSummary.totalRealizedProfit).toBe(beforeSummary.totalRealizedProfit);
      expect(afterSummary.totalRealizedLoss).toBe(beforeSummary.totalRealizedLoss);
    });
  });
});
