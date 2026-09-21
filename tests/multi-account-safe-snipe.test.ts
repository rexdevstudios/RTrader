import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import { Api } from "grammy";
import { resetConfig } from "../src/config.ts";
import {
  verifyDeploymentSafetyParameters,
  predictDeploymentAddress,
} from "../src/modules/deploy-guard.ts";
import {
  calculateSafeSnipeAmount,
  snipeNewToken,
  snipeMultiAccountToken,
} from "../src/modules/sniper/basedbot-sniper.ts";

describe("Safe Deployment Verification & Multi-Account BasedBot Snipe", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock_key";
    process.env.FIRECRAWL_API_KEY = "mock_key";
    process.env.PINATA_JWT = "mock_jwt";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_test_key";
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
    process.env.BASEDBOT_CHAT_ID = "@BasedOnBot";
    process.env.SNIPE_SAFE_CAP_ETH = "0.02";
    process.env.DEPLOY_MODE = "testnet";
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
  });

  // =========================================================================
  // 1. SAFETY VALIDATION (Rick Bot / TTF Bot Compliance)
  // =========================================================================
  it("1. should validate a complete, safe token metadata set with 100 score", () => {
    const report = verifyDeploymentSafetyParameters(
      {
        name: "Safe Runner",
        ticker: "SAFERUN",
        description: "A decentralized community meme runner token on Base.",
        website: "https://saferunner.xyz",
        twitter: "https://x.com/saferunner",
      },
      {
        imageUrl: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        metadataUrl: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/meta.json",
      }
    );

    expect(report.safe).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues.length).toBe(0);
    expect(report.checks.nameValid).toBe(true);
    expect(report.checks.tickerValid).toBe(true);
    expect(report.checks.descriptionValid).toBe(true);
    expect(report.checks.imagePinned).toBe(true);
    expect(report.checks.socialsComplete).toBe(true);
  });

  it("2. should reject invalid name, ticker, or missing image as unsafe", () => {
    const report = verifyDeploymentSafetyParameters(
      {
        name: "X", // too short (<2 chars)
        ticker: "invalid_lowercase", // must be uppercase alphanumeric
        description: "short",
      },
      {
        imageUrl: "", // missing image
      }
    );

    expect(report.safe).toBe(false);
    expect(report.issues.length).toBeGreaterThanOrEqual(3);
    expect(report.checks.nameValid).toBe(false);
    expect(report.checks.tickerValid).toBe(false);
    expect(report.checks.imagePinned).toBe(false);
  });

  it("3. should warn on incomplete socials and optionally fail in strict mode", () => {
    const lenientReport = verifyDeploymentSafetyParameters(
      {
        name: "Test Meme",
        ticker: "TESTM",
        description: "Valid description for the test meme token.",
      },
      {
        imageUrl: "https://img.test/logo.png",
      }
    );

    expect(lenientReport.safe).toBe(true); // not strict -> warning only
    expect(lenientReport.warnings.length).toBeGreaterThan(0);
    expect(lenientReport.score).toBeLessThan(100);

    const strictReport = verifyDeploymentSafetyParameters(
      {
        name: "Test Meme",
        ticker: "TESTM",
        description: "Valid description for the test meme token.",
      },
      {
        imageUrl: "https://img.test/logo.png",
      },
      { strictSocials: true }
    );

    expect(strictReport.safe).toBe(false); // strict -> issue
    expect(strictReport.issues.some((i) => i.includes("Social presence incomplete"))).toBe(true);
  });

  // =========================================================================
  // 2. PREDICTIVE CA EXTRACTION (Simulated Pre-flight)
  // =========================================================================
  it("4. should extract predictive contract address and pool ID via simulateOnly: true", async () => {
    axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        poolId: "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9",
        chain: "base",
        simulated: true,
      },
    });

    const pred = await predictDeploymentAddress(
      {
        name: "Predictive Token",
        ticker: "PREDICT",
        description: "Predictive deployment test token.",
      } as any,
      {
        imageUrl: "https://img.test/logo.png",
        metadataUrl: "https://ipfs.test/meta.json",
      }
    );

    expect(pred.success).toBe(true);
    expect(pred.predictedContractAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    expect(pred.predictedPoolId).toBe("0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9");
    expect(pred.chain).toBe("base");

    // Verify simulateOnly: true was sent in request payload
    expect(axiosPostSpy).toHaveBeenCalled();
    const sentPayload = axiosPostSpy.mock.calls[0][1];
    expect(sentPayload.simulateOnly).toBe(true);
  });

  it("5. should handle prediction errors gracefully without throwing in mainnet mode", async () => {
    process.env.DEPLOY_MODE = "mainnet";
    resetConfig();

    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(new Error("Bankr API unreachable"));

    const pred = await predictDeploymentAddress(
      { name: "Fail Token", ticker: "FAIL" } as any,
      { imageUrl: "https://img.test/logo.png", metadataUrl: "https://ipfs.test/meta.json" }
    );

    expect(pred.success).toBe(false);
    expect(pred.error).toBeDefined();
  });

  // =========================================================================
  // 3. MULTI-ACCOUNT SNIPE DISTRIBUTION & SAFE-CAP
  // =========================================================================
  it("6. should enforce Doppler anti-whale clamp on requested snipe amounts", () => {
    // 0.05 ETH is clamped to SNIPE_SAFE_CAP_ETH (0.02 ETH)
    expect(calculateSafeSnipeAmount("base", 0.05)).toBe(0.02);
    // 0.015 ETH is below 0.02 ETH -> preserved
    expect(calculateSafeSnipeAmount("base", 0.015)).toBe(0.015);
    // Solana has no Doppler cap
    expect(calculateSafeSnipeAmount("solana", 0.05)).toBe(0.05);
  });

  it("7. should partition total amount into multiple sub-wallets with micro-jitter", async () => {
    const sentMessages: Array<{ chatId: string; message: string }> = [];
    const botSpy = spyOn(Api.prototype, "sendMessage").mockImplementation(async function(this: any, chatId: any, text: any) {
      sentMessages.push({ chatId: String(chatId), message: String(text) });
      return {} as any;
    });

    const result = await snipeMultiAccountToken(
      "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      "base",
      "PUMPRUN",
      {
        totalAmount: 0.03,
        walletCount: 3,
        jitterMs: 10, // fast jitter for test
      }
    );

    botSpy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.successfulOrders).toBe(3);
    expect(result.failedOrders).toBe(0);
    expect(result.orders.length).toBe(3);
    expect(result.totalDispatchedAmount).toBeCloseTo(0.03, 4);

    // Each order is 0.01 ETH (< 0.02 ETH Doppler cap)
    for (const order of result.orders) {
      expect(order.amount).toBeCloseTo(0.01, 4);
      expect(order.success).toBe(true);
    }

    expect(sentMessages.length).toBe(3);
    expect(sentMessages[0].message).toContain("/buy 0x7CE19E4F978009EB644c27946B47221b824C0bA3 0.01");
  });

  it("8. should dispatch to distinct chat IDs when targets are explicitly configured", async () => {
    const sentMessages: Array<{ chatId: string; message: string }> = [];
    const botSpy = spyOn(Api.prototype, "sendMessage").mockImplementation(async function(this: any, chatId: any, text: any) {
      sentMessages.push({ chatId: String(chatId), message: String(text) });
      return {} as any;
    });

    const result = await snipeMultiAccountToken(
      "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      "base",
      "PUMPRUN",
      {
        targets: [
          { walletId: "w_alpha", chatId: "@BasedAlphaBot", amount: 0.015 },
          { walletId: "w_beta", chatId: "@BasedBetaBot", amount: 0.012 },
        ],
        jitterMs: 5,
      }
    );

    botSpy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.successfulOrders).toBe(2);
    expect(sentMessages.length).toBe(2);
    expect(sentMessages[0].chatId).toBe("@BasedAlphaBot");
    expect(sentMessages[1].chatId).toBe("@BasedBetaBot");
  });

  it("9. should clamp individual targets if they exceed the anti-whale limit", async () => {
    const sentMessages: Array<{ chatId: string; message: string }> = [];
    const botSpy = spyOn(Api.prototype, "sendMessage").mockImplementation(async function(this: any, chatId: any, text: any) {
      sentMessages.push({ chatId: String(chatId), message: String(text) });
      return {} as any;
    });

    const result = await snipeMultiAccountToken(
      "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      "base",
      "PUMPRUN",
      {
        targets: [
          { walletId: "whale_w", amount: 0.05 }, // exceeds 0.02
          { walletId: "normal_w", amount: 0.01 }, // safe
        ],
        jitterMs: 5,
      }
    );

    botSpy.mockRestore();

    expect(result.orders[0].amount).toBe(0.02); // clamped
    expect(result.orders[1].amount).toBe(0.01); // preserved
    expect(result.totalDispatchedAmount).toBeCloseTo(0.03, 4);
  });

  it("10. should maintain 100% backward compatibility with legacy snipeNewToken", async () => {
    let sentMsg = "";
    const botSpy = spyOn(Api.prototype, "sendMessage").mockImplementation(async function(this: any, _chatId: any, text: any) {
      sentMsg = String(text);
      return {} as any;
    });

    const ok = await snipeNewToken(
      "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      "base",
      "PUMPRUN",
      { snipeAmount: 0.01 }
    );

    botSpy.mockRestore();

    expect(ok).toBe(true);
    expect(sentMsg).toContain("/buy 0x7CE19E4F978009EB644c27946B47221b824C0bA3 0.01");
  });
});
