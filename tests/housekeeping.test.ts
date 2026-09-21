/**
 * tests/housekeeping.test.ts
 *
 * Automated test suite for Safe Workspace Housekeeping & Test-Safe Artifact Guard.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { cleanupTemporaryArtifacts } from "../scripts/cleanup-artifacts.ts";
import {
  generateLaunchAnnouncementPack,
  saveLaunchAnnouncementPack,
} from "../src/modules/growth/launch-pack-generator.ts";

describe("Safe Workspace Housekeeping & Test-Safe Guard Suite", () => {
  const promoDir = path.resolve(process.cwd(), "promotions");
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_housekeeping_dir");

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe("1. Test-Safe Artifact Guard", () => {
    it("should NOT write to global promotions/ when ticker is a test fixture", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "TESTGUARD",
        name: "Test Guard Token",
        contractAddress: "0x1111111111111111111111111111111111111111",
        chain: "base",
      });

      const saved = saveLaunchAnnouncementPack(testOutputDir, pack);

      // Local output files MUST exist
      expect(fs.existsSync(saved.txtPath)).toBe(true);
      expect(fs.existsSync(saved.telegramTxtPath)).toBe(true);

      // Global promotions file MUST NOT be created for test ticker
      const promoTestPath = path.join(promoDir, "TELEGRAM_ANNOUNCEMENT_TESTGUARD.txt");
      expect(fs.existsSync(promoTestPath)).toBe(false);
    });
  });

  describe("2. Safe Housekeeping Cleanup", () => {
    it("should safely identify test files and preserve legitimate fleet promotions", () => {
      // Create a temporary dummy test file in promotions
      const dummyTestFile = path.join(promoDir, "TELEGRAM_ANNOUNCEMENT_TEST.txt");
      fs.writeFileSync(dummyTestFile, "dummy test fixture content", "utf-8");
      expect(fs.existsSync(dummyTestFile)).toBe(true);

      // Run cleanup
      const result = cleanupTemporaryArtifacts();

      // Verify dummy file was removed
      expect(result.removedFiles).toContain("TELEGRAM_ANNOUNCEMENT_TEST.txt");
      expect(fs.existsSync(dummyTestFile)).toBe(false);

      // Verify legitimate fleet files are preserved
      expect(result.preservedFiles).toContain("OFFER_PUMPRUN.md");
      expect(fs.existsSync(path.join(promoDir, "OFFER_PUMPRUN.md"))).toBe(true);
    });
  });
});
