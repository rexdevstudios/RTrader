/**
 * tests/growth-extensions.test.ts
 *
 * Automated test suite for DexScreener Token Profiler, Dynamic OpenGraph 1200x630
 * Social Card Generator, and In-Page Decentralized Swap Widget.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  normalizeDexScreenerChain,
  buildDexScreenerProfilePayload,
  getDexScreenerUpdatePortalUrl,
  saveDexScreenerProfileJson,
} from "../src/modules/growth/dexscreener-profiler.ts";
import {
  generateSocialCardSvg,
  saveSocialCardSvg,
} from "../src/modules/growth/social-card-generator.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("Growth Extensions Suite: DexScreener Profiler, OG Cards & In-Page Swap", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_growth_token");

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe("1. DexScreener Official Token Profiler", () => {
    it("should normalize chain identifiers correctly", () => {
      expect(normalizeDexScreenerChain("8453")).toBe("base");
      expect(normalizeDexScreenerChain(8453)).toBe("base");
      expect(normalizeDexScreenerChain("101")).toBe("solana");
      expect(normalizeDexScreenerChain(101)).toBe("solana");
      expect(normalizeDexScreenerChain(46688)).toBe("robinhood");
    });

    it("should build a compliant DexScreener Profile payload", () => {
      const payload = buildDexScreenerProfilePayload({
        chainId: "base",
        tokenAddress: "0x13088497d81234567890abcdef1234567890abcd",
        tokenName: "Intelena",
        tokenSymbol: "INTEL",
        description: "Autonomous AI Agent with negative net emission.",
        twitterUrl: "https://x.com/intel_coin",
        telegramUrl: "https://t.me/intel_portal",
      });

      expect(payload.chainId).toBe("base");
      expect(payload.tokenAddress).toBe("0x13088497d81234567890abcdef1234567890abcd");
      expect(payload.url).toMatch(/\.(pages\.dev|vercel\.app)/);
      expect(payload.links.length).toBe(3);
      expect(payload.links[0].type).toBe("website");
      expect(payload.links[1].type).toBe("twitter");
      expect(payload.links[2].type).toBe("telegram");
    });

    it("should generate 1-click update portal URL", () => {
      const url = getDexScreenerUpdatePortalUrl("base", "0x123456");
      expect(url).toBe("https://dexscreener.com/base/0x123456");
    });

    it("should save dexscreener-profile.json to disk", () => {
      const payload = buildDexScreenerProfilePayload({
        chainId: "base",
        tokenAddress: "0x9999",
        tokenName: "Test",
        tokenSymbol: "TST",
      });
      const savedPath = saveDexScreenerProfileJson(testOutputDir, payload);
      expect(fs.existsSync(savedPath)).toBe(true);
      const readJson = JSON.parse(fs.readFileSync(savedPath, "utf-8"));
      expect(readJson.tokenAddress).toBe("0x9999");
    });
  });

  describe("2. Dynamic 1200x630 OpenGraph / Twitter Card Vector Banner", () => {
    it("should generate valid 1200x630 SVG with branding and audit metrics", () => {
      const svg = generateSocialCardSvg({
        name: "Intelena Protocol",
        ticker: "INTEL",
        contractAddress: "0x13088497d81234567890abcdef1234567890abcd",
        chainDisplayName: "Base Mainnet L2",
        safetyScore: 100,
        buyTax: "0%",
        sellTax: "0%",
        buybackPct: 30,
        dividendPct: 20,
        jackpotPct: 15,
      });

      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="0 0 1200 630"');
      expect(svg).toContain('$INTEL');
      expect(svg).toContain('Intelena Protocol');
      expect(svg).toContain('0x13088497d81234567890abcdef1234567890abcd');
      expect(svg).toContain('AUDIT 100/100 SAFE');
      expect(svg).toContain('Zero Trading Tax');
      expect(svg).toContain('30%');
      expect(svg).toContain('20%');
      expect(svg).toContain('15%');
    });

    it("should save og-image.svg to target directory", () => {
      const savedPath = saveSocialCardSvg(testOutputDir, {
        name: "Test",
        ticker: "TST",
        contractAddress: "0x123",
        chainDisplayName: "Base L2",
      });
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(savedPath.endsWith("og-image.svg")).toBe(true);
    });
  });

  describe("3. End-to-End Website Integration: In-Page Swap, OG Image & DexScreener Profile", () => {
    it("should synthesize og-image.svg, dexscreener-profile.json and #swap section in website bundle", async () => {
      const mockCA = "0x4444555566667777888899990000111122223333";
      const result = await generateTokenWebsite({
        name: "Clanker AI Protocol",
        ticker: "CLANK",
        contractAddress: mockCA,
        chainId: 8453,
        chainName: "base",
        description: "Autonomous AI agent on Base with in-page swap.",
        outputDir: testOutputDir,
      });

      // Verify files on disk
      const ogImagePath = path.join(result.siteDirectory, "og-image.svg");
      const dexProfilePath = path.join(result.siteDirectory, "dexscreener-profile.json");
      expect(fs.existsSync(ogImagePath)).toBe(true);
      expect(fs.existsSync(dexProfilePath)).toBe(true);

      // Verify HTML content
      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
      expect(html).toContain('content="og-image.svg"');
      expect(html).toContain('id="swap"');
      expect(html).toContain('Instant In-Page Swap');
      expect(html).toContain('id="swap-input-eth"');
      expect(html).toContain('id="swap-output-token"');
      expect(html).toContain('Execute Swap on Liquidity Pool');

      // Verify JS content
      const js = fs.readFileSync(path.join(result.siteDirectory, "parallax-3d.js"), "utf-8");
      expect(js).toContain('initSwapWidget');
      expect(js).toContain('swap-input-eth');
    });
  });
});
