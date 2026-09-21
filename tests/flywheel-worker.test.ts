/**
 * tests/flywheel-worker.test.ts
 *
 * Dedicated Unit & Integration Test Suite for:
 * 1. 4-Pillar Fee Split Mathematics (35% Creator, 30% Buyback & Burn, 20% Dividends, 15% Jackpot).
 * 2. Zero-Leakage Invariant (Rounding residue absorption by creator).
 * 3. 5-Pillar Affiliate Referral Split (5% referral deducted from creator).
 * 4. Autonomous Operator Gas Auto-Refill Guard (Triggered when balance < 0.0003 ETH).
 * 5. Fail-Safe Beacon Proof Card Generation & Dispatch.
 */

import { describe, test, expect } from "bun:test";
import {
  calculateFeeSplit,
  generateFlywheelAnnouncementCard,
  generateBurnProofBeaconCard,
  generateDividendProofBeaconCard,
  generateJackpotProofBeaconCard,
  executeFlywheelCycle,
} from "../src/modules/growth/flywheel-engine.ts";
import {
  evaluateOperatorRefillNeed,
  calculateRefillAllocation,
  executeOperatorAutoRefill,
  DEFAULT_OPERATOR_MIN_REFILL_THRESHOLD_ETH,
  DEFAULT_OPERATOR_TARGET_REFILL_ETH,
} from "../src/modules/treasury/auto-refill-guard.ts";
import { broadcastFlywheelBurnAlert } from "../src/modules/social/beacon-broadcaster.ts";

