/**
 * tests/v241-candidate-identity.test.ts
 *
 * V2.4.1 — Candidate Identity & Multi-Chain Lineage Regression Tests.
 *
 * Verifies:
 *  1. Candidate ID format & uniqueness (generateCandidateId)
 *  2. Candidate ID persistence & queryability (logDeploy, getAllDeployLogs, getDeployLogsByCandidate)
 *  3. Multi-chain consistency: one candidate evaluated once -> deployed to multiple chains with identical candidateId
 *  4. Candidate identity represents discovery cycle, not just ticker: same ticker in 2 cycles has 2 distinct candidate IDs
 *  5. Pre-deployment failure lineage: asset/IPFS failure retains candidate lineage
 *  6. Backward compatibility: deploy without candidateId stores NULL; existing rows remain valid
 *  7. Position history filtering by candidateId via owner-reporter
 *  8. Financial isolation: candidateId is purely an intelligence/discovery identity, NOT a financial metric
 */
import { describe, it, expect } from "bun:test";
import {
  logDeploy,
  getAllDeployLogs,
  getDeployLogsByWallet,
  getDeployLogsByCandidate,
  generateCandidateId,
  createPendingPosition,
  type DeployLog,
} from "../src/db/vault.ts";
import {
  getPositionHistory,
  getPlatformPnlSummary,
  type PositionHistoryEntry,
} from "../src/modules/owner/owner-reporter.ts";

