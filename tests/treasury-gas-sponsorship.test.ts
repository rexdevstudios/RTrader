import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import {
  recordGasSponsorshipToLedger,
  getTreasurySummaryByWallet,
} from "../src/modules/treasury/treasury-ledger.ts";
import {
  getTotalGasSponsorshipSavings,
  DB_PATH,
} from "../src/db/vault.ts";
import {
  exportFleetMatrix,
  escapeCsv,
} from "../scripts/view-fleet-matrix.ts";

const db = new Database(DB_PATH);

describe("Gas Sponsorship Accounting & Telemetry Export (Phase 5 P1 & P2)", () => {
  const TEST_WALLET_1 = "test_wallet_sponsor_1";
  const TEST_WALLET_2 = "test_wallet_sponsor_2";
  const TEST_DEPLOY_ID_1 = 999901;
  const TEST_DEPLOY_ID_2 = 999902;

  beforeEach(() => {
    db.run("DELETE FROM treasury_ledger WHERE entry_id LIKE 'tr_sponsor_deploy_9999%'");
  });

  afterAll(() => {
    db.run("DELETE FROM treasury_ledger WHERE entry_id LIKE 'tr_sponsor_deploy_9999%'");
  });

  it("1. should post a verified gas sponsorship credit entry to the treasury ledger", () => {
    const entry = recordGasSponsorshipToLedger({
      deployLogId: TEST_DEPLOY_ID_1,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: 0.000452,
      relayerAddress: "0xb794f5ea0ba39494ce839613fffba74279579268",
      txHash: "0x" + "a".repeat(64),
      walletId: TEST_WALLET_1,
    });

    expect(entry).toBeDefined();
    expect(entry.entryId).toBe(`tr_sponsor_deploy_${TEST_DEPLOY_ID_1}`);
    expect(entry.eventType).toBe("gas_sponsorship");
    expect(entry.direction).toBe("credit");
    expect(entry.amountFormatted).toBeCloseTo(0.000452, 6);
    expect(entry.tokenSymbol).toBe("ETH");
    expect(entry.walletId).toBe(TEST_WALLET_1);
    expect(entry.status).toBe("confirmed");
  });

  it("2. should calculate total gas sponsorship savings platform-wide and per-wallet", () => {
    recordGasSponsorshipToLedger({
      deployLogId: TEST_DEPLOY_ID_1,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: 0.0005,
      relayerAddress: "0xb794f5ea0ba39494ce839613fffba74279579268",
      txHash: "0x" + "1".repeat(64),
      walletId: TEST_WALLET_1,
    });

    recordGasSponsorshipToLedger({
      deployLogId: TEST_DEPLOY_ID_2,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: 0.0003,
      relayerAddress: "0xb794f5ea0ba39494ce839613fffba74279579268",
      txHash: "0x" + "2".repeat(64),
      walletId: TEST_WALLET_2,
    });

    const totalWallet1 = getTotalGasSponsorshipSavings(TEST_WALLET_1);
    const totalWallet2 = getTotalGasSponsorshipSavings(TEST_WALLET_2);
    const totalAll = getTotalGasSponsorshipSavings();

    expect(totalWallet1).toBeCloseTo(0.0005, 4);
    expect(totalWallet2).toBeCloseTo(0.0003, 4);
    expect(totalAll).toBeCloseTo(0.0008, 4);
  });

  it("3. should track gas savings in treasury summary without inflating net treasury balance", () => {
    recordGasSponsorshipToLedger({
      deployLogId: TEST_DEPLOY_ID_1,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: 0.0015,
      relayerAddress: "0xb794f5ea0ba39494ce839613fffba74279579268",
      txHash: "0x" + "3".repeat(64),
      walletId: TEST_WALLET_1,
    });

    const summary = getTreasurySummaryByWallet(TEST_WALLET_1);
    expect(summary.totalGasSponsorshipSavingsFormatted).toBeCloseTo(0.0015, 4);
    // Net treasury balance must remain 0 since gas savings are not withdrawable cash
    expect(summary.netTreasuryBalanceFormatted).toBe(0);
    expect(summary.totalFeesClaimedFormatted).toBe(0);
  });

  it("4. should enforce idempotency on repeated gas sponsorship insertions", () => {
    const params = {
      deployLogId: TEST_DEPLOY_ID_1,
      chain: "base",
      tokenSymbol: "ETH",
      networkGasCostEth: 0.00045,
      relayerAddress: "0xb794f5ea0ba39494ce839613fffba74279579268",
      txHash: "0x" + "4".repeat(64),
      walletId: TEST_WALLET_1,
    };

    const first = recordGasSponsorshipToLedger(params);
    const second = recordGasSponsorshipToLedger(params);

    expect(first.entryId).toBe(second.entryId);

    const rows = db.query("SELECT COUNT(*) as c FROM treasury_ledger WHERE entry_id = ?").get(`tr_sponsor_deploy_${TEST_DEPLOY_ID_1}`) as { c: number };
    expect(rows.c).toBe(1);
  });

  it("5. escapeCsv should properly escape strings containing commas, quotes, and newlines", () => {
    expect(escapeCsv("simple")).toBe("simple");
    expect(escapeCsv("hello,world")).toBe('"hello,world"');
    expect(escapeCsv('quote"test')).toBe('"quote""test"');
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });

  it("6. should export fleet matrix to CSV and JSON files in custom directory", async () => {
    const tmpDir = path.join(process.cwd(), ".eliza", "test_exports");
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const result = await exportFleetMatrix({
        format: "all",
        customDir: tmpDir,
        filenamePrefix: "test_matrix",
      });

      expect(result.count).toBeGreaterThan(0);
      expect(result.csvPath).toBeDefined();
      expect(result.jsonPath).toBeDefined();
      expect(fs.existsSync(result.csvPath!)).toBe(true);
      expect(fs.existsSync(result.jsonPath!)).toBe(true);

      // Verify CSV contents
      const csvContent = fs.readFileSync(result.csvPath!, "utf8");
      const lines = csvContent.trim().split("\n");
      expect(lines.length).toBe(result.count + 1); // Header + items
      expect(lines[0]).toContain("contractAddr");
      expect(lines[0]).toContain("ticker");

      // Verify JSON contents
      const jsonContent = JSON.parse(fs.readFileSync(result.jsonPath!, "utf8"));
      expect(jsonContent.totalFleet).toBe(result.count);
      expect(Array.isArray(jsonContent.fleet)).toBe(true);
      expect(jsonContent.fleet[0].ticker).toBeDefined();
    } finally {
      // Clean up tmpDir
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
});
