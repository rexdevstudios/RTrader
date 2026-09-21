import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios, { AxiosError } from "axios";
import { buildBankrPayload, deployViaBankr, getBankrHeaders, BANKR_DEPLOY_URL } from "../src/modules/evm/bankr-deployer.ts";
import { confirmDeployment } from "../src/modules/deploy-guard.ts";
import { calculateRealizedPnl } from "../src/modules/reconciliation/onchain-reconciler.ts";
import { resetConfig } from "../src/config.ts";

const mockIdentity = {
  name: "Test Token",
  ticker: "TFIX",
  description: "Integration fix test",
  viralScore: 90,
  imagePrompt: "test",
  website: "https://test.com",
  twitter: "https://x.com/test",
  telegram: "https://t.me/test",
};

const mockAssets = {
  imageUrl: "https://img.test/logo.png",
  metadataUrl: "https://ipfs.test/meta.json",
  ipfsImageUri: "ipfs://test",
};

describe("Integration Correction Batch 1 — Regression Tests", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
    process.env.FIRECRAWL_API_KEY = "test";
    process.env.PINATA_JWT = "test";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_test_key";
    process.env.DEPLOY_MODE = "testnet";
    axiosPostSpy = spyOn(axios, "post");
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
    process.env = { ...originalEnv };
    resetConfig();
  });

  // === C3 REGRESSION: PumpFun testnet must set simulated: true ===
  it("C3 REGRESSION: PumpFun testnet deployment must return simulated: true and status: success", async () => {
    const { deployViaPumpFun } = await import("../src/modules/solana/pumpfun-deployer.ts");
    process.env.DEPLOY_MODE = "testnet";
    resetConfig();
    const result = await deployViaPumpFun(mockIdentity, mockAssets);
    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.status).toBe("success");
    expect(result.txHash).toBeDefined();
    expect(result.contractAddress).toBeDefined();

    // Deploy guard must detect simulation
    const confirmation = confirmDeployment(result, "solana");
    expect(confirmation.isSimulation).toBe(true);
    expect(confirmation.confirmed).toBe(false);
  });

  // === C2 REGRESSION: PumpFun error must include status ===
  it("C2 REGRESSION: PumpFun deployment failure must include status field", async () => {
    const { deployViaPumpFun } = await import("../src/modules/solana/pumpfun-deployer.ts");
    process.env.DEPLOY_MODE = "mainnet";
    // Use invalid key to force error
    process.env.SOLANA_PRIVATE_KEY = "invalid_key_that_will_cause_error";
    resetConfig();
    const result = await deployViaPumpFun(mockIdentity, mockAssets);
    expect(result.success).toBe(false);
    expect(result.status).toBeDefined();
    expect(["failed", "unknown"]).toContain(result.status);
  });

  // === C4 REGRESSION: PnL must not produce dimensionally invalid values ===
  it("C4 REGRESSION: PnL calculation without proceeds must return pnl_pending, not fabricated numbers", () => {
    // Scenario: entry/exit prices are in USD, but no actual proceeds available
    const result = calculateRealizedPnl({
      entryAmountTokens: 1000000n,
      exitAmountTokens: 1000000n,
      // Note: no entryCostNative, no exitProceedsNative
      entryPriceUsd: 0.0001,
      exitPriceUsd: 0.0002,
    });
    expect(result.pnlStatus).toBe("pnl_pending");
    expect(result.realizedPnl).toBeUndefined();
    // priceReturnPercent should still be calculated
    expect(result.priceReturnPercent).toBeDefined();
    expect(result.priceReturnPercent).toBeCloseTo(100, 0);
  });

  it("C4 REGRESSION: PnL with actual proceeds must calculate correctly", () => {
    const result = calculateRealizedPnl({
      entryAmountTokens: 1000000n,
      exitAmountTokens: 1000000n,
      entryCostNative: 0.05,
      exitProceedsNative: 0.10,
      entryPriceUsd: 0.0001,
      exitPriceUsd: 0.0002,
    });
    expect(result.pnlStatus).toBe("calculated");
    expect(result.realizedPnl).toBeCloseTo(0.05, 4);
    expect(result.priceReturnPercent).toBeCloseTo(100, 0);
  });

  // === H1/H2 REGRESSION: Bankr chain routing must use override chain ===
  it("H1 REGRESSION: deployViaBankr must use overrides.chain instead of global BANKR_CHAIN", async () => {
    process.env.BANKR_CHAIN = "base";
    resetConfig();

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
        poolId: "pool_test",
        chain: "robinhood",
        simulated: true,
      },
    });

    // Override chain to robinhood even though global is base
    const result = await deployViaBankr(mockIdentity, mockAssets, {
      chain: "robinhood",
      simulateOnly: true,
    });

    expect(result.success).toBe(true);
    // Verify the payload sent to axios used robinhood, not base
    const sentPayload = axiosPostSpy.mock.calls[0][1];
    expect(sentPayload.chain).toBe("robinhood");
  });

  it("H2 REGRESSION: buildBankrPayload must accept chain parameter", () => {
    const payload = buildBankrPayload(mockIdentity, mockAssets, { chain: "robinhood" });
    expect(payload.chain).toBe("robinhood");

    const payloadBase = buildBankrPayload(mockIdentity, mockAssets, { chain: "base" });
    expect(payloadBase.chain).toBe("base");
  });

  it("H3 REGRESSION: deployViaBankr in testnet mode falls back to local simulation when remote 403 is received", async () => {
    process.env.DEPLOY_MODE = "testnet";
    resetConfig();

    const err403 = new AxiosError("Forbidden");
    err403.response = {
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: {} as any,
      data: { error: "Token launch requires approved wallet" },
    };
    axiosPostSpy.mockRejectedValueOnce(err403);

    const result = await deployViaBankr(mockIdentity, mockAssets, {
      chain: "base",
    });

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.status).toBe("success");
    expect(result.contractAddress).toMatch(/^0x[a-f0-9]{40}$/);
    expect(result.txHash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