describe("Flywheel Engine & Autonomous Gas Recycler Suite", () => {
  describe("1. 4-Pillar Fee Split Mathematics & Zero Leakage", () => {
    test("should cleanly calculate 4-pillar split for round amounts (0.10 WETH)", () => {
      const split = calculateFeeSplit(0.10);

      expect(split.totalClaimedWeth).toBe(0.10);
      expect(split.creatorWeth).toBe(0.035);  // 35%
      expect(split.buybackWeth).toBe(0.030);  // 30%
      expect(split.dividendWeth).toBe(0.020); // 20%
      expect(split.jackpotWeth).toBe(0.015);  // 15%
      expect(split.referralWeth).toBeUndefined();

      const sum = Number(
        (split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth).toFixed(8)
      );
      expect(sum).toBe(0.10);
    });

    test("should absorb floating point residue into creator share without leakage", () => {
      // 0.03333333 has repeating fractional components
      const testAmount = 0.03333333;
      const split = calculateFeeSplit(testAmount);

      const sum = Number(
        (split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth).toFixed(8)
      );
      expect(sum).toBe(testAmount);
      expect(split.roundingResidue).toBeDefined();
    });

    test("should return zeroes gracefully when claimed amount is 0 or negative", () => {
      const splitZero = calculateFeeSplit(0);
      expect(splitZero.totalClaimedWeth).toBe(0);
      expect(splitZero.creatorWeth).toBe(0);
      expect(splitZero.buybackWeth).toBe(0);

      const splitNeg = calculateFeeSplit(-0.5);
      expect(splitNeg.totalClaimedWeth).toBe(0);
    });
  });

  describe("2. 5-Pillar Affiliate Referral Deduction", () => {
    test("should deduct 5% referral from creator cash when referral address is present", () => {
      const affiliate = "0xAffiliateReferrer_1234567890";
      const split = calculateFeeSplit(0.10, undefined, affiliate);

      expect(split.totalClaimedWeth).toBe(0.10);
      expect(split.referralAddress).toBe(affiliate);
      expect(split.referralWeth).toBe(0.005); // 5%
      expect(split.creatorWeth).toBe(0.030);  // 35% - 5% = 30%
      expect(split.buybackWeth).toBe(0.030);  // 30%
      expect(split.dividendWeth).toBe(0.020); // 20%
      expect(split.jackpotWeth).toBe(0.015);  // 15%

      const sum = Number(
        (split.creatorWeth + split.buybackWeth + split.dividendWeth + split.jackpotWeth + (split.referralWeth || 0)).toFixed(8)
      );
      expect(sum).toBe(0.10);
    });
  });

  describe("3. Autonomous Operator Gas Auto-Refill Guard", () => {
    test("should flag needsRefill: true when operator balance is below threshold (0.0003 ETH)", () => {
      const evaluation = evaluateOperatorRefillNeed(0.00015, 0.0003, 0.001);
      expect(evaluation.needsRefill).toBe(true);
      expect(evaluation.currentBalanceEth).toBe(0.00015);
      expect(evaluation.thresholdEth).toBe(0.0003);
      expect(evaluation.targetBalanceEth).toBe(0.001);
      expect(evaluation.deficitEth).toBe(0.00085);
    });

    test("should flag needsRefill: false when operator balance is above threshold (0.000653 ETH)", () => {
      const evaluation = evaluateOperatorRefillNeed(0.000653, 0.0003, 0.001);
      expect(evaluation.needsRefill).toBe(false);
      expect(evaluation.deficitEth).toBe(0);
    });

    test("calculateRefillAllocation should allocate only up to deficit from creator cash", () => {
      // Creator cash 0.035 WETH, Deficit 0.00085 ETH
      const alloc = calculateRefillAllocation(0.035, 0.00085);
      expect(alloc.allocatedWeth).toBe(0.00085);
      expect(alloc.remainingCreatorCashWeth).toBe(0.03415);
      expect(alloc.fullDeficitCovered).toBe(true);
    });

    test("calculateRefillAllocation should cap allocation to available creator cash if deficit exceeds it", () => {
      // Creator cash only 0.0005 WETH, Deficit 0.00085 ETH
      const alloc = calculateRefillAllocation(0.0005, 0.00085);
      expect(alloc.allocatedWeth).toBe(0.0005);
      expect(alloc.remainingCreatorCashWeth).toBe(0);
      expect(alloc.fullDeficitCovered).toBe(false);
    });

    test("executeOperatorAutoRefill should record refill in treasury_ledger when balance is low", async () => {
      const result = await executeOperatorAutoRefill({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        creatorCashWeth: 0.035,
        _injectedBalanceEth: 0.00015, // Below 0.0003 threshold
        isSimulated: true,
      });

      expect(result.refillTriggered).toBe(true);
      expect(result.evaluation.needsRefill).toBe(true);
      expect(result.allocation?.allocatedWeth).toBe(0.00085);
      expect(result.refillTxHash).toBeDefined();
      expect(result.refillTxHash?.startsWith("sim_refill_")).toBe(true);
    });

    test("executeOperatorAutoRefill should skip refill when balance is healthy", async () => {
      const result = await executeOperatorAutoRefill({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        creatorCashWeth: 0.035,
        _injectedBalanceEth: 0.000653, // Current live operator balance
        isSimulated: true,
      });

      expect(result.refillTriggered).toBe(false);
      expect(result.evaluation.needsRefill).toBe(false);
      expect(result.allocation).toBeUndefined();
    });
  });

  describe("4. Proof Beacon Generation & Broadcaster Resilience", () => {
    test("generateBurnProofBeaconCard should generate informative card with DexScreener link", () => {
      const card = generateBurnProofBeaconCard({
        tokenSymbol: "PUMPRUN",
        burnTxHash: "0x4c95f87be7adbcde19024f21cfc839c4d216f4cf40f951e944747ee8a19246a4",
        burnedTokens: 1_250_000,
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        wethUsed: 0.030,
      });

      expect(card).toContain("$PUMPRUN");
      expect(card).toContain("1,250,000 $PUMPRUN");
      expect(card).toContain("0x000000000000000000000000000000000000dEaD");
      expect(card).toContain("https://dexscreener.com/base/0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    });

    test("broadcastFlywheelBurnAlert should handle both tokenSymbol and ticker aliases without throwing", async () => {
      // Test with tokenSymbol
      const res1 = await broadcastFlywheelBurnAlert({
        tokenSymbol: "TESTCOIN",
        contractAddress: "0x1111111111111111111111111111111111111111",
        burnedTokens: 500_000,
        wethUsed: 0.015,
        burnTxHash: "sim_tx_123",
        isSimulated: true,
      });
      expect(res1.success).toBe(true);
      expect(res1.messageText).toContain("TESTCOIN");

      // Test with ticker alias (regression prevention for scripts/run-flywheel-worker.ts)
      const res2 = await broadcastFlywheelBurnAlert({
        ticker: "TICKERCOIN",
        contractAddress: "0x1111111111111111111111111111111111111111",
        burnedTokens: 500_000,
        wethUsed: 0.015,
        burnTxHash: "sim_tx_456",
        isSimulated: true,
      } as any);
      expect(res2.success).toBe(true);
      expect(res2.messageText).toContain("TICKERCOIN");
    });
  });

  describe("5. End-to-End executeFlywheelCycle Integration", () => {
    test("should execute cycle with customWethAmount and trigger auto-refill evaluation", async () => {
      const res = await executeFlywheelCycle({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        customWethAmount: 0.05,
        simulateOnly: true,
      });

      expect(res.success).toBe(true);
      expect(res.tokenSymbol).toBe("PUMPRUN");
      expect(res.totalClaimedWeth).toBe(0.05);
      expect(res.split.creatorWeth).toBe(0.0175); // 35%
      expect(res.split.buybackWeth).toBe(0.015);  // 30%
      expect(res.split.dividendWeth).toBe(0.010); // 20%
      expect(res.split.jackpotWeth).toBe(0.0075); // 15%
      expect(res.event?.status).toBe("completed");
    });
  });
});
