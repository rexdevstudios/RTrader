/**
 * tests/v240-signal-persistence.test.ts
 *
 * V2.4.0 — Intelligence Signal Persistence regression tests.
 *
 * Verifies:
 *  A. viralScore persisted and readable
 *  B. saturationCount persisted and readable
 *  C. signalSources (JSON round-trip) and signalScrapedAt persisted
 *  D. multi-chain consistency: same evaluation cycle -> same signal metadata on each deploy_log row
 *  E. backward compatibility: logDeploy without signal fields -> NULL in DB, no error
 *  F. no execution behavior change: logDeploy return value and existing fields unchanged
 *  G. owner report: signal metadata exposed via DeployLogRow; PnL aggregation does NOT use viralScore/saturationCount
 */
import { describe, it, expect } from "bun:test";
import {
  logDeploy,
  getAllDeployLogs,
  getDeployLogsByWallet,
} from "../src/db/vault.ts";
import {
  getPlatformPnlSummary,
} from "../src/modules/owner/owner-reporter.ts";

function testWalletId(): string {
  return `v240-wallet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function testTicker(): string {
  return `T${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const BASE_DEPLOY = {
  tokenName: "Signal Test Token",
  status: "pending" as const,
  lifecycleState: "DEPLOY_SUBMITTED",
};

describe("V2.4.0 — Intelligence Signal Persistence", () => {

  // ── A: viralScore persisted ────────────────────────────────

  describe("A. viralScore persistence", () => {
    it("A1. viralScore=85 round-trips via logDeploy -> getAllDeployLogs", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, walletId, viralScore: 85 });
      expect(id).toBeGreaterThan(0);
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.viralScore).toBe(85);
    });

    it("A2. viralScore=1 (minimum) persists correctly", () => {
      const ticker = testTicker();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker, viralScore: 1 });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.viralScore).toBe(1);
    });

    it("A3. viralScore=100 (maximum) persists correctly", () => {
      const ticker = testTicker();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, viralScore: 100 });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.viralScore).toBe(100);
    });
  });

  // ── B: saturationCount persisted ──────────────────────────

  describe("B. saturationCount persistence", () => {
    it("B1. saturationCount=0 persists correctly", () => {
      const ticker = testTicker();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, saturationCount: 0 });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.saturationCount).toBe(0);
    });

    it("B2. saturationCount=2 persists correctly", () => {
      const ticker = testTicker();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker, saturationCount: 2 });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.saturationCount).toBe(2);
    });

    it("B3. exact count value survives write/read round-trip", () => {
      const ticker = testTicker();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, saturationCount: 7 });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.saturationCount).toStrictEqual(7);
    });
  });

  // ── C: signalSources + signalScrapedAt persisted ──────────

  describe("C. signalSources and signalScrapedAt persistence", () => {
    it("C1. signalSources array round-trips through JSON serialization", () => {
      const ticker = testTicker();
      const sources = ["https://dexscreener.com/new-pairs", "https://pump.fun"];
      const scrapedAt = "2026-09-04T10:00:00.000Z";
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, signalSources: sources, signalScrapedAt: scrapedAt });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.signalSources).toEqual(sources);
      expect(row!.signalScrapedAt).toBe(scrapedAt);
    });

    it("C2. single-element signalSources round-trips correctly", () => {
      const ticker = testTicker();
      const sources = ["https://dexscreener.com/new-pairs"];
      const id = logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker, signalSources: sources });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(Array.isArray(row!.signalSources)).toBe(true);
      expect(row!.signalSources).toHaveLength(1);
      expect(row!.signalSources![0]).toBe("https://dexscreener.com/new-pairs");
    });

    it("C3. signalSources contains only public URLs, no credentials", () => {
      const ticker = testTicker();
      const sources = ["https://dexscreener.com/new-pairs", "https://pump.fun"];
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, signalSources: sources });
      const row = getAllDeployLogs().find((r) => r.id === id);
      for (const src of row!.signalSources ?? []) {
        expect(src).toMatch(/^https?:\/\//);
        expect(src).not.toMatch(/api.?key|apikey|secret|private.?key|bearer/i);
      }
    });

    it("C4. all four signal fields persist together in one logDeploy call", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const sources = ["https://dexscreener.com/new-pairs", "https://pump.fun"];
      const scrapedAt = "2026-09-04T12:30:00.000Z";
      const id = logDeploy({
        ...BASE_DEPLOY, chain: "base", ticker, walletId,
        viralScore: 77, saturationCount: 1, signalSources: sources, signalScrapedAt: scrapedAt,
      });
      const rows = getDeployLogsByWallet(walletId);
      const row = rows.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.viralScore).toBe(77);
      expect(row!.saturationCount).toBe(1);
      expect(row!.signalSources).toEqual(sources);
      expect(row!.signalScrapedAt).toBe(scrapedAt);
    });
  });

  // ── D: multi-chain consistency ─────────────────────────────

  describe("D. Multi-chain consistency", () => {
    it("D1. two chains from same evaluation cycle get identical signal metadata", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const viralScore = 92;
      const saturationCount = 0;
      const sources = ["https://dexscreener.com/new-pairs", "https://pump.fun"];
      const scrapedAt = "2026-09-04T08:00:00.000Z";

      const idBase = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, walletId, viralScore, saturationCount, signalSources: sources, signalScrapedAt: scrapedAt });
      const idSolana = logDeploy({ ...BASE_DEPLOY, chain: "solana", ticker, walletId, viralScore, saturationCount, signalSources: sources, signalScrapedAt: scrapedAt });

      const rows = getDeployLogsByWallet(walletId);
      const baseRow = rows.find((r) => r.id === idBase);
      const solanaRow = rows.find((r) => r.id === idSolana);

      expect(baseRow!.viralScore).toBe(viralScore);
      expect(solanaRow!.viralScore).toBe(viralScore);
      expect(baseRow!.saturationCount).toBe(saturationCount);
      expect(solanaRow!.saturationCount).toBe(saturationCount);
      expect(baseRow!.signalSources).toEqual(sources);
      expect(solanaRow!.signalSources).toEqual(sources);
      expect(baseRow!.signalScrapedAt).toBe(scrapedAt);
      expect(solanaRow!.signalScrapedAt).toBe(scrapedAt);
      // Distinct rows
      expect(baseRow!.chain).toBe("base");
      expect(solanaRow!.chain).toBe("solana");
    });

    it("D2. three chains from same cycle all carry the same viralScore", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const viralScore = 81;
      const chains = ["base", "solana", "robinhood"];
      const ids = chains.map((chain) => logDeploy({ ...BASE_DEPLOY, chain, ticker, walletId, viralScore }));
      const rows = getDeployLogsByWallet(walletId);
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        expect(row!.viralScore).toBe(viralScore);
      }
    });
  });

  // ── E: backward compatibility ──────────────────────────────

  describe("E. Backward compatibility", () => {
    it("E1. logDeploy without signal fields succeeds and returns a valid id", () => {
      const id = logDeploy({ chain: "base", tokenName: "Legacy Token", ticker: testTicker(), status: "pending" });
      expect(id).toBeGreaterThan(0);
    });

    it("E2. deploy without signal fields -> all four signal columns are NULL", () => {
      const walletId = testWalletId();
      const id = logDeploy({
        chain: "base", tokenName: "Legacy No Signal", ticker: testTicker(),
        walletId, status: "pending", lifecycleState: "DEPLOY_SUBMITTED",
      });
      const row = getDeployLogsByWallet(walletId).find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.viralScore).toBeNull();
      expect(row!.saturationCount).toBeNull();
      expect(row!.signalSources).toBeNull();
      expect(row!.signalScrapedAt).toBeNull();
    });

    it("E3. partially specified: only viralScore -> others remain NULL", () => {
      const walletId = testWalletId();
      const id = logDeploy({
        chain: "solana", tokenName: "Partial Signal", ticker: testTicker(),
        walletId, status: "pending", viralScore: 70,
      });
      const row = getDeployLogsByWallet(walletId).find((r) => r.id === id);
      expect(row!.viralScore).toBe(70);
      expect(row!.saturationCount).toBeNull();
      expect(row!.signalSources).toBeNull();
      expect(row!.signalScrapedAt).toBeNull();
    });

    it("E4. non-signal fields are unaffected by V2.4.0 changes", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const id = logDeploy({
        chain: "base", tokenName: "Field Integrity", ticker, walletId,
        status: "pending", lifecycleState: "DEPLOY_SUBMITTED",
        ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmTest",
        viralScore: 88, saturationCount: 1,
      });
      const row = getDeployLogsByWallet(walletId).find((r) => r.id === id);
      expect(row!.chain).toBe("base");
      expect(row!.tokenName).toBe("Field Integrity");
      expect(row!.ticker).toBe(ticker);
      expect(row!.walletId).toBe(walletId);
      expect(row!.status).toBe("pending");
      expect(row!.lifecycleState).toBe("DEPLOY_SUBMITTED");
      expect(row!.ipfsUrl).toBe("https://gateway.pinata.cloud/ipfs/QmTest");
      expect(row!.viralScore).toBe(88);
      expect(row!.saturationCount).toBe(1);
    });
  });

  // ── F: no execution behavior change ───────────────────────

  describe("F. No execution behavior change", () => {
    it("F1. logDeploy with signal metadata returns a numeric id", () => {
      const id = logDeploy({
        chain: "base", tokenName: "Behavior Check", ticker: testTicker(),
        status: "pending", viralScore: 90, saturationCount: 0,
        signalSources: ["https://dexscreener.com/new-pairs"],
        signalScrapedAt: new Date().toISOString(),
      });
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("F2. signal metadata does not alter status, lifecycle, or chain fields", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const id = logDeploy({
        chain: "solana", tokenName: "No Behavior Change", ticker, walletId,
        status: "failed", lifecycleState: "FAILED", errorMsg: "test failure",
        viralScore: 85, saturationCount: 2,
      });
      const row = getAllDeployLogs().find((r) => r.id === id);
      expect(row!.status).toBe("failed");
      expect(row!.lifecycleState).toBe("FAILED");
      expect(row!.errorMsg).toBe("test failure");
      expect(row!.chain).toBe("solana");
    });
  });

  // ── G: owner report — signal exposed, PnL not contaminated ─

  describe("G. Owner reporting — signal vs PnL isolation", () => {
    it("G1. DeployLogRow from getAllDeployLogs includes all four signal field keys", () => {
      const walletId = testWalletId();
      const id = logDeploy({
        ...BASE_DEPLOY, chain: "base", ticker: testTicker(), walletId,
        viralScore: 79, saturationCount: 1,
        signalSources: ["https://dexscreener.com/new-pairs"],
        signalScrapedAt: "2026-09-04T09:00:00.000Z",
      });
      const row = getAllDeployLogs().find((r) => r.id === id)!;
      expect("viralScore" in row).toBe(true);
      expect("saturationCount" in row).toBe(true);
      expect("signalSources" in row).toBe(true);
      expect("signalScrapedAt" in row).toBe(true);
      expect(row.viralScore).toBe(79);
      expect(row.saturationCount).toBe(1);
    });

    it("G2. getPlatformPnlSummary does NOT expose viralScore or saturationCount fields", () => {
      logDeploy({
        ...BASE_DEPLOY, chain: "base", ticker: testTicker(),
        status: "success", lifecycleState: "DEPLOY_CONFIRMED",
        viralScore: 99, saturationCount: 50,
      });
      const summary = getPlatformPnlSummary();
      expect("viralScore" in summary).toBe(false);
      expect("saturationCount" in summary).toBe(false);
      expect("signalSources" in summary).toBe(false);
      expect(typeof summary.totalRealizedPnl).toBe("number");
      expect(typeof summary.totalRealizedProfit).toBe("number");
      expect(typeof summary.totalRealizedLoss).toBe("number");
    });

    it("G3. signal fields do NOT appear on DeployLogRow as financial metrics", () => {
      const ticker = testTicker();
      const id = logDeploy({ ...BASE_DEPLOY, chain: "base", ticker, viralScore: 95, saturationCount: 0 });
      const row = getAllDeployLogs().find((r) => r.id === id)!;
      expect("realizedPnl" in row).toBe(false);
      expect("priceReturnPercent" in row).toBe(false);
      expect(row.viralScore).toBe(95);
    });

    it("G4. deploy log with signal metadata readable via getDeployLogsByWallet", () => {
      const ticker = testTicker();
      const walletId = testWalletId();
      const viralScore = 83;
      const sources = ["https://pump.fun"];
      const scrapedAt = "2026-09-04T07:00:00.000Z";
      logDeploy({
        ...BASE_DEPLOY, chain: "base", ticker, walletId,
        status: "success", lifecycleState: "DEPLOY_CONFIRMED",
        viralScore, saturationCount: 0, signalSources: sources, signalScrapedAt: scrapedAt,
      });
      const deployRow = getDeployLogsByWallet(walletId).find((r) => r.ticker === ticker);
      expect(deployRow).toBeDefined();
      expect(deployRow!.viralScore).toBe(viralScore);
      expect(deployRow!.signalSources).toEqual(sources);
      expect(deployRow!.signalScrapedAt).toBe(scrapedAt);
    });
  });
});
