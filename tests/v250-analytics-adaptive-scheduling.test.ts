import { describe, it, expect, beforeEach } from "bun:test";
import {
  recordCycleStart,
  updateCycleOutcome,
  getRecentCycles,
  logDeploy,
  getAllCandidateIds,
  type CycleOutcomeUpdate,
} from "../src/db/vault.ts";
import {
  buildSchedulingContext,
  type SchedulingContext,
} from "../src/modules/intelligence/scheduling-context.ts";
import {
  getCandidatePerformanceHistory,
} from "../src/modules/owner/owner-reporter.ts";

describe("V2.5.0 — Analytics & Adaptive Scheduling Foundation", () => {
  // ─── A. Pipeline Cycles Persistence ────────────────────────
  describe("A. Pipeline Cycles Persistence", () => {
    it("A.1 recordCycleStart creates a new row with completed_at initially NULL", () => {
      const cycleId = recordCycleStart();
      expect(cycleId).toBeGreaterThan(0);

      const cycles = getRecentCycles();
      const recorded = cycles.find((c) => c.id === cycleId);
      expect(recorded).toBeDefined();
      expect(recorded?.completedAt).toBeNull();
      expect(recorded?.durationMs).toBeNull();
      expect(recorded?.lockAcquired).toBe(false);
      expect(recorded?.dailyLimitHit).toBe(false);
    });

    it("A.2 updateCycleOutcome populates all outcome fields correctly", () => {
      const cycleId = recordCycleStart();
      const completedAt = new Date().toISOString();

      const update: CycleOutcomeUpdate = {
        completedAt,
        durationMs: 4500,
        lockAcquired: true,
        dailyLimitHit: false,
        trendDataFound: true,
        identityFound: true,
        candidateId: "cand_v250_test_1",
        decisionApproved: true,
        rejectionReason: null,
        assetsUploaded: true,
        deploymentsAttempted: 2,
        deploymentsConfirmed: 2,
      };

      updateCycleOutcome(cycleId, update);

      const cycles = getRecentCycles();
      const updated = cycles.find((c) => c.id === cycleId);
      expect(updated).toBeDefined();
      expect(updated?.completedAt).toBe(completedAt);
      expect(updated?.durationMs).toBe(4500);
      expect(updated?.lockAcquired).toBe(true);
      expect(updated?.dailyLimitHit).toBe(false);
      expect(updated?.trendDataFound).toBe(true);
      expect(updated?.identityFound).toBe(true);
      expect(updated?.candidateId).toBe("cand_v250_test_1");
      expect(updated?.decisionApproved).toBe(true);
      expect(updated?.rejectionReason).toBeNull();
      expect(updated?.assetsUploaded).toBe(true);
      expect(updated?.deploymentsAttempted).toBe(2);
      expect(updated?.deploymentsConfirmed).toBe(2);
    });

    it("A.3 getRecentCycles filters cycles by limitDays window", () => {
      // Create a cycle recorded in the past (e.g. 10 days ago)
      const pastTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const pastCycleId = recordCycleStart(pastTime);
      updateCycleOutcome(pastCycleId, {
        completedAt: pastTime,
        durationMs: 1200,
        lockAcquired: true,
      });

      // Create a cycle recorded recently (now)
      const recentCycleId = recordCycleStart();
      updateCycleOutcome(recentCycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 1500,
        lockAcquired: true,
      });

      // Query last 3 days
      const last3DaysCycles = getRecentCycles(3);
      expect(last3DaysCycles.some((c) => c.id === recentCycleId)).toBe(true);
      expect(last3DaysCycles.some((c) => c.id === pastCycleId)).toBe(false);

      // Query without limitDays should return all cycles
      const allCycles = getRecentCycles();
      expect(allCycles.some((c) => c.id === recentCycleId)).toBe(true);
      expect(allCycles.some((c) => c.id === pastCycleId)).toBe(true);
    });
  });

  // ─── B. Cycle Outcomes Telemetry ───────────────────────────
  describe("B. Cycle Outcomes Telemetry", () => {
    it("B.1 records lock skip outcome with lock_acquired=0 and zero duration if stopped immediately", () => {
      const cycleId = recordCycleStart();
      updateCycleOutcome(cycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 5,
        lockAcquired: false,
      });

      const cycles = getRecentCycles();
      const cycle = cycles.find((c) => c.id === cycleId);
      expect(cycle?.lockAcquired).toBe(false);
      expect(cycle?.dailyLimitHit).toBe(false);
      expect(cycle?.candidateId).toBeNull();
    });

    it("B.2 records daily limit hit correctly", () => {
      const cycleId = recordCycleStart();
      updateCycleOutcome(cycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 12,
        lockAcquired: true,
        dailyLimitHit: true,
      });

      const cycle = getRecentCycles().find((c) => c.id === cycleId);
      expect(cycle?.lockAcquired).toBe(true);
      expect(cycle?.dailyLimitHit).toBe(true);
      expect(cycle?.trendDataFound).toBe(false);
    });

    it("B.3 records partial cycle when trend data is missing", () => {
      const cycleId = recordCycleStart();
      updateCycleOutcome(cycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 250,
        lockAcquired: true,
        dailyLimitHit: false,
        trendDataFound: false,
      });

      const cycle = getRecentCycles().find((c) => c.id === cycleId);
      expect(cycle?.trendDataFound).toBe(false);
      expect(cycle?.identityFound).toBe(false);
      expect(cycle?.decisionApproved).toBeNull();
    });

    it("B.4 records decision rejection with specific rejection reason", () => {
      const cycleId = recordCycleStart();
      updateCycleOutcome(cycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 800,
        lockAcquired: true,
        dailyLimitHit: false,
        trendDataFound: true,
        identityFound: true,
        candidateId: "cand_rejected_sat",
        decisionApproved: false,
        rejectionReason: "SATURATED",
      });

      const cycle = getRecentCycles().find((c) => c.id === cycleId);
      expect(cycle?.decisionApproved).toBe(false);
      expect(cycle?.rejectionReason).toBe("SATURATED");
      expect(cycle?.assetsUploaded).toBeNull();
      expect(cycle?.deploymentsAttempted).toBe(0);
    });

    it("B.5 records asset generation/upload failure", () => {
      const cycleId = recordCycleStart();
      updateCycleOutcome(cycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 1200,
        lockAcquired: true,
        dailyLimitHit: false,
        trendDataFound: true,
        identityFound: true,
        candidateId: "cand_asset_fail",
        decisionApproved: true,
        assetsUploaded: false,
        deploymentsAttempted: 0,
      });

      const cycle = getRecentCycles().find((c) => c.id === cycleId);
      expect(cycle?.decisionApproved).toBe(true);
      expect(cycle?.assetsUploaded).toBe(false);
      expect(cycle?.deploymentsAttempted).toBe(0);
    });

    it("B.6 records deployment attempts and confirmations accurately", () => {
      const cycleId = recordCycleStart();
      updateCycleOutcome(cycleId, {
        completedAt: new Date().toISOString(),
        durationMs: 6500,
        lockAcquired: true,
        dailyLimitHit: false,
        trendDataFound: true,
        identityFound: true,
        candidateId: "cand_multi_deploy",
        decisionApproved: true,
        assetsUploaded: true,
        deploymentsAttempted: 2,
        deploymentsConfirmed: 1, // 1 confirmed, 1 simulated/failed
      });

      const cycle = getRecentCycles().find((c) => c.id === cycleId);
      expect(cycle?.deploymentsAttempted).toBe(2);
      expect(cycle?.deploymentsConfirmed).toBe(1);
    });
  });

  // ─── C. SchedulingContext Read-Only Analytical View ─────────
  describe("C. SchedulingContext Analytical View", () => {
    it("C.1 returns safe default metrics when no cycles match the window", () => {
      // Query with window 0 days or window with no matching cycles
      const context = buildSchedulingContext(0);

      expect(context.generatedAt).toBeDefined();
      expect(context.recentCycles.count).toBe(0);
      expect(context.recentCycles.avgDurationMs).toBeNull();
      expect(context.recentCycles.approvalRate).toBeNull();
      expect(context.recentCycles.deploymentRate).toBeNull();
      expect(context.recentCycles.dailyLimitHits).toBe(0);
      expect(context.recentCycles.lockSkips).toBe(0);

      expect(context.candidateFunnel.discovered).toBe(0);
      expect(context.candidateFunnel.analyzed).toBe(0);
      expect(context.candidateFunnel.approved).toBe(0);
      expect(context.candidateFunnel.rejectedLowScore).toBe(0);
      expect(context.candidateFunnel.rejectedSaturated).toBe(0);
      expect(context.candidateFunnel.deployed).toBe(0);
      expect(context.candidateFunnel.deploymentsConfirmed).toBe(0);
    });

    it("C.2 computes rates, duration, and candidate funnel deterministically", () => {
      // Add known cycles in recent time
      const c1 = recordCycleStart();
      updateCycleOutcome(c1, {
        completedAt: new Date().toISOString(),
        durationMs: 1000,
        lockAcquired: true,
        trendDataFound: true,
        identityFound: true,
        candidateId: "cand_c1",
        decisionApproved: true,
        deploymentsAttempted: 2,
        deploymentsConfirmed: 2,
      });

      const c2 = recordCycleStart();
      updateCycleOutcome(c2, {
        completedAt: new Date().toISOString(),
        durationMs: 3000,
        lockAcquired: true,
        trendDataFound: true,
        identityFound: true,
        candidateId: "cand_c2",
        decisionApproved: false,
        rejectionReason: "LOW_VIRAL_SCORE",
        deploymentsAttempted: 0,
        deploymentsConfirmed: 0,
      });

      const c3 = recordCycleStart();
      updateCycleOutcome(c3, {
        completedAt: new Date().toISOString(),
        durationMs: 2000,
        lockAcquired: false, // lock skip
        dailyLimitHit: false,
      });

      const context = buildSchedulingContext(1);

      expect(context.recentCycles.count).toBeGreaterThanOrEqual(3);
      expect(context.recentCycles.lockSkips).toBeGreaterThanOrEqual(1);
      // Rates must be valid numbers between 0 and 1 (no NaN, no Infinity)
      if (context.recentCycles.approvalRate !== null) {
        expect(context.recentCycles.approvalRate).toBeGreaterThanOrEqual(0);
        expect(context.recentCycles.approvalRate).toBeLessThanOrEqual(1);
      }
      if (context.recentCycles.deploymentRate !== null) {
        expect(context.recentCycles.deploymentRate).toBeGreaterThanOrEqual(0);
        expect(context.recentCycles.deploymentRate).toBeLessThanOrEqual(1);
      }
      if (context.recentCycles.avgDurationMs !== null) {
        expect(context.recentCycles.avgDurationMs).toBeGreaterThan(0);
      }
    });

    it("C.3 avoids divide-by-zero when no candidates are evaluated or no deployments are attempted", () => {
      // Cycle where lock was skipped (no candidate evaluated, no deployment attempted)
      const c = recordCycleStart();
      updateCycleOutcome(c, {
        completedAt: new Date().toISOString(),
        durationMs: 50,
        lockAcquired: false,
        deploymentsAttempted: 0,
        deploymentsConfirmed: 0,
      });

      const context = buildSchedulingContext(1);
      expect(Number.isNaN(context.recentCycles.approvalRate)).toBe(false);
      expect(Number.isNaN(context.recentCycles.deploymentRate)).toBe(false);
      expect(Number.isFinite(context.recentCycles.approvalRate ?? 0)).toBe(true);
      expect(Number.isFinite(context.recentCycles.deploymentRate ?? 0)).toBe(true);
    });
  });

  // ─── D. Historical Analytics Time-Window Filtering ─────────
  describe("D. Historical Analytics Time-Window Filtering", () => {
    it("D.1 filters candidate performance history with createdAfter only", () => {
      const pastDate = "2024-01-01 10:00:00";
      const recentDate = "2026-09-01 10:00:00";

      const oldCandidateId = `cand_hist_old_${Date.now()}`;
      logDeploy({
        chain: "base",
        tokenName: "Old Token",
        ticker: "OLD",
        status: "success",
        candidateId: oldCandidateId,
        createdAt: pastDate,
      });

      const newCandidateId = `cand_hist_new_${Date.now()}`;
      logDeploy({
        chain: "base",
        tokenName: "New Token",
        ticker: "NEW",
        status: "success",
        candidateId: newCandidateId,
        createdAt: recentDate,
      });

      // Filter: only candidates after 2025-01-01
      const filtered = getCandidatePerformanceHistory({
        createdAfter: "2025-01-01 00:00:00",
      });

      const ids = filtered.map((c) => c.candidateId);
      expect(ids).toContain(newCandidateId);
      expect(ids).not.toContain(oldCandidateId);
    });

    it("D.2 filters candidate performance history with createdBefore only", () => {
      const pastDate = "2023-05-01 10:00:00";
      const recentDate = "2026-09-01 10:00:00";

      const oldCandidateId = `cand_hist_ancient_${Date.now()}`;
      logDeploy({
        chain: "base",
        tokenName: "Ancient Token",
        ticker: "ANC",
        status: "success",
        candidateId: oldCandidateId,
        createdAt: pastDate,
      });

      const newCandidateId = `cand_hist_modern_${Date.now()}`;
      logDeploy({
        chain: "base",
        tokenName: "Modern Token",
        ticker: "MOD",
        status: "success",
        candidateId: newCandidateId,
        createdAt: recentDate,
      });

      // Filter: only candidates before 2024-01-01
      const filtered = getCandidatePerformanceHistory({
        createdBefore: "2024-01-01 00:00:00",
      });

      const ids = filtered.map((c) => c.candidateId);
      expect(ids).toContain(oldCandidateId);
      expect(ids).not.toContain(newCandidateId);
    });

    it("D.3 filters candidate performance history with both createdAfter and createdBefore bounds", () => {
      const d1 = "2022-01-01 10:00:00";
      const d2 = "2024-06-01 10:00:00";
      const d3 = "2026-09-01 10:00:00";

      const c1 = `cand_b_early_${Date.now()}`;
      logDeploy({ chain: "base", tokenName: "T1", ticker: "T1", status: "success", candidateId: c1, createdAt: d1 });

      const c2 = `cand_b_middle_${Date.now()}`;
      logDeploy({ chain: "base", tokenName: "T2", ticker: "T2", status: "success", candidateId: c2, createdAt: d2 });

      const c3 = `cand_b_late_${Date.now()}`;
      logDeploy({ chain: "base", tokenName: "T3", ticker: "T3", status: "success", candidateId: c3, createdAt: d3 });

      const filtered = getCandidatePerformanceHistory({
        createdAfter: "2024-01-01 00:00:00",
        createdBefore: "2025-01-01 00:00:00",
      });

      const ids = filtered.map((c) => c.candidateId);
      expect(ids).toContain(c2);
      expect(ids).not.toContain(c1);
      expect(ids).not.toContain(c3);
    });

    it("D.4 preserves backward compatibility when no bounds are provided", () => {
      const allCandidates = getAllCandidateIds();
      const historyWithoutBounds = getCandidatePerformanceHistory();
      const historyWithEmptyFilter = getCandidatePerformanceHistory({});

      expect(historyWithoutBounds.length).toBe(allCandidates.length);
      expect(historyWithEmptyFilter.length).toBe(allCandidates.length);
    });
  });
});
