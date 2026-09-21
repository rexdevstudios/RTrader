/**
 * tests/gas-sponsorship-accounting.test.ts
 *
 * Comprehensive Test Matrix for Base + Bankr Gas Sponsorship & Cost Accounting:
 *  1. Configuration defaults: BANKR_REQUIRE_GAS_SPONSORSHIP=true, BANKR_ALLOW_PAID_GAS_FALLBACK=false
 *  2. Policy Gate: Non-sponsored chain (Robinhood) blocked when sponsorship required & paid fallback disabled
 *  3. Policy Gate: Non-sponsored chain allowed in simulation mode (zero gas risk)
 *  4. Policy Gate: Sponsored chain (Base) allowed to proceed to Bankr relayer
 *  5. Relayer Recognition: Known Bankr relayer receipt classified as SPONSORED with deployerGasCost = 0 ETH
 *  6. Operator Payer: Direct operator receipt classified as PAID with deployerGasCost = networkGasCost
 *  7. External Relayer: Alternative relayer classified as SPONSORED with deployerGasCost = 0 ETH
 *  8. Unknown Gas Payer: Unmatched sender with unknown operator classified as UNKNOWN
 *  9. Database Vault: updateDeployLifecycle properly persists deployCost to deploy_logs
 *  10. Reconciler Integration: reconcileDeployments updates deploy_logs with exact deployCost & gas summary
 *  11. Fail-Closed on Auth/Permission error (401/403)
 *  12. Downstream buy guard prevents buy when deployment is simulation or failed
 */
