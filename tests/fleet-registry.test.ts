import { describe, it, expect } from "bun:test";
import {
  isLiveDeployment,
  isSimulatedDeployment,
  isTestFixture,
  classifyDeployment,
  getProductionFleet,
} from "../src/modules/fleet/fleet-registry.ts";
import {
  generateIrresistibleOffer,
  formatOfferDeckMarkdown,
  saveOfferDeckMarkdown,
} from "../src/modules/growth/token-offer-generator.ts";
import * as fs from "fs";
import * as path from "path";

describe("Canonical Fleet Registry & Deployment State Classifier", () => {
  const liveEvmLog = {
    id: 5764,
    chain: "base",
    tokenName: "Pump Hill Runner",
    ticker: "PUMPRUN",
    contractAddr: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
    txHash: "0x85f9c6ad37917ac660678df25a6d0fcfbfcdde1de3d09b8316b08d29c9809279",
    status: "confirmed" as const,
    lifecycleState: "DEPLOY_CONFIRMED",
    simulated: false,
  };

  const liveSolanaLog = {
    id: 12000,
    chain: "solana",
    tokenName: "Sol Real Runner",
    ticker: "SOLREAL",
    contractAddr: "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRH",
    txHash: "5KnrjJmG...realSignatureOfSolanaTransactionLength88CharsLongForMainnetPumpFunTradeLocal",
    status: "confirmed" as const,
    lifecycleState: "DEPLOY_CONFIRMED",
    simulated: false,
  };

  const simEvmLog = {
    id: 10556,
    chain: "base",
    tokenName: "Omni Chain Chad",
    ticker: "OMCHAD",
    contractAddr: "0x2a6afc7fcecf70e955085a1b19ed215c5aa08b05",
    txHash: "0x5ef143b8b12c439850efdf6cce4aa017a9c08d89b26df41e56913997d85af4e5",
    status: "unknown" as const,
    lifecycleState: "SIMULATED",
    simulated: true,
  };

  const simSolanaLog = {
    id: 10073,
    chain: "solana",
    tokenName: "Doge Cyber",
    ticker: "DCYBER",
    contractAddr: "pumpxti9h9imezh",
    txHash: "sim_1788733825867_ze67o0m0rp",
    status: "unknown" as const,
    lifecycleState: "SIMULATED",
    simulated: true,
  };

  const testFixtureLog = {
    id: 99999,
    chain: "base",
    tokenName: "Test Fixture Token",
    ticker: "TEST",
    contractAddr: null as any,
    txHash: null as any,
    status: "pending" as const,
    lifecycleState: "DEPLOY_SUBMITTED",
    simulated: false,
  };

  const failedLog = {
    id: 88888,
    chain: "base",
    tokenName: "Failed Token",
    ticker: "FAIL",
    contractAddr: "0x0000000000000000000000000000000000000000",
    txHash: "0x1234",
    status: "failed" as const,
    lifecycleState: "FAILED",
    simulated: false,
  };

  it("1. isLiveDeployment should strictly classify confirmed on-chain tokens", () => {
    expect(isLiveDeployment(liveEvmLog)).toBe(true);
    expect(isLiveDeployment(liveSolanaLog)).toBe(true);

    expect(isLiveDeployment(simEvmLog)).toBe(false);
    expect(isLiveDeployment(simSolanaLog)).toBe(false);
    expect(isLiveDeployment(testFixtureLog)).toBe(false);
    expect(isLiveDeployment(failedLog)).toBe(false);
    expect(isLiveDeployment(null)).toBe(false);
    expect(isLiveDeployment(undefined)).toBe(false);
  });

  it("2. isSimulatedDeployment should identify valid dry-runs with addresses", () => {
    expect(isSimulatedDeployment(simEvmLog)).toBe(true);
    expect(isSimulatedDeployment(simSolanaLog)).toBe(true);

    expect(isSimulatedDeployment(liveEvmLog)).toBe(false);
    expect(isSimulatedDeployment(testFixtureLog)).toBe(false);
  });

  it("3. isTestFixture should identify rows without valid contract addresses", () => {
    expect(isTestFixture(testFixtureLog)).toBe(true);
    expect(isTestFixture({ ...testFixtureLog, contractAddr: "" })).toBe(true);
    expect(isTestFixture({ ...testFixtureLog, contractAddr: "n/a" })).toBe(true);

    expect(isTestFixture(liveEvmLog)).toBe(false);
    expect(isTestFixture(simEvmLog)).toBe(false);
  });

  it("4. classifyDeployment should return correct canonical category", () => {
    expect(classifyDeployment(liveEvmLog)).toBe("LIVE");
    expect(classifyDeployment(liveSolanaLog)).toBe("LIVE");
    expect(classifyDeployment(simEvmLog)).toBe("SIMULATED");
    expect(classifyDeployment(simSolanaLog)).toBe("SIMULATED");
    expect(classifyDeployment(testFixtureLog)).toBe("TEST_FIXTURE");
    expect(classifyDeployment(failedLog)).toBe("FAILED");
  });

  it("5. getProductionFleet should exclude test fixtures without CA", () => {
    const fleet = getProductionFleet();
    expect(Array.isArray(fleet.live)).toBe(true);
    expect(Array.isArray(fleet.simulated)).toBe(true);
    expect(Array.isArray(fleet.all)).toBe(true);

    // Any token in fleet must have non-empty contractAddr
    for (const token of fleet.all) {
      expect(token.contractAddr).toBeDefined();
      expect(token.contractAddr).not.toBe("");
      expect(token.contractAddr).not.toBe("n/a");
    }
  });

  it("6. formatOfferDeckMarkdown and saveOfferDeckMarkdown should be idempotent", () => {
    const offer = generateIrresistibleOffer({
      name: "Parity Test",
      ticker: "PARITY",
      contractAddress: "0x1234567890123456789012345678901234567890",
      chain: "base",
    });

    const md = formatOfferDeckMarkdown(offer);
    expect(md).toContain("# Marketing & Investor Offer Deck: $PARITY (Parity Test)");
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("## Twitter / X Launch Thread");

    const tmpDir = path.resolve(process.cwd(), "scratch_test_promotions");
    const saveRes1 = saveOfferDeckMarkdown(offer, { outputDir: tmpDir, chainSuffix: true });
    expect(saveRes1.success).toBe(true);
    expect(fs.existsSync(saveRes1.primaryPath!)).toBe(true);
    expect(fs.existsSync(saveRes1.chainPath!)).toBe(true);

    // Second call should overwrite cleanly without error (idempotent)
    const saveRes2 = saveOfferDeckMarkdown(offer, { outputDir: tmpDir, chainSuffix: true });
    expect(saveRes2.success).toBe(true);

    // Cleanup test folder
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
