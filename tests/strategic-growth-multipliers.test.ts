import { describe, it, expect, beforeEach } from "bun:test";
import {
  calculateFeeSplit,
  generateReferralLink,
  generateBurnProofBeaconCard,
  generateDividendProofBeaconCard,
  generateJackpotProofBeaconCard,
  executeFlywheelCycle,
} from "../src/modules/growth/flywheel-engine.ts";
import { runTrendingBoostCycle } from "../src/modules/growth/trending-booster.ts";
import { resetConfig } from "../src/config.ts";

describe("V3.1 — Strategic Growth Multipliers (Referral, Beacon & Trending Booster)", () => {
  beforeEach(() => {
    resetConfig();
    process.env.FLYWHEEL_CREATOR_RATIO = "0.35";
    process.env.FLYWHEEL_BUYBACK_RATIO = "0.30";
    process.env.FLYWHEEL_DIVIDEND_RATIO = "0.20";
    process.env.FLYWHEEL_JACKPOT_RATIO = "0.15";
    resetConfig();
  });

  describe("1. Referral Bounty Fee Splitter", () => {
    it("1.1 should deduct 5% referral bounty from creator share when referralAddress is provided", () => {
      const split = calculateFeeSplit(
        1.0,
        undefined,
        "0x1111111111111111111111111111111111111111"
      );

      expect(split.totalClaimedWeth).toBe(1.0);
      expect(split.creatorWeth).toBeCloseTo(0.30, 4); // 35% - 5% = 30%
      expect(split.referralWeth).toBeCloseTo(0.05, 4); // 5%
      expect(split.buybackWeth).toBeCloseTo(0.30, 4);
      expect(split.dividendWeth).toBeCloseTo(0.20, 4);
      expect(split.jackpotWeth).toBeCloseTo(0.15, 4);
      expect(split.referralAddress).toBe("0x1111111111111111111111111111111111111111");

      const total = Number(
        (
          split.creatorWeth +
          (split.referralWeth ?? 0) +
          split.buybackWeth +
          split.dividendWeth +
          split.jackpotWeth
        ).toFixed(8)
      );
      expect(total).toBe(1.0);
    });

    it("1.2 should generate a valid affiliate link format", () => {
      const ca = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
      const affiliate = "0xAbCdEf1234567890";
      const link = generateReferralLink(ca, affiliate);

      expect(link).toContain("dexscreener.com/base/0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(link).toContain("ref=0xAbCdEf1234567890");
    });
  });

  describe("2. Live Proof Beacon Cards", () => {
    it("2.1 should generate Burn Proof Beacon card with BaseScan proof", () => {
      const card = generateBurnProofBeaconCard({
        tokenSymbol: "PUMPRUN",
        burnTxHash: "0x85f91234567890abcdef85f91234567890abcdef85f91234567890abcdef1234",
        burnedTokens: 2_500_000,
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        wethUsed: 0.025,
      });

      expect(card).toContain("LIVE ON-CHAIN BURN BEACON");
      expect(card).toContain("$PUMPRUN");
      expect(card).toContain("2,500,000 $PUMPRUN");
      expect(card).toContain("0.025000 WETH");
      expect(card).toContain("0x000000000000000000000000000000000000dEaD");
      expect(card).toContain("https://basescan.org/tx/0x85f91234567890abcdef85f91234567890abcdef85f91234567890abcdef1234");
      expect(card).toContain("https://dexscreener.com/base/0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    });

    it("2.2 should generate Dividend Proof Beacon card", () => {
      const card = generateDividendProofBeaconCard({
        tokenSymbol: "PUMPRUN",
        totalWeth: 0.05,
        holderCount: 42,
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      });

      expect(card).toContain("PASSIVE WETH DIVIDEND BEACON");
      expect(card).toContain("0.050000 WETH");
      expect(card).toContain("42 Top Holders");
      expect(card).toContain("No staking required");
    });

    it("2.3 should generate 10-Minute FOMO Jackpot Proof Beacon card", () => {
      const card = generateJackpotProofBeaconCard({
        tokenSymbol: "PUMPRUN",
        winnerAddress: "0x9876543210abcdef9876543210abcdef98765432",
        jackpotWeth: 0.035,
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      });

      expect(card).toContain("10-MINUTE FOMO JACKPOT WINNER");
      expect(card).toContain("0.035000 WETH");
      expect(card).toContain("0x9876...5432");
    });
  });

  describe("3. DexScreener Trending Multi-Wallet Maker Engine", () => {
    it("3.1 should execute simulated micro-buy rounds across rotating unique makers", async () => {
      const summary = await runTrendingBoostCycle({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        rounds: 5,
        microAmountEth: 0.0001,
        minDelayMs: 10,
        maxDelayMs: 30,
        isSimulated: true,
      });

      expect(summary.totalRoundsExecuted).toBe(5);
      expect(summary.uniqueMakersCount).toBeGreaterThanOrEqual(2);
      expect(summary.totalVolumeEth).toBeCloseTo(0.0005, 4);
      expect(summary.simulated).toBe(true);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("4. Integrated Flywheel Cycle with Beacon Card & Referral", () => {
    it("4.1 should return beaconCard and referral allocation in FlywheelCycleResult", async () => {
      const res = await executeFlywheelCycle({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        simulateOnly: true,
        customWethAmount: 0.10,
        referralAddress: "0x5555555555555555555555555555555555555555",
      });

      expect(res.success).toBe(true);
      expect(res.split.referralWeth).toBeCloseTo(0.005, 4); // 5% of 0.10 ETH
      expect(res.split.creatorWeth).toBeCloseTo(0.030, 4); // 30% of 0.10 ETH
      expect(res.beaconCard).toBeDefined();
      expect(res.beaconCard).toContain("LIVE ON-CHAIN BURN BEACON");
      expect(res.beaconCard).toContain("$PUMPRUN");
    });
  });
});
