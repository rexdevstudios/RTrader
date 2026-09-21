/**
 * tests/trending-booster.test.ts
 *
 * Automated regression test suite for DexScreener Trending Booster:
 *  1. Adaptive tiered micro-amount calculations based on pool liquidity.
 *  2. Organic amount jitter (+/- 12% randomness) to prevent robotic pattern detection.
 *  3. Simulated multi-wallet micro-maker execution (0 gas, instant verification).
 *  4. Direct swap fallback simulation safety.
 */

import { describe, it, expect } from "bun:test";
import {
  computeTieredMicroAmount,
  applyOrganicAmountJitter,
  runTrendingBoostCycle,
  executeDirectOnChainMicroBuy,
} from "../src/modules/growth/trending-booster.ts";

describe("DexScreener Trending Algorithm Booster Suite", () => {
  describe("1. Tiered Micro-Amount Calculation", () => {
    it("should return explicit custom amount when provided", () => {
      expect(computeTieredMicroAmount(10000, 0.0005)).toBe(0.0005);
      expect(computeTieredMicroAmount(0, 0.001)).toBe(0.001);
    });

    it("should calculate adaptive micro amounts based on pool liquidity", () => {
      // Zero or missing liquidity fallback
      expect(computeTieredMicroAmount(undefined)).toBe(0.0001);
      expect(computeTieredMicroAmount(0)).toBe(0.0001);

      // Low / Seed liquidity (<$5k) -> 0.00005 ETH to prevent price disruption
      expect(computeTieredMicroAmount(2000)).toBe(0.00005);
      expect(computeTieredMicroAmount(4999)).toBe(0.00005);

      // Medium liquidity ($5k - $25k) -> 0.0001 ETH standard
      expect(computeTieredMicroAmount(5000)).toBe(0.0001);
      expect(computeTieredMicroAmount(15000)).toBe(0.0001);
      expect(computeTieredMicroAmount(25000)).toBe(0.0001);

      // Deep liquidity (>$25k) -> 0.00025 ETH high visual impact
      expect(computeTieredMicroAmount(25001)).toBe(0.00025);
      expect(computeTieredMicroAmount(100000)).toBe(0.00025);
    });
  });

  describe("2. Organic Amount Jitter", () => {
    it("should apply variance within configured bounds (+/- 12%)", () => {
      const base = 0.0001;
      const variance = 0.12;
      const minExpected = base * (1 - variance);
      const maxExpected = base * (1 + variance);

      for (let i = 0; i < 50; i++) {
        const jittered = applyOrganicAmountJitter(base, variance);
        expect(jittered).toBeGreaterThanOrEqual(minExpected - 0.000001);
        expect(jittered).toBeLessThanOrEqual(maxExpected + 0.000001);
      }
    });

    it("should handle 0 or negative base amounts gracefully", () => {
      expect(applyOrganicAmountJitter(0)).toBe(0);
      expect(applyOrganicAmountJitter(-1)).toBe(-1);
    });
  });

  describe("3. Simulated On-Chain Micro-Buy", () => {
    it("should return simulated swap result instantly with unique txHash", async () => {
      const res = await executeDirectOnChainMicroBuy(
        "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        0.0001,
        { id: "maker-1", address: "0x1111111111111111111111111111111111111111" },
        true // isSimulated
      );

      expect(res.success).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.txHash).toBeDefined();
      expect(res.txHash?.startsWith("0xsim_")).toBe(true);
      expect(res.makerAddress).toBe("0x1111111111111111111111111111111111111111");
      expect(res.amountEth).toBe(0.0001);
    });
  });

  describe("4. Multi-Wallet Trending Boost Cycle Execution", () => {
    it("should execute multi-round simulated boost cycle and report accurate metrics", async () => {
      const summary = await runTrendingBoostCycle({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        rounds: 3,
        microAmountEth: 0.0001,
        minDelayMs: 10,
        maxDelayMs: 50,
        isSimulated: true,
      });

      expect(summary.tokenSymbol).toBe("PUMPRUN");
      expect(summary.tokenAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(summary.totalRoundsExecuted).toBe(3);
      expect(summary.uniqueMakersCount).toBeGreaterThanOrEqual(1);
      expect(summary.totalVolumeEth).toBeGreaterThan(0);
      expect(summary.simulated).toBe(true);
      expect(summary.durationMs).toBeGreaterThan(0);
    });
  });
});
