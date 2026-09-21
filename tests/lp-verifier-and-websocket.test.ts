/**
 * tests/lp-verifier-and-websocket.test.ts
 *
 * Automated test suite for:
 * 1. Autonomous Liquidity Lock & Burn Badge Verifier
 * 2. Real-Time WebSocket Price Telemetry di Marquee Bar
 *
 * Verifies on-chain audit elements, telemetry reactivity, and JS syntax integrity.
 */

import { describe, test, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("Autonomous Liquidity Lock & WebSocket Price Telemetry Suite", () => {
  const baseTestDir = path.resolve(process.cwd(), "sites", "test_lp_ws_suite");

  afterAll(() => {
    if (fs.existsSync(baseTestDir)) {
      fs.rmSync(baseTestDir, { recursive: true, force: true });
    }
  });

  test("1. Base L2: Security Audit Liquidity Card and Marquee Telemetry HTML binding", async () => {
    const siteDir = path.join(baseTestDir, "base_token");
    const mockCA = "0x946657d17c7e83052d50634d9da6ff3fc46b418a";

    const result = await generateTokenWebsite({
      name: "Autonomous Vault Token",
      ticker: "AVT",
      contractAddress: mockCA,
      chainId: 8453,
      chainName: "base",
      description: "Automated Liquidity Lock on Base L2",
      outputDir: siteDir,
    });

    const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
    const js = fs.readFileSync(path.join(result.siteDirectory, "parallax-3d.js"), "utf-8");

    // 1.1 Marquee Telemetry IDs & Currency Switcher
    expect(html).toContain('id="marquee-price-val"');
    expect(html).toContain('id="marquee-change-val"');
    expect(html).toContain('id="marquee-lp-badge"');
    expect(html).toContain('id="currency-toggle-btn"');
    expect(html).toContain("USD ⇄ ETH");
    expect(html).toContain("VERIFIED BURNT / LOCKED");

    // 1.2 Liquidity Lock Card in Security Audit
    expect(html).toContain('id="liquidity-lock-card"');
    expect(html).toContain('id="lp-verified-seal"');
    expect(html).toContain("100% SECURE");
    expect(html).toContain('id="lp-status-text"');
    expect(html).toContain("PERMANENTLY BURNT (0x0...dead)");
    expect(html).toContain("Proof ↗");
    expect(html).toContain("basescan.org");

    // 1.3 Client-Side JS Modules
    expect(js).toContain("initLpVerification");
    expect(js).toContain("initLiveMarketData");
    expect(js).toContain("currency-toggle-btn");
    expect(js).toContain("activeCurrency");
    expect(js).toContain("renderPriceDisplay");
    expect(js).toContain("wss://io.dexscreener.com/dex/screener/pairs/");
    expect(js).toContain("text-emerald-400");
    expect(js).toContain("text-rose-400");
    expect(js).toContain("__latestPriceNative");

    // 1.4 Syntax Check via new Function
    expect(() => new Function(js)).not.toThrow();
  });

  test("2. Solana Mainnet: Bonding Curve Locked Status and Solscan Proof Link", async () => {
    const siteDir = path.join(baseTestDir, "solana_token");
    const mockCA = "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz";

    const result = await generateTokenWebsite({
      name: "Solana Pump Protocol",
      ticker: "SPUMP",
      contractAddress: mockCA,
      chainId: 101,
      chainName: "solana",
      description: "Autonomous Solana Token with Pump AMM",
      outputDir: siteDir,
    });

    const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
    const js = fs.readFileSync(path.join(result.siteDirectory, "parallax-3d.js"), "utf-8");

    // 2.1 Solana Marquee & Liquidity & Currency Switcher
    expect(html).toContain('id="marquee-price-val"');
    expect(html).toContain('id="marquee-change-val"');
    expect(html).toContain('id="marquee-lp-badge"');
    expect(html).toContain('id="currency-toggle-btn"');
    expect(html).toContain("USD ⇄ SOL");
    expect(html).toContain('id="liquidity-lock-card"');
    expect(html).toContain("BONDING CURVE LOCKED / BURNT");
    expect(html).toContain("solscan.io");
    expect(html).toContain("RAYDIUM / PUMP AMM");

    // 2.2 Client-Side JS Modules for Solana
    expect(js).toContain("initLpVerification");
    expect(js).toContain("initLiveMarketData");
    expect(js).toContain("currency-toggle-btn");
    expect(js).toContain("activeCurrency");
    expect(js).toContain("renderPriceDisplay");
    expect(js).toContain("solana");
    expect(js).toContain("wss://io.dexscreener.com/dex/screener/pairs/");

    // 2.3 Syntax Check
    expect(() => new Function(js)).not.toThrow();
  });

  test("3. Cross-Template JS Syntax Integrity across All Sectors", async () => {
    const sectors = ["AI_AGENT", "DEFI_TREASURY", "GAMING_UTILITY", "VIRAL_MEME"] as const;

    for (const sector of sectors) {
      const siteDir = path.join(baseTestDir, `sector_${sector.toLowerCase()}`);
      const result = await generateTokenWebsite({
        name: `Token ${sector}`,
        ticker: sector.slice(0, 5),
        contractAddress: "0x1111111111111111111111111111111111111111",
        chainId: 8453,
        chainName: "base",
        customSector: sector,
        outputDir: siteDir,
      });

      const js = fs.readFileSync(path.join(result.siteDirectory, "parallax-3d.js"), "utf-8");
      expect(js).toContain("initLpVerification");
      expect(js).toContain("initLiveMarketData");
      expect(() => new Function(js)).not.toThrow();
    }
  });
});
