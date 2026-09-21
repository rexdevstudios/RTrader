/**
 * tests/launch-readiness-checker.test.ts
 *
 * Automated test suite for the 1-Click Launch Readiness Preflight Score Engine.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { evaluateLaunchReadiness } from "../src/modules/intelligence/launch-readiness-checker.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("Launch Readiness Preflight Score Engine Suite", () => {
  const testSiteDir = path.resolve(process.cwd(), "sites", "test_readiness_token");

  afterAll(() => {
    if (fs.existsSync(testSiteDir)) {
      fs.rmSync(testSiteDir, { recursive: true, force: true });
    }
  });

  describe("1. Contract Address Format Checkpoint", () => {
    it("should award 10 points for valid EVM address format", async () => {
      const report = await evaluateLaunchReadiness({
        ticker: "EVMTEST",
        contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
        chain: "base",
        skipNetwork: true,
      });

      const caItem = report.items.find((i) => i.id === "valid_ca_format");
      expect(caItem).toBeDefined();
      expect(caItem!.status).toBe("PASS");
      expect(caItem!.score).toBe(10);
    });

    it("should fail and award 0 points for zero/dead address with remediation", async () => {
      const report = await evaluateLaunchReadiness({
        ticker: "DEADTEST",
        contractAddress: "0x000000000000000000000000000000000000dead",
        chain: "base",
        skipNetwork: true,
      });

      const caItem = report.items.find((i) => i.id === "valid_ca_format");
      expect(caItem).toBeDefined();
      expect(caItem!.status).toBe("FAIL");
      expect(caItem!.score).toBe(0);
      expect(caItem!.remediation).toBeDefined();
      expect(report.verdict).toBe("NOT_READY");
    });

    it("should award 10 points for valid Solana base58 address", async () => {
      const report = await evaluateLaunchReadiness({
        ticker: "SOLTEST",
        contractAddress: "So11111111111111111111111111111111111111112",
        chain: "solana",
        skipNetwork: true,
      });

      const caItem = report.items.find((i) => i.id === "valid_ca_format");
      expect(caItem).toBeDefined();
      expect(caItem!.status).toBe("PASS");
      expect(caItem!.score).toBe(10);
    });
  });

  describe("2. Comprehensive 10-Checkpoint Evaluation & Overall Score", () => {
    it("should award top score (>=85) and READY_FOR_BLITZ when website & launch packs are complete", async () => {
      // First generate real bundle in test directory
      await generateTokenWebsite({
        name: "Readiness Hero Protocol",
        ticker: "READINESS",
        contractAddress: "0x9876543210abcdef9876543210abcdef98765432",
        chainId: 8453,
        chainName: "base",
        outputDir: testSiteDir,
      });

      const report = await evaluateLaunchReadiness({
        ticker: "READINESS",
        contractAddress: "0x9876543210abcdef9876543210abcdef98765432",
        name: "Readiness Hero Protocol",
        chain: "base",
        siteDir: testSiteDir,
        skipNetwork: true,
      });

      expect(report.overallScore).toBeGreaterThanOrEqual(85);
      expect(report.verdict).toBe("READY_FOR_BLITZ");
      expect(report.verdictEmoji).toBe("🚀");
      expect(report.items).toHaveLength(10);

      // Verify specific checkpoints
      const webItem = report.items.find((i) => i.id === "local_website_bundle");
      expect(webItem!.status).toBe("PASS");
      expect(webItem!.score).toBe(10);

      const ogItem = report.items.find((i) => i.id === "opengraph_social_card");
      expect(ogItem!.status).toBe("PASS");

      const dexItem = report.items.find((i) => i.id === "dexscreener_profile_pack");
      expect(dexItem!.status).toBe("PASS");

      const twitterItem = report.items.find((i) => i.id === "twitter_launch_pack");
      expect(twitterItem!.status).toBe("PASS");

      const tgItem = report.items.find((i) => i.id === "telegram_blitz_pack");
      expect(tgItem!.status).toBe("PASS");
    });

    it("should flag missing assets with FAIL/WARN and provide remediation steps when directory is empty", async () => {
      const emptyDir = path.resolve(process.cwd(), "sites", "test_empty_token");

      const report = await evaluateLaunchReadiness({
        ticker: "EMPTY",
        contractAddress: "0x5555555555555555555555555555555555555555",
        siteDir: emptyDir,
        skipNetwork: true,
      });

      const webItem = report.items.find((i) => i.id === "local_website_bundle");
      expect(webItem!.status).toBe("FAIL");
      expect(webItem!.remediation).toContain("GENERATE_WEBSITE");

      const twitterItem = report.items.find((i) => i.id === "twitter_launch_pack");
      expect(twitterItem!.status).toBe("FAIL");
      expect(twitterItem!.remediation).toContain("announcement:pack");
    });
  });
});
