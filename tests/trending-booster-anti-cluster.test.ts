import { describe, it, expect } from "bun:test";
import {
  validateFundingCluster,
  runTrendingBoostCycle,
  executeDirectOnChainMicroBuy,
  applyOrganicAmountJitter,
} from "../src/modules/growth/trending-booster.ts";
import { saveWallet, getWalletKeyByAddress } from "../src/db/vault.ts";

describe("Anti-Cluster & Multi-Wallet Rotation Suite", () => {
  const mockDevAddress = "0x946657d17c7e83052d50634d9da6ff3fc46b418a";
  const mockIndependentAddress = "0x1111111111111111111111111111111111111111";

  describe("1. validateFundingCluster", () => {
    it("should flag maker address that directly matches known dev address", () => {
      const result = validateFundingCluster(mockDevAddress, [mockDevAddress]);
      expect(result.isClustered).toBe(true);
      expect(result.warning).toContain("CLUSTER WARNING");
      expect(result.recommendation).toContain("CEX");
    });

    it("should perform case-insensitive comparison for EVM addresses", () => {
      const upperDev = mockDevAddress.toUpperCase();
      const lowerDev = mockDevAddress.toLowerCase();
      const result = validateFundingCluster(upperDev, [lowerDev]);
      expect(result.isClustered).toBe(true);
    });

    it("should pass independent maker addresses with 0% cluster warning", () => {
      const result = validateFundingCluster(mockIndependentAddress, [mockDevAddress]);
      expect(result.isClustered).toBe(false);
      expect(result.warning).toBeUndefined();
      expect(result.recommendation).toContain("Bebas");
    });

    it("should handle empty or blank addresses safely without throwing", () => {
      const result = validateFundingCluster("", [mockDevAddress]);
      expect(result.isClustered).toBe(false);
    });
  });

  describe("2. Wallet Key Retrieval from Vault", () => {
    it("should save and retrieve private key by address from vault", () => {
      const testAddr = "0x9999999999999999999999999999999999999999";
      const testKey = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      saveWallet("base", testAddr, testKey);

      const retrievedKey = getWalletKeyByAddress(testAddr);
      expect(retrievedKey).toBe(testKey);

      // Case-insensitive check
      const lowerRetrieved = getWalletKeyByAddress(testAddr.toLowerCase());
      expect(lowerRetrieved).toBe(testKey);
    });

    it("should return null for non-existent address in vault", () => {
      const nonExistent = "0x0000000000000000000000000000000000009999";
      expect(getWalletKeyByAddress(nonExistent)).toBeNull();
    });
  });

  describe("3. Multi-Maker Simulated Cycle Execution", () => {
    it("should rotate across multiple unique makers in simulated mode", async () => {
      const summary = await runTrendingBoostCycle({
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenSymbol: "PUMPRUN",
        rounds: 5,
        microAmountEth: 0.0001,
        minDelayMs: 10,
        maxDelayMs: 20,
        isSimulated: true,
      });

      expect(summary.simulated).toBe(true);
      expect(summary.totalRoundsExecuted).toBe(5);
      expect(summary.uniqueMakersCount).toBeGreaterThanOrEqual(2);
      expect(summary.totalVolumeEth).toBeGreaterThan(0);
    });

    it("should produce valid simulated on-chain swap response with 0 gas", async () => {
      const res = await executeDirectOnChainMicroBuy(
        "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        0.0001,
        { id: "maker-1", address: mockIndependentAddress },
        true
      );

      expect(res.success).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.txHash).toMatch(/^0xsim_/);
      expect(res.makerAddress).toBe(mockIndependentAddress);
    });
  });
});
