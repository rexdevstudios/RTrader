/**
 * tests/flywheel-economic-value.test.ts
 *
 * Automated verification suite for:
 * 1. 4-Pillar & 5-Pillar Flywheel mathematical split precision (zero leakage).
 * 2. Cloudflare Pages & Vercel automated custom domain binding functions.
 * 3. Website template generator: contains #flywheel section, referral tools, and ZERO emojis.
 * 4. Sniper Bot activation alert format and non-blocking delivery.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { calculateFeeSplit } from "../src/modules/growth/flywheel-engine.ts";
import {
  bindCustomDomainToPages,
  bindCustomDomainToVercel,
  provisionSubdomainDns,
} from "../src/modules/growth/cloudflare-dns.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { broadcastSniperReadyAlert } from "../src/modules/social/beacon-broadcaster.ts";

describe("Flywheel Economic Value & Automation Suite", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_flywheel_val");

  beforeEach(() => {
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it("1. should calculate exact 4-pillar fee split with zero residue leakage", () => {
    const totalClaimed = 1.45892144;
    const split = calculateFeeSplit(totalClaimed);

    expect(split.totalClaimedWeth).toBe(1.45892144);
    expect(split.buybackWeth).toBeGreaterThan(0);
    expect(split.dividendWeth).toBeGreaterThan(0);
    expect(split.jackpotWeth).toBeGreaterThan(0);
    expect(split.creatorWeth).toBeGreaterThan(0);

    const sum = Number(
      (split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth).toFixed(8)
    );
    expect(sum).toBe(split.totalClaimedWeth);
  });

  it("2. should allocate 5% affiliate referral bounty when referral address is provided", () => {
    const totalClaimed = 2.0;
    const refAddr = "0x1111111111111111111111111111111111111111";
    const split = calculateFeeSplit(totalClaimed, undefined, refAddr);

    expect(split.referralAddress).toBe(refAddr);
    expect(split.referralWeth).toBe(0.1);
    expect(split.buybackWeth).toBe(0.6);
    expect(split.dividendWeth).toBe(0.4);
    expect(split.jackpotWeth).toBe(0.3);
    expect(split.creatorWeth).toBe(0.6);

    const sum = Number(
      (
        split.creatorWeth +
        split.buybackWeth +
        split.dividendWeth +
        split.jackpotWeth +
        (split.referralWeth || 0)
      ).toFixed(8)
    );
    expect(sum).toBe(split.totalClaimedWeth);
  });

  it("3. should handle non-existent project error gracefully when binding domain to Pages", async () => {
    const res = await bindCustomDomainToPages({
      projectName: "non-existent-test-project-xyz-12345",
      domain: "app.example.com",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("ERROR");
    expect(res.message).toContain("Pages API error");
  });

  it("4. should handle unconfigured Vercel domain binding gracefully", async () => {
    const res = await bindCustomDomainToVercel({
      token: "",
      projectId: "",
      domain: "test.example.com",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("UNCONFIGURED");
    expect(res.message).toContain("VERCEL_TOKEN");
  });

  it("5. should generate website containing #flywheel section and zero emojis", async () => {
    const siteResult = await generateTokenWebsite({
      name: "Flywheel Protocol",
      ticker: "FWHEEL",
      contractAddress: "0x1234567890123456789012345678901234567890",
      chainName: "base",
      outputDir: testOutputDir,
    });

    expect(fs.existsSync(siteResult.indexHtmlPath)).toBe(true);
    const html = fs.readFileSync(siteResult.indexHtmlPath, "utf-8");

    expect(html).toContain('id="flywheel"');
    expect(html).toContain("Perpetual Economic Flywheel");

    expect(html).toContain('id="dividend-token-input"');
    expect(html).toContain('id="dividend-slider"');
    expect(html).toContain('id="affiliate-wallet-input"');
    expect(html).toContain('id="generate-ref-btn"');
    expect(html).toContain('id="flywheel-burn-val"');

    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]/g;
    const matches = html.match(emojiRegex);
    expect(matches).toBeNull();
  });

  it("6. should format and dispatch sniper bot alert non-blockingly", async () => {
    const alertRes = await broadcastSniperReadyAlert({
      ticker: "PUMPRUN",
      name: "PumpRun Protocol",
      contractAddress: "0x1234567890123456789012345678901234567890",
      chain: "base",
      safetyScore: 100,
      safetyVerdict: "100/100 SAFE",
      liquidityUsd: 50000,
      timeoutMs: 1000,
    });

    expect(alertRes.success).toBe(true);
    expect(alertRes.messageText).toContain("SNIPER BOT ACTIVATION ALERT");
    expect(alertRes.messageText).toContain("100/100 SAFE");
  });
});
