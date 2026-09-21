/**
 * tests/launch-pack-generator.test.ts
 *
 * Automated test suite for the Twitter / X Launch Announcement Pack Generator.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  generateLaunchAnnouncementPack,
  saveLaunchAnnouncementPack,
} from "../src/modules/growth/launch-pack-generator.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("Twitter / X Launch Announcement Pack Generator Suite", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_pack_token");

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe("1. Pack Generation Engine", () => {
    it("should generate a complete announcement pack with dual formats", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "FLY",
        name: "Flywheel Protocol",
        contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
        chain: "base",
      });

      expect(pack.ticker).toBe("FLY");
      expect(pack.name).toBe("Flywheel Protocol");
      expect(pack.contractAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(pack.chain).toBe("base");

      // Verify Power Tweet
      expect(pack.powerTweet).toBeDefined();
      expect(pack.powerTweet.index).toBe(0);
      expect(pack.powerTweet.content).toContain("$FLY");
      expect(pack.powerTweet.content).toContain("0x1234567890abcdef1234567890abcdef12345678");
      expect(pack.powerTweet.charCount).toBeLessThanOrEqual(280);
      expect(pack.powerTweet.fitsSingleTweet).toBe(true);

      // Verify Mega Thread
      expect(pack.threadTweets).toHaveLength(3);
      expect(pack.threadTweets[0].title).toContain("THREAD 1/3");
      expect(pack.threadTweets[0].content).toContain("1/3");
      expect(pack.threadTweets[0].content).toContain("0x1234567890abcdef1234567890abcdef12345678");

      expect(pack.threadTweets[1].title).toContain("THREAD 2/3");
      expect(pack.threadTweets[1].content).toContain("2/3");
      expect(pack.threadTweets[1].content).toContain("FLYWHEEL");

      expect(pack.threadTweets[2].title).toContain("THREAD 3/3");
      expect(pack.threadTweets[2].content).toContain("3/3");
      expect(pack.threadTweets[2].content).toContain("AUDITED");

      // Verify metadata & full compiled text
      expect(pack.metadata.dexScreenerUrl).toContain("dexscreener.com/base/");
      expect(pack.metadata.uniswapUrl).toContain("app.uniswap.org");
      expect(pack.fullText).toContain("[OPTION A: SINGLE POWER TWEET");
      expect(pack.fullText).toContain("[OPTION B: FULL 3-TWEET LAUNCH THREAD]");
    });

    it("should correctly tailor links and tags for Solana chain", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "SOLMEME",
        name: "Solana Meme King",
        contractAddress: "So11111111111111111111111111111111111111112",
        chain: "solana",
      });

      expect(pack.chain).toBe("solana");
      expect(pack.powerTweet.content).toContain("#Solana");
      expect(pack.metadata.uniswapUrl).toContain("jup.ag/swap/SOL-");
      expect(pack.tags).toContain("#Solana");
    });
  });

  describe("2. File Persistence & Export", () => {
    it("should write launch-announcement.txt and launch-announcement.json", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "TEST",
        name: "Test Token",
        contractAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        chain: "base",
      });

      const saved = saveLaunchAnnouncementPack(testOutputDir, pack);

      expect(fs.existsSync(saved.txtPath)).toBe(true);
      expect(fs.existsSync(saved.jsonPath)).toBe(true);

      const txtContent = fs.readFileSync(saved.txtPath, "utf-8");
      expect(txtContent).toContain("$TEST");
      expect(txtContent).toContain("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

      const jsonContent = JSON.parse(fs.readFileSync(saved.jsonPath, "utf-8"));
      expect(jsonContent.ticker).toBe("TEST");
      expect(jsonContent.powerTweet.fitsSingleTweet).toBe(true);
      expect(jsonContent.threadTweets.length).toBe(3);
    });
  });

  describe("3. End-to-End Website Generator Integration", () => {
    it("should automatically generate launch announcement pack during website compilation", async () => {
      const result = await generateTokenWebsite({
        name: "Pack Integration Token",
        ticker: "TESTPACK",
        contractAddress: "0x8888888888888888888888888888888888888888",
        chainId: 8453,
        chainName: "base",
        outputDir: testOutputDir,
      });

      expect(result.launchAnnouncementPath).toBeDefined();
      expect(fs.existsSync(result.launchAnnouncementPath!)).toBe(true);

      const jsonPath = path.join(testOutputDir, "launch-announcement.json");
      expect(fs.existsSync(jsonPath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(parsed.ticker).toBe("TESTPACK");
      expect(parsed.powerTweet.fitsSingleTweet).toBe(true);
    });
  });
});
