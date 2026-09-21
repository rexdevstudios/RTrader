/**
 * tests/growth-automation-suite.test.ts
 *
 * Automated Regression Suite for Growth Automation:
 *  1. Cloudflare DNS API v4 Provisioner & Fallback Instructions
 *  2. Telegram Community Agent Website & Swap Pinning Handler
 *  3. Background DexScreener Boost Watchdog Daemon Loop
 *
 * Adheres strictly to Rule 4 of AGENTS.md:
 * Isolated test database environment (NODE_ENV=test).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as path from "path";
import * as fs from "fs";

// Enforce test database isolation before importing vault
process.env.NODE_ENV = "test";
process.env.VAULT_DB_PATH = path.join(process.cwd(), ".eliza", "test_vault_growth_automation.db");

import { logDeploy } from "../src/db/vault.ts";
import {
  provisionSubdomainDns,
  getManualDnsInstructions,
} from "../src/modules/growth/cloudflare-dns.ts";
import { broadcastAndPinTokenWebsite } from "../src/modules/telegram/token-agent-bot.ts";
import { runDexScreenerWatchdog } from "../src/modules/intelligence/dexscreener-monitor.ts";

describe("Production Growth Automation Suite", () => {
  const testCa = "0x1234567890123456789012345678901234567890";
  const testTicker = "AUTOAI";

  beforeAll(() => {
    // Insert a valid test deployment in isolated test db
    logDeploy({
      chain: "base",
      tokenName: "Autonomous AI Token",
      ticker: testTicker,
      contractAddr: testCa,
      txHash: "0x1111222233334444555566667777888899990000111122223333444455556666",
      status: "confirmed",
      deployCost: 0,
      lifecycleState: "DEPLOY_CONFIRMED",
    });
  });

  afterAll(() => {
    // Clean up test database file
    const dbPath = process.env.VAULT_DB_PATH!;
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
    delete process.env.VAULT_DB_PATH;
  });

  describe("1. Cloudflare DNS API Provisioner & Fallback", () => {
    it("should generate formatted manual DNS instructions", () => {
      const guide = getManualDnsInstructions("intel", "supertoken.xyz");

      expect(guide).toContain("intel.supertoken.xyz");
      expect(guide).toContain("cname.vercel-dns.com");
      expect(guide).toContain("76.76.21.21");
      expect(guide).toContain("npx vercel domains add intel.supertoken.xyz");
    });

    it("should gracefully handle missing Cloudflare credentials without crashing", async () => {
      // Temporarily unset credentials
      const savedToken = process.env.CLOUDFLARE_API_TOKEN;
      const savedZone = process.env.CLOUDFLARE_ZONE_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ZONE_ID;

      const result = await provisionSubdomainDns({
        ticker: testTicker,
        contractAddress: testCa,
        rootDomain: "mytestproject.xyz",
      });

      expect(result.success).toBe(false);
      expect(result.action).toBe("CONFIG_MISSING");
      expect(result.subdomain).toBe("autoai");
      expect(result.fullDomain).toBe("autoai.mytestproject.xyz");
      expect(result.manualGuide).toBeDefined();
      expect(result.manualGuide).toContain("cname.vercel-dns.com");

      // Restore credentials
      if (savedToken) process.env.CLOUDFLARE_API_TOKEN = savedToken;
      if (savedZone) process.env.CLOUDFLARE_ZONE_ID = savedZone;
    });

    it("should gracefully return API_ERROR when invalid credentials are provided", async () => {
      const result = await provisionSubdomainDns({
        ticker: testTicker,
        contractAddress: testCa,
        rootDomain: "mytestproject.xyz",
        apiToken: "invalid_dummy_token_12345",
        zoneId: "invalid_dummy_zone_12345",
      });

      expect(result.success).toBe(false);
      expect(result.action).toBe("API_ERROR");
      expect(result.fullDomain).toBe("autoai.mytestproject.xyz");
      expect(result.manualGuide).toBeDefined();
    });
  });

  describe("2. Telegram Community Agent Website Pinning Handler", () => {
    it("should return fail-safe result when bot token or target chat is not configured", async () => {
      const result = await broadcastAndPinTokenWebsite(
        {
          address: testCa,
          ticker: testTicker,
          name: "Autonomous AI Token",
          chain: "base",
        },
        {
          botToken: undefined,
          chatId: undefined,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("3. Background DexScreener Watchdog Daemon Loop", () => {
    it("should execute runDexScreenerWatchdog without throwing and return structured summary", async () => {
      const summary = await runDexScreenerWatchdog({ maxTokens: 2 });

      expect(summary).toBeDefined();
      expect(typeof summary.checked).toBe("number");
      expect(typeof summary.activations).toBe("number");
      expect(typeof summary.errors).toBe("number");
      expect(summary.checked).toBeGreaterThanOrEqual(1);
    });
  });
});
