import { describe, it, expect, beforeEach } from "bun:test";
import {
  calculateFeeSplit,
  generateFlywheelAnnouncementCard,
  executeFlywheelCycle,
  getFlywheelEvents,
  getFlywheelSummary,
} from "../src/modules/growth/flywheel-engine.ts";
import { recordFlywheelEvent, type FlywheelEventInput } from "../src/db/vault.ts";
import { resetConfig } from "../src/config.ts";

describe("V3.0 — Flywheel Growth Engine (Positive-Sum Architecture)", () => {
  beforeEach(() => {
    resetConfig();
    process.env.FLYWHEEL_CREATOR_RATIO = "0.35";
    process.env.FLYWHEEL_BUYBACK_RATIO = "0.30";
    process.env.FLYWHEEL_DIVIDEND_RATIO = "0.20";
    process.env.FLYWHEEL_JACKPOT_RATIO = "0.15";
    resetConfig();
  });

  describe("1. Mathematical Fee Split Precision", () => {
    it("1.1 should accurately split 1.0 ETH into exact 35%/30%/20%/15% proportions", () => {
      const split = calculateFeeSplit(1.0);
      expect(split.totalClaimedWeth).toBe(1.0);
      expect(split.creatorWeth).toBe(0.35);
      expect(split.buybackWeth).toBe(0.30);
      expect(split.dividendWeth).toBe(0.20);
      expect(split.jackpotWeth).toBe(0.15);

      const sum = Number((split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth).toFixed(8));
      expect(sum).toBe(1.0);
    });

    it("1.2 should absorb floating-point rounding residue into creatorWeth to ensure zero leakage", () => {
      // 0.03333333 ETH has repeating decimals
      const total = 0.03333333;
      const split = calculateFeeSplit(total);

      const sum = Number((split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth).toFixed(8));
      expect(sum).toBe(total);
      expect(split.creatorWeth).toBeGreaterThan(0);
      expect(split.buybackWeth).toBeGreaterThan(0);
      expect(split.dividendWeth).toBeGreaterThan(0);
      expect(split.jackpotWeth).toBeGreaterThan(0);
    });

    it("1.3 should return zero split when totalClaimedWeth is 0 or negative", () => {
      const zeroSplit = calculateFeeSplit(0);
      expect(zeroSplit.totalClaimedWeth).toBe(0);
      expect(zeroSplit.creatorWeth).toBe(0);
      expect(zeroSplit.buybackWeth).toBe(0);
      expect(zeroSplit.dividendWeth).toBe(0);
      expect(zeroSplit.jackpotWeth).toBe(0);

      const negSplit = calculateFeeSplit(-0.5);
      expect(negSplit.totalClaimedWeth).toBe(0);
    });

    it("1.4 should support custom ratio overrides", () => {
      const split = calculateFeeSplit(0.10, {
        creatorRatio: 0.50,
        buybackRatio: 0.25,
        dividendRatio: 0.15,
        jackpotRatio: 0.10,
      });

      expect(split.creatorWeth).toBe(0.05);
      expect(split.buybackWeth).toBe(0.025);
      expect(split.dividendWeth).toBe(0.015);
      expect(split.jackpotWeth).toBe(0.01);
      const sum = Number((split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth).toFixed(8));
      expect(sum).toBe(0.10);
    });
  });

  describe("2. Community Announcement Card Generation", () => {
    it("2.1 should generate a formatted alpha card with CA, 0% tax, and 4 pillars", () => {
      const card = generateFlywheelAnnouncementCard(
        {
          name: "PumpRun Flywheel",
          ticker: "PUMPRUN",
          description: "Positive-sum meme on Base",
        },
        "0x7CE19E4F978009EB644c27946B47221b824C0bA3"
      );

      expect(card).toContain("PUMPRUN");
      expect(card).toContain("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(card).toContain("0% Buy Tax / 0% Sell Tax");
      expect(card).toContain("30% Auto Buyback & Burn");
      expect(card).toContain("20% Passive WETH Yield");
      expect(card).toContain("15% 10-Min FOMO Jackpot");
      expect(card).toContain("35% Creator Protocol");
      expect(card).toContain("https://dexscreener.com/base/0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    });
  });

  describe("3. SQLite Vault Persistence & Aggregations", () => {
    it("3.1 should record and retrieve flywheel events in SQLite", () => {
      const testEventId = `fw_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const testCa = `0x9999999999999999999999999999999999999999`;

      const saved = recordFlywheelEvent({
        eventId: testEventId,
        tokenAddress: testCa,
        tokenSymbol: "TESTFW",
        totalClaimedWeth: 0.1,
        creatorWeth: 0.035,
        buybackWeth: 0.03,
        dividendWeth: 0.02,
        jackpotWeth: 0.015,
        burnedTokens: 3_000_000,
        burnTxHash: "0xdeadburnhash",
        status: "completed",
      });

      expect(saved.id).toBeGreaterThan(0);
      expect(saved.eventId).toBe(testEventId);
      expect(saved.totalClaimedWeth).toBe(0.1);

      // Query by CA
      const events = getFlywheelEvents(testCa);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].tokenAddress.toLowerCase()).toBe(testCa.toLowerCase());

      // Query summary
      const summary = getFlywheelSummary(testCa);
      expect(summary.totalClaimedWeth).toBeGreaterThanOrEqual(0.1);
      expect(summary.totalBuybackWeth).toBeGreaterThanOrEqual(0.03);
      expect(summary.totalBurnedTokens).toBeGreaterThanOrEqual(3_000_000);
      expect(summary.eventCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("4. Flywheel Cycle Orchestration", () => {
    it("4.1 should execute simulated distribution cycle when customWethAmount is supplied", async () => {
      const res = await executeFlywheelCycle({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        simulateOnly: true,
        customWethAmount: 0.05,
      });

      expect(res.success).toBe(true);
      expect(res.totalClaimedWeth).toBe(0.05);
      expect(res.split.creatorWeth).toBeCloseTo(0.0175, 4);
      expect(res.split.buybackWeth).toBeCloseTo(0.015, 4);
      expect(res.split.dividendWeth).toBeCloseTo(0.010, 4);
      expect(res.split.jackpotWeth).toBeCloseTo(0.0075, 4);
      expect(res.burnTxHash).toBeDefined();
      expect(res.event).toBeDefined();
      expect(res.event?.id).toBeGreaterThan(0);
    });

    it("4.2 should safely report error when no claimable fee exists and custom amount is not provided", async () => {
      const res = await executeFlywheelCycle({
        tokenAddress: "0x000000000000000000000000000000000000dead",
        tokenSymbol: "NONEXISTENT",
        simulateOnly: true,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("NO_CLAIMABLE_FEE_AVAILABLE");
    });
  });
});
