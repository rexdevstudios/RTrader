/**
 * tests/operational-scripts-integration.test.ts
 *
 * Verifies integration between operational scripts, environment configuration,
 * pre-flight safety gates, predictive CA extraction, and zero-capital options.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import { resetConfig, getConfig } from "../src/config.ts";
import {
  verifyDeploymentSafetyParameters,
  predictDeploymentAddress,
} from "../src/modules/deploy-guard.ts";
import { readFileSync } from "fs";
import { resolve } from "path";

const mockIdentity = {
  name: "Safe Operational Meme",
  ticker: "SAFEMEME",
  description: "A community fair launch token designed for 0% tax and organic volume.",
  viralScore: 88,
  imagePrompt: "futuristic gold vault with glowing community keys",
  website: "https://safememe.community",
  twitter: "https://x.com/safememe_base",
  telegram: "https://t.me/safememe_portal",
};

const mockAssets = {
  imageUrl: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  metadataUrl: "https://ipfs.io/ipfs/bafkreicysg23kiwv34eg2d7qctiohcfqn7t6wfvi5bcfgq2yt42ydp54he",
  ipfsImageUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
};

describe("Operational Scripts & Configuration Integration Tests", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_ai_key";
    process.env.FIRECRAWL_API_KEY = "test_firecrawl";
    process.env.PINATA_JWT = "test_pinata";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.BANKR_API_KEY = "bk_usr_mock_live_key";
    process.env.DEPLOY_MODE = "testnet";
    axiosPostSpy = spyOn(axios, "post");
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
    resetConfig();
  });

  it("1. should parse SNIPER_ENABLED and SNIPE_WALLET_COUNT in config", () => {
    process.env.SNIPER_ENABLED = "false";
    process.env.SNIPE_WALLET_COUNT = "5";
    resetConfig();

    const cfg = getConfig();
    expect(cfg.SNIPER_ENABLED).toBe(false);
    expect(cfg.SNIPE_WALLET_COUNT).toBe(5);

    // Reset to defaults
    delete process.env.SNIPER_ENABLED;
    delete process.env.SNIPE_WALLET_COUNT;
    resetConfig();

    const defaultCfg = getConfig();
    expect(defaultCfg.SNIPER_ENABLED).toBe(true);
    expect(defaultCfg.SNIPE_WALLET_COUNT).toBe(3);
  });

  it("2. should ensure .env.example contains all required operational keys", () => {
    const envExamplePath = resolve(__dirname, "../.env.example");
    const content = readFileSync(envExamplePath, "utf-8");

    expect(content).toContain("SNIPER_ENABLED");
    expect(content).toContain("SNIPE_WALLET_COUNT");
    expect(content).toContain("SNIPE_SAFE_CAP_ETH");
    expect(content).toContain("BANKR_REQUIRE_GAS_SPONSORSHIP");
    expect(content).toContain("BASEDBOT_CHAT_ID");
  });

  it("3. should execute pre-flight safety verification for single deployment candidates", () => {
    const report = verifyDeploymentSafetyParameters(mockIdentity, mockAssets);
    expect(report.safe).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);

    // Unsafe candidate (missing valid ticker, invalid name, and description too short)
    const badReport = verifyDeploymentSafetyParameters(
      { ...mockIdentity, name: "X", ticker: "1", description: "short" },
      mockAssets
    );
    expect(badReport.safe).toBe(false);
    expect(badReport.score).toBeLessThan(70);
    expect(badReport.issues.length).toBeGreaterThanOrEqual(2);
    expect(badReport.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("4. should simulate predictive CA before single deployment execution", async () => {
    const mockPredictedAddress = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
    const mockPoolId = "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9";

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        tokenAddress: mockPredictedAddress,
        poolId: mockPoolId,
        chain: "base",
        simulated: true,
      },
    });

    const pred = await predictDeploymentAddress(mockIdentity, mockAssets, {
      chain: "base",
      apiKey: "bk_usr_mock_live_key",
    });

    expect(pred.success).toBe(true);
    expect(pred.predictedContractAddress).toBe(mockPredictedAddress);
    expect(pred.predictedPoolId).toBe(mockPoolId);
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);

    // Payload verification
    const callArgs = axiosPostSpy.mock.calls[0];
    expect(callArgs[1].simulateOnly).toBe(true);
    expect(callArgs[1].chain).toBe("base");
  });

  it("5. should verify that single deployment script imports deploy-guard modules", () => {
    const scriptPath = resolve(__dirname, "../scripts/execute-single-base-deployment.ts");
    const scriptContent = readFileSync(scriptPath, "utf-8");

    expect(scriptContent).toContain("verifyDeploymentSafetyParameters");
    expect(scriptContent).toContain("predictDeploymentAddress");
    expect(scriptContent).toContain("TEMPLAT BROADCAST KOMUNITAS");
  });

  it("6. should generate accurate dashboard data and render without errors", async () => {
    const { generateDashboardData, renderDashboard } = await import("../scripts/dashboard.ts");
    const data = generateDashboardData();

    expect(data.cfg).toBeDefined();
    expect(data.activeChains).toBeDefined();
    expect(data.modeName).toBeDefined();
    expect(Array.isArray(data.deployLogs)).toBe(true);
    expect(typeof data.totalAccruedWeth).toBe("number");

    // Spy on console.log to test rendering without throwing
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    expect(() => renderDashboard()).not.toThrow();
    logSpy.mockRestore();
  });
});