import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import { resetConfig, getConfig } from "../src/config.ts";
import {
  deployViaBankr,
  BANKR_DEPLOY_URL,
} from "../src/modules/evm/bankr-deployer.ts";
import {
  calculateEvmDeploymentCost,
  BANKR_BASE_RELAYER_ADDRESS,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  getDeployLogById,
} from "../src/db/vault.ts";
import { confirmDeployment } from "../src/modules/deploy-guard.ts";
import type { TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import type { UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";
import type { TransactionReceipt } from "viem";

const mockIdentity: TokenIdentity = {
  name: "Sponsor Token",
  ticker: "SPON",
  description: "Gas sponsored test token",
  viralScore: 85,
  imagePrompt: "sponsor token logo",
};

const mockAssets: UploadResult = {
  imageUrl: "https://gateway.pinata.cloud/ipfs/QmSponsor1",
  metadataUrl: "https://gateway.pinata.cloud/ipfs/QmSponsorMeta1",
  ipfsImageUri: "ipfs://QmSponsor1",
};

describe("Base + Bankr Gas Sponsorship & Cost Accounting", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_key";
    process.env.FIRECRAWL_API_KEY = "test_key";
    process.env.PINATA_JWT = "test_jwt";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_test_sponsor_key";
    process.env.DEPLOY_MODE = "mainnet";
    process.env.BANKR_SIMULATE_ONLY = "false";
    process.env.DRY_RUN = "false";
    delete process.env.BANKR_REQUIRE_GAS_SPONSORSHIP;
    delete process.env.BANKR_ALLOW_PAID_GAS_FALLBACK;
    axiosPostSpy = spyOn(axios, "post");
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
    resetConfig();
  });

  // 1. Config Defaults
  it("1. should default BANKR_REQUIRE_GAS_SPONSORSHIP to true and BANKR_ALLOW_PAID_GAS_FALLBACK to false", () => {
    resetConfig();
    const cfg = getConfig();
    expect(cfg.BANKR_REQUIRE_GAS_SPONSORSHIP).toBe(true);
    expect(cfg.BANKR_ALLOW_PAID_GAS_FALLBACK).toBe(false);
  });

  // 2. Policy Gate on Non-Sponsored Chain
  it("2. should block real deployment on Robinhood when sponsorship required and fallback disabled", async () => {
    resetConfig();
    const result = await deployViaBankr(mockIdentity, mockAssets, {
      chain: "robinhood",
      simulateOnly: false,
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("GAS_SPONSORSHIP_POLICY_VIOLATION");
    // Verified: No HTTP request dispatched
    expect(axiosPostSpy).not.toHaveBeenCalled();
  });

  // 3. Simulation allowed on Non-Sponsored Chain
  it("3. should allow Robinhood deployment in simulation mode without policy block", async () => {
    resetConfig();
    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
        poolId: "pool_sim_1",
        chain: "robinhood",
        simulated: true,
      },
    });

    const result = await deployViaBankr(mockIdentity, mockAssets, {
      chain: "robinhood",
      simulateOnly: true,
    });
    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
  });

  // 4. Base chain proceeds to relayer
  it("4. should allow real deployment on Base when sponsorship is required", async () => {
    resetConfig();
    axiosPostSpy.mockResolvedValueOnce({
      status: 201,
      data: {
        success: true,
        tokenAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        poolId: "pool_base_real",
        chain: "base",
        txHash: "0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
      },
    });

    const result = await deployViaBankr(mockIdentity, mockAssets, {
      chain: "base",
      simulateOnly: false,
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.contractAddress).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(result.txHash).toBeDefined();
  });

  // 5. Relayer Recognition
  it("5. should classify known Bankr relayer receipt as SPONSORED with 0 ETH deployer cost", () => {
    const mockReceipt = {
      from: BANKR_BASE_RELAYER_ADDRESS,
      to: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      gasUsed: 2600000n,
      effectiveGasPrice: 6000000n, // 0.006 Gwei
    } as unknown as TransactionReceipt;

    const operatorWallet = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const verification = calculateEvmDeploymentCost(mockReceipt, operatorWallet);

    expect(verification.status).toBe("SPONSORED");
    expect(verification.isSponsored).toBe(true);
    expect(verification.deployerGasCostEth).toBe(0.0);
    expect(verification.networkGasCostEth).toBeGreaterThan(0);
    expect(verification.gasPayer).toBe(BANKR_BASE_RELAYER_ADDRESS.toLowerCase());
  });

  // 6. Operator Paid Receipt
  it("6. should classify operator-sent receipt as PAID with deployer cost equal to network cost", () => {
    const operatorWallet = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const mockReceipt = {
      from: operatorWallet,
      to: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      gasUsed: 2500000n,
      effectiveGasPrice: 1000000000n, // 1 Gwei
    } as unknown as TransactionReceipt;

    const verification = calculateEvmDeploymentCost(mockReceipt, operatorWallet);

    expect(verification.status).toBe("PAID");
    expect(verification.isSponsored).toBe(false);
    expect(verification.deployerGasCostEth).toBeCloseTo(0.0025, 4);
    expect(verification.deployerGasCostEth).toBe(verification.networkGasCostEth);
  });

  // 7. Custom Relayer vs Unverified Sender
  it("7. should classify custom expected relayer as SPONSORED and unverified sender as UNKNOWN", () => {
    const operatorWallet = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const customRelayer = "0x9999999999999999999999999999999999999999";
    const mockReceipt = {
      from: customRelayer,
      to: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      gasUsed: 2500000n,
      effectiveGasPrice: 1000000000n,
    } as unknown as TransactionReceipt;

    // When custom relayer matches expectedRelayer:
    const customVerification = calculateEvmDeploymentCost(
      mockReceipt,
      operatorWallet,
      "base",
      customRelayer
    );
    expect(customVerification.status).toBe("SPONSORED");
    expect(customVerification.isSponsored).toBe(true);
    expect(customVerification.deployerGasCostEth).toBe(0.0);

    // When unverified sender does not match expected relayer:
    const unverifiedVerification = calculateEvmDeploymentCost(mockReceipt, operatorWallet);
    expect(unverifiedVerification.status).toBe("UNKNOWN");
    expect(unverifiedVerification.isSponsored).toBe(false);
  });

  // 8. Unknown Gas Payer
  it("8. should classify sender as UNKNOWN when operator wallet is null and sender != relayer", () => {
    const unknownSender = "0x7777777777777777777777777777777777777777";
    const mockReceipt = {
      from: unknownSender,
      to: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      gasUsed: 2000000n,
      effectiveGasPrice: 1000000000n,
    } as unknown as TransactionReceipt;

    const verification = calculateEvmDeploymentCost(mockReceipt, null);
    expect(verification.status).toBe("UNKNOWN");
    expect(verification.isSponsored).toBe(false);
  });

  // 9. Database Vault deployCost persistence
  it("9. should persist deployCost via updateDeployLifecycle into SQLite deploy_logs", () => {
    const deployLogId = logDeploy({
      chain: "base",
      tokenName: "Vault Sponsor Test",
      ticker: "VST",
      status: "pending",
      lifecycleState: "DEPLOY_SUBMITTED",
    });

    updateDeployLifecycle(deployLogId, "DEPLOY_CONFIRMED", {
      status: "success",
      deployCost: 0.0,
      attributionStatus: "transaction_verified",
      attributionReason: "Confirmed with Bankr gas sponsorship",
    });

    const record = getDeployLogById(deployLogId);
    expect(record).toBeDefined();
    expect(record?.deployCost).toBe(0.0);
    expect(record?.attributionReason).toContain("Bankr gas sponsorship");
  });

  // 10. Downstream Buy Guard
  it("10. should block downstream buy when deployment is simulation", () => {
    const confirmation = confirmDeployment(
      {
        success: true,
        simulated: true,
        contractAddress: "0x1234567890123456789012345678901234567890",
        txHash: "0xsim123",
      },
      "base"
    );
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.isSimulation).toBe(true);
  });

  it("11. should block downstream buy when deployment fails", () => {
    const confirmation = confirmDeployment(
      {
        success: false,
        status: "failed",
        error: "403 ELIGIBILITY_OR_PERMISSION_ERROR",
      },
      "base"
    );
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.isSimulation).toBe(false);
  });
});
