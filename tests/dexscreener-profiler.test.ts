/**
 * tests/dexscreener-profiler.test.ts
 *
 * Automated tests for DexScreener Profile Builder, Fast-Track Text Auto-Fill, and Portal Sync.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  buildDexScreenerProfilePayload,
  generateDexScreenerFastTrackText,
  saveDexScreenerProfileJson,
  saveDexScreenerFastTrackText,
  getDexScreenerUpdatePortalUrl,
  normalizeDexScreenerChain,
} from "../src/modules/growth/dexscreener-profiler.ts";

describe("DexScreener Profiler & Fast-Track Auto-Fill Suite", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_dexscreener_unit");

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it("1. should normalize chains accurately", () => {
    expect(normalizeDexScreenerChain(8453)).toBe("base");
    expect(normalizeDexScreenerChain("BASE")).toBe("base");
    expect(normalizeDexScreenerChain(101)).toBe("solana");
    expect(normalizeDexScreenerChain("solana")).toBe("solana");
  });

  it("2. should generate official update portal 1-click URL", () => {
    const portalUrl = getDexScreenerUpdatePortalUrl("base", "0x1234567890abcdef1234567890abcdef12345678");
    expect(portalUrl).toBe("https://dexscreener.com/base/0x1234567890abcdef1234567890abcdef12345678");
  });

  it("3. should build a complete DexScreenerProfilePayload", () => {
    const payload = buildDexScreenerProfilePayload({
      chainId: 8453,
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      tokenName: "Test Token",
      tokenSymbol: "TEST",
      websiteUrl: "https://test-token.vercel.app",
      telegramUrl: "https://t.me/testtoken",
      twitterUrl: "https://x.com/testtoken",
    });

    expect(payload.chainId).toBe("base");
    expect(payload.tokenAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(payload.links.length).toBe(3);
    expect(payload.links.some((l) => l.type === "website")).toBe(true);
    expect(payload.links.some((l) => l.type === "telegram")).toBe(true);
    expect(payload.links.some((l) => l.type === "twitter")).toBe(true);
  });

  it("4. should generate formatted Fast-Track auto-fill text for $300 tier submission", () => {
    const payload = buildDexScreenerProfilePayload({
      chainId: 8453,
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      tokenName: "Test Token",
      tokenSymbol: "TEST",
      websiteUrl: "https://test-token.vercel.app",
      telegramUrl: "https://t.me/testtoken",
      twitterUrl: "https://x.com/testtoken",
    });

    const text = generateDexScreenerFastTrackText(payload);
    expect(text).toContain("DEXSCREENER TOKEN INFO UPDATE");
    expect(text).toContain("Base");
    expect(text).toContain("0x1234567890abcdef1234567890abcdef12345678");
    expect(text).toContain("https://test-token.vercel.app");
    expect(text).toContain("https://t.me/testtoken");
    expect(text).toContain("https://x.com/testtoken");
    expect(text).toContain("TOKEN IDENTITY");
    expect(text).toContain("LOCKED SUPPLY");
  });

  it("5. should save both json and fast-track text in output directory", () => {
    const payload = buildDexScreenerProfilePayload({
      chainId: 8453,
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      tokenName: "Test Token",
      tokenSymbol: "TEST",
      websiteUrl: "https://test-token.vercel.app",
    });

    const jsonPath = saveDexScreenerProfileJson(testOutputDir, payload);
    const textPath = path.join(testOutputDir, "dexscreener-fast-track.txt");

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(textPath)).toBe(true);

    const textContent = fs.readFileSync(textPath, "utf-8");
    expect(textContent).toContain("0x1234567890abcdef1234567890abcdef12345678");
  });
});
