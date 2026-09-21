/**
 * tests/post-deploy-pipeline.test.ts
 *
 * Automated Regression Suite for Post-Deployment Pipeline:
 *  1. Database Vault Website URL Persistence & Idempotent Schema Migration
 *  2. Website Generator Automatic Vault Persistence Sync & liveUrl Result
 *  3. DexScreener Profile & Boost Activation Monitoring Card Formatter
 *
 * Adheres strictly to Rule 4 of AGENTS.md:
 * Isolated test database environment (NODE_ENV=test).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";

// Enforce test database isolation before importing vault
process.env.NODE_ENV = "test";
process.env.VAULT_DB_PATH = path.join(process.cwd(), ".eliza", "test_vault_pipeline.db");

import {
  logDeploy,
  updateDeployLogWebsite,
  getDeployLogWebsite,
  getDeployLogByContract,
  getAllDeployLogs,
  type DeployLog,
} from "../src/db/vault.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import {
  formatDexScreenerActivationCard,
  type DexScreenerStatusSummary,
} from "../src/modules/intelligence/dexscreener-monitor.ts";
import type { CaIntelligenceReport } from "../src/modules/intelligence/ca-intelligence.ts";

describe("Post-Deployment Pipeline & Growth Bridge Suite", () => {
  const testCa = "0x9876543210987654321098765432109876543210";
  const testTicker = "TESTBRIDGE";
  const testOutputDir = path.join(process.cwd(), "sites", "test_bridge_token");
  let testDeployId: number;

  beforeAll(() => {
    // Insert a valid test deploy log record
    testDeployId = logDeploy({
      chain: "base",
      tokenName: "Test Bridge Token",
      ticker: testTicker,
      contractAddr: testCa,
      txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      status: "confirmed",
      deployCost: 0,
      lifecycleState: "DEPLOY_CONFIRMED",
    });
  });

  afterAll(() => {
    // Clean up test output directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
    // Clean up test database file
    const dbPath = process.env.VAULT_DB_PATH!;
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
    delete process.env.VAULT_DB_PATH;
  });

  describe("1. Database Vault Website Persistence", () => {
    it("should update website_url by contract address", () => {
      const liveUrl = "https://testbridge-official.vercel.app";
      const updated = updateDeployLogWebsite(testCa, liveUrl);
      expect(updated).toBe(true);

      const retrieved = getDeployLogWebsite(testCa);
      expect(retrieved).toBe(liveUrl);
    });

    it("should update website_url by numeric ID", () => {
      const customUrl = "https://testbridge.xyz";
      const updated = updateDeployLogWebsite(testDeployId, customUrl);
      expect(updated).toBe(true);

      const retrieved = getDeployLogWebsite(testDeployId);
      expect(retrieved).toBe(customUrl);
    });

    it("should expose websiteUrl in getDeployLogByContract and getAllDeployLogs", () => {
      const log = getDeployLogByContract(testCa);
      expect(log).not.toBeNull();
      expect(log?.websiteUrl).toBe("https://testbridge.xyz");

      const allLogs = getAllDeployLogs({ chain: "base" });
      const found = allLogs.find((l) => l.contractAddr?.toLowerCase() === testCa.toLowerCase());
      expect(found).toBeDefined();
      expect(found?.websiteUrl).toBe("https://testbridge.xyz");
    });
  });

  describe("2. Website Generator Automatic Vault Persistence Sync", () => {
    it("should generate website bundle and automatically synchronize liveUrl to vault", async () => {
      const result = await generateTokenWebsite({
        name: "Test Bridge Token",
        ticker: testTicker,
        contractAddress: testCa,
        chainName: "base",
        chainId: 8453,
        outputDir: testOutputDir,
      });

      expect(result.ticker).toBe(testTicker);
      expect(result.contractAddress).toBe(testCa);
      expect(result.liveUrl).toMatch(/\.(pages\.dev|vercel\.app)/);
      expect(result.previewUrl).toBe("http://localhost:3000");

      // Verify that vault has been automatically updated with the liveUrl
      const updatedVaultUrl = getDeployLogWebsite(testCa);
      expect(updatedVaultUrl).toMatch(/\.(pages\.dev|vercel\.app)/);
    });
  });

  describe("3. DexScreener Monitor Activation Card Formatter", () => {
    it("should format a valid Discord / Telegram activation proof card", () => {
      const mockReport: CaIntelligenceReport = {
        contractAddress: testCa,
        chain: "base",
        detectedChainId: 8453,
        isDexScreenerPaid: true,
        dexScreenerProfileApproved: true,
        dexScreenerBoostCount: 5,
        dexScreenerStatusText: "PROCESSED & APPROVED (Official Token Profile)",
        market: {
          tokenName: "Test Bridge Token",
          tokenSymbol: testTicker,
          priceUsd: "0.00045",
          priceChange24h: 35.5,
          liquidityUsd: 50000,
          fdvUsd: 450000,
          volume24h: 120000,
          pairAddress: "0x1111111111111111111111111111111111111111",
          dexUrl: `https://dexscreener.com/base/${testCa}`,
          socials: {},
        },
        security: {
          isHoneypot: false,
          cannotBuy: false,
          cannotSellAll: false,
          buyTaxPct: 0,
          sellTaxPct: 0,
          isMintable: false,
          isBlacklisted: false,
          canTakeBackOwnership: false,
          isOpenSource: true,
          rawGoPlusStatus: "success",
          riskWarnings: [],
        },
        safetyScore: 95,
        safetyVerdict: "VERY_SAFE",
        sniperLinks: {
          maestro: "https://t.me/maestro",
          bananaGun: "https://t.me/banana",
          gmgn: `https://gmgn.ai/base/token/${testCa}`,
          photon: `https://photon-base.tinyastro.io/en/lp/${testCa}`,
          dexScreener: `https://dexscreener.com/base/${testCa}`,
          explorer: `https://basescan.org/token/${testCa}`,
          twitterSearch: `https://twitter.com/search?q=%24${testTicker}`,
        },
        timestamp: new Date().toISOString(),
      };

      const card = formatDexScreenerActivationCard(mockReport, 0);

      expect(card).toContain("DEXSCREENER OFFICIAL PROFILE ACTIVATED!");
      expect(card).toContain(`$${testTicker}`);
      expect(card).toContain(testCa);
      expect(card).toContain("5x Multiplier");
      expect(card).toContain("95/100 (VERY_SAFE)");
      expect(card).toContain("https://dexscreener.com/base/");
      expect(card).toContain("https://gmgn.ai/base/token/");
    });
  });
});
