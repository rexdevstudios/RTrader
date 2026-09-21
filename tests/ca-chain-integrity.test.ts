/**
 * tests/ca-chain-integrity.test.ts
 *
 * Whitebox Test Suite:
 * 1. Verifies Strict CA-to-Chain Type Guard (rejects mismatched networks and non-hex EVM addresses).
 * 2. Verifies Token Resolution Priority (ensures genuine live on-chain deployments beat simulated logs).
 * 3. Verifies JavaScript Syntax Integrity across all sectors via new Function(js).
 */

import { describe, test, expect } from "bun:test";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { isLiveDeployment } from "../src/modules/fleet/fleet-registry.ts";
import * as fs from "fs";
import * as path from "path";

describe("Whitebox: CA-to-Chain Integrity & JS Engine Syntax Guarantee", () => {
  const testOutputDir = path.join(process.cwd(), "sites", "test_whitebox_integrity");

  test("1.1 should reject invalid EVM contract addresses for Base chain", async () => {
    await expect(
      generateTokenWebsite({
        ticker: "BADCA",
        name: "Bad CA Token",
        contractAddress: "pumpsq998hv5kr",
        chainName: "base",
        chainId: 8453,
        siteOutputDir: testOutputDir,
      })
    ).rejects.toThrow(/Invalid EVM Contract Address for chain base/);

    await expect(
      generateTokenWebsite({
        ticker: "SHORTCA",
        name: "Short CA Token",
        contractAddress: "0x1234",
        chainName: "base",
        chainId: 8453,
        siteOutputDir: testOutputDir,
      })
    ).rejects.toThrow(/Invalid EVM Contract Address for chain base/);
  });

  test("1.2 should reject 0x-prefixed addresses for Solana chain", async () => {
    await expect(
      generateTokenWebsite({
        ticker: "SOLBAD",
        name: "Solana Bad CA",
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        chainName: "solana",
        chainId: 101,
        siteOutputDir: testOutputDir,
      })
    ).rejects.toThrow(/Invalid Solana Contract Address/);
  });

  test("1.3 should classify genuine on-chain Base deployment as LIVE and mock simulation as non-LIVE", () => {
    const liveBaseLog = {
      id: 5764,
      chain: "base",
      ticker: "PUMPRUN",
      tokenName: "Pump Hill Runner",
      contractAddr: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      txHash: "0x85f9c6ad37917ac660678df25a6d0fcfbfcdde1de3d09b8316b08d29c9809279",
      status: "confirmed",
      simulated: false,
    };

    const simulatedSolanaLog = {
      id: 11836,
      chain: "solana",
      ticker: "PUMPRUN",
      tokenName: "Pump Runner",
      contractAddr: "pumpsq998hv5kr",
      txHash: null,
      status: "unknown",
      simulated: true,
    };

    expect(isLiveDeployment(liveBaseLog)).toBe(true);
    expect(isLiveDeployment(simulatedSolanaLog)).toBe(false);
  });

  test("1.4 should generate syntactically valid JavaScript (new Function) with 0 errors across sectors", async () => {
    const testCases = [
      {
        ticker: "PUMPRUN",
        name: "Pump Hill Runner",
        ca: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        chain: "base",
        customSector: "DEFI_TREASURY" as const,
      },
      {
        ticker: "AGENTAI",
        name: "Agent AI Core",
        ca: "0x1111111111111111111111111111111111111111",
        chain: "base",
        customSector: "AI_AGENT" as const,
      },
      {
        ticker: "MEMECOIN",
        name: "Viral Meme Coin",
        ca: "0x2222222222222222222222222222222222222222",
        chain: "base",
        customSector: "VIRAL_MEME" as const,
      },
    ];

    for (const tc of testCases) {
      const outDir = path.join(testOutputDir, tc.ticker.toLowerCase());
      const result = await generateTokenWebsite({
        ticker: tc.ticker,
        name: tc.name,
        contractAddress: tc.ca,
        chainName: tc.chain,
        chainId: 8453,
        customSector: tc.customSector,
        siteOutputDir: outDir,
      });

      const jsPath = path.join(result.siteDirectory, "parallax-3d.js");
      expect(fs.existsSync(jsPath)).toBe(true);

      const jsContent = fs.readFileSync(jsPath, "utf-8");

      let parseError: Error | null = null;
      try {
        new Function(jsContent);
      } catch (err: any) {
        parseError = err;
      }
      expect(parseError).toBeNull();
      expect(jsContent).not.toContain("baseUrl.replace(//");
      expect(jsContent).toContain("const secs = String(remainingSeconds % 60)");
    }
  }, 35000);
});