function testWalletId(): string {
  return `v241-wallet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function testTicker(): string {
  return `C${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const BASE_DEPLOY = {
  tokenName: "Candidate Test Token",
  status: "pending" as const,
  lifecycleState: "DEPLOY_SUBMITTED",
};

describe("V2.4.1 — Candidate Identity & Multi-Chain Lineage", () => {

  // ── 1. Candidate ID Generation ─────────────────────────────

  describe("1. Candidate ID Generation", () => {
    it("1.1 generateCandidateId generates a string prefixed with cand_ and includes timestamp", () => {
      const id = generateCandidateId();
      expect(typeof id).toBe("string");
      expect(id.startsWith("cand_")).toBe(true);
      const parts = id.split("_");
      expect(parts.length).toBe(3);
      const timestamp = Number(parts[1]);
      expect(Number.isFinite(timestamp)).toBe(true);
      expect(timestamp).toBeGreaterThan(1700000000000); // realistic ms timestamp
    });

    it("1.2 successive calls to generateCandidateId produce distinct identifiers", () => {
      const id1 = generateCandidateId();
      const id2 = generateCandidateId();
      expect(id1).not.toBe(id2);
    });
  });

  // ── 2. Persistence & Direct Queries ────────────────────────

  describe("2. Persistence & Queryability", () => {
    it("2.1 logDeploy persists candidateId and getAllDeployLogs returns it", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const id = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker,
        candidateId,
      });

      const logs = getAllDeployLogs();
      const row = logs.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.candidateId).toBe(candidateId);
    });

    it("2.2 getDeployLogsByCandidate filters exactly by candidateId", () => {
      const candidateId = generateCandidateId();
      const otherCandidateId = generateCandidateId();
      const ticker = testTicker();

      const id1 = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, candidateId });
      const id2 = logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker, candidateId });
      const idOther = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker: testTicker(), candidateId: otherCandidateId });

      const candidateLogs = getDeployLogsByCandidate(candidateId);
      const ids = candidateLogs.map((r) => r.id);

      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).not.toContain(idOther);
      expect(candidateLogs.every((r) => r.candidateId === candidateId)).toBe(true);
    });

    it("2.3 getDeployLogsByWallet preserves candidateId in returned rows", () => {
      const walletId = testWalletId();
      const candidateId = generateCandidateId();
      const id = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        walletId,
        candidateId,
      });

      const walletLogs = getDeployLogsByWallet(walletId);
      const row = walletLogs.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.candidateId).toBe(candidateId);
    });
  });

  // ── 3. Multi-Chain Consistency ─────────────────────────────

  describe("3. Multi-Chain Lineage Consistency", () => {
    it("3.1 multiple chain deployments from the same candidate share the exact same candidateId", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletId = testWalletId();
      const chains = ["base", "solana", "robinhood"];

      const logIds = chains.map((chain) =>
        logDeploy({
          ...BASE_DEPLOY,
          chain,
          ticker,
          walletId,
          candidateId,
          viralScore: 88,
          saturationCount: 0,
        })
      );

      const logs = getDeployLogsByCandidate(candidateId);
      expect(logs).toHaveLength(3);

      const retrievedChains = logs.map((r) => r.chain).sort();
      expect(retrievedChains).toEqual(["base", "robinhood", "solana"]);

      for (const log of logs) {
        expect(log.candidateId).toBe(candidateId);
        expect(log.ticker).toBe(ticker);
        expect(log.viralScore).toBe(88);
      }
    });

    it("3.2 candidate reference is independent of wallet identity", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();
      const walletA = testWalletId();
      const walletB = testWalletId();

      // Candidate deployed to Base with wallet A, and Solana with wallet B
      const idBase = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, walletId: walletA, candidateId });
      const idSol = logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker, walletId: walletB, candidateId });

      const logs = getDeployLogsByCandidate(candidateId);
      expect(logs).toHaveLength(2);

      const baseLog = logs.find((r) => r.id === idBase);
      const solLog = logs.find((r) => r.id === idSol);

      expect(baseLog!.walletId).toBe(walletA);
      expect(solLog!.walletId).toBe(walletB);
      expect(baseLog!.candidateId).toBe(candidateId);
      expect(solLog!.candidateId).toBe(candidateId);
    });
  });

  // ── 4. Cycle Identity vs Ticker Identity ───────────────────

  describe("4. Candidate Identity is Per-Cycle, Not Global Ticker", () => {
    it("4.1 two discovery cycles producing the same ticker receive different candidate IDs", () => {
      const sharedTicker = "PEPEAI";
      const candidateCycle1 = generateCandidateId();
      const candidateCycle2 = generateCandidateId();

      expect(candidateCycle1).not.toBe(candidateCycle2);

      const id1 = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker: sharedTicker, candidateId: candidateCycle1, viralScore: 75 });
      const id2 = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker: sharedTicker, candidateId: candidateCycle2, viralScore: 92 });

      const cycle1Logs = getDeployLogsByCandidate(candidateCycle1);
      const cycle2Logs = getDeployLogsByCandidate(candidateCycle2);

      expect(cycle1Logs).toHaveLength(1);
      expect(cycle1Logs[0].id).toBe(id1);
      expect(cycle1Logs[0].viralScore).toBe(75);

      expect(cycle2Logs).toHaveLength(1);
      expect(cycle2Logs[0].id).toBe(id2);
      expect(cycle2Logs[0].viralScore).toBe(92);
    });
  });

  // ── 5. Pre-Deployment Failure Lineage ──────────────────────

  describe("5. Pre-Deployment Failure Lineage", () => {
    it("5.1 pre-deployment failure (e.g. IPFS upload error) records and preserves candidate lineage", () => {
      const candidateId = generateCandidateId();
      const ticker = testTicker();

      const failLogId = logDeploy({
        chain: "all",
        tokenName: "Asset Fail Token",
        ticker,
        status: "failed",
        errorMsg: "IPFS upload gagal",
        lifecycleState: "FAILED",
        candidateId,
        viralScore: 84,
        saturationCount: 1,
      });

      const candidateLogs = getDeployLogsByCandidate(candidateId);
      expect(candidateLogs).toHaveLength(1);
      expect(candidateLogs[0].id).toBe(failLogId);
      expect(candidateLogs[0].status).toBe("failed");
      expect(candidateLogs[0].lifecycleState).toBe("FAILED");
      expect(candidateLogs[0].errorMsg).toBe("IPFS upload gagal");
      expect(candidateLogs[0].candidateId).toBe(candidateId);
    });
  });

  // ── 6. Backward Compatibility ──────────────────────────────

  describe("6. Backward Compatibility", () => {
    it("6.1 logDeploy without candidateId succeeds and stores candidateId as null", () => {
      const ticker = testTicker();
      const id = logDeploy({
        chain: "base",
        tokenName: "Legacy No Candidate Token",
        ticker,
        status: "pending",
      });

      expect(id).toBeGreaterThan(0);
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.candidateId).toBeNull();
    });

    it("6.2 existing query functions continue returning rows with candidateId: null", () => {
      const walletId = testWalletId();
      const id = logDeploy({
        chain: "base",
        tokenName: "Legacy Wallet Token",
        ticker: testTicker(),
        walletId,
        status: "pending",
      });

      const walletLogs = getDeployLogsByWallet(walletId);
      const row = walletLogs.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.candidateId).toBeNull();
    });
  });

  // ── 7. Position History Filtering ──────────────────────────

  describe("7. Position History Filtering by candidateId", () => {
    it("7.1 getPositionHistory filters positions by candidateId via deployment link", () => {
      const candidateTarget = generateCandidateId();
      const candidateOther = generateCandidateId();
      const walletId = testWalletId();

      // Deploy candidateTarget on base
      const deployTargetId = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        walletId,
        candidateId: candidateTarget,
      });

      // Deploy candidateOther on base
      const deployOtherId = logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        walletId,
        candidateId: candidateOther,
      });

      const contractTarget = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;
      const contractOther = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

      createPendingPosition({
        deployLogId: deployTargetId,
        chain: "base",
        contractAddr: contractTarget,
        ticker: "TGT",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId,
      });

      createPendingPosition({
        deployLogId: deployOtherId,
        chain: "base",
        contractAddr: contractOther,
        ticker: "OTH",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId,
      });

      // Query position history filtered by candidateTarget
      const filtered = getPositionHistory({ candidateId: candidateTarget });
      expect(filtered.length).toBeGreaterThanOrEqual(1);

      const targetEntry = filtered.find((e: PositionHistoryEntry) => e.position.contractAddr === contractTarget);
      expect(targetEntry).toBeDefined();
      expect(targetEntry!.deployment).toBeDefined();
      expect(targetEntry!.deployment!.candidateId).toBe(candidateTarget);

      // Other candidate must not be in filtered results
      const otherEntry = filtered.find((e: PositionHistoryEntry) => e.position.contractAddr === contractOther);
      expect(otherEntry).toBeUndefined();
    });
  });

  // ── 8. Financial Isolation Guardrail ────────────────────────

  describe("8. Financial & Accounting Isolation", () => {
    it("8.1 candidateId does not contaminate financial reporting or PnL summaries", () => {
      const candidateId = generateCandidateId();
      logDeploy({
        ...BASE_DEPLOY,
        chain: "base",
        ticker: testTicker(),
        candidateId,
        status: "success",
        lifecycleState: "DEPLOY_CONFIRMED",
      });

      const summary = getPlatformPnlSummary();
      // Candidate ID must never appear in financial aggregates
      expect("candidateId" in summary).toBe(false);
      expect(typeof summary.totalRealizedPnl).toBe("number");
      expect(typeof summary.totalRealizedProfit).toBe("number");
      expect(typeof summary.totalRealizedLoss).toBe("number");
    });
  });
});
