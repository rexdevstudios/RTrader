/**
 * tests/bankr-deployer.test.ts
 *
 * Test suite for the official Bankr Token Launch API integration:
 *  1. Valid deployment payload construction
 *  2. Correct authentication header (User key vs Partner key)
 *  3. simulateOnly: true (HTTP 200 response handling)
 *  4. Successful real deployment response (HTTP 201 response handling)
 *  5. Malformed Bankr response (missing tokenAddress, missing txHash)
 *  6. 400 validation error response
 *  7. 401/403 authentication & eligibility error responses
 *  8. 429 rate limit response (with Retry-After header)
 *  9. Timeout / network failure handling
 *  10. Prevention of blind retry after ambiguous deployment outcome
 */
import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios, { AxiosError } from "axios";
import {
  deployViaBankr,
  buildBankrPayload,
  getBankrHeaders,
  sanitizeSecret,
  BANKR_DEPLOY_URL,
} from "../src/modules/evm/bankr-deployer.ts";
import type { TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import type { UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";

const mockIdentity: TokenIdentity = {
  name: "Doge Galactic",
  ticker: "DGLC",
  description: "Intergalactic meme coin on Base",
  viralScore: 88,
  imagePrompt: "a golden doge in a spacesuit",
  website: "https://dogegalactic.xyz",
  twitter: "https://x.com/dogegalactic",
  telegram: "https://t.me/dogegalactic",
};

const mockAssets: UploadResult = {
  imageUrl: "https://gateway.pinata.cloud/ipfs/QmTestImage123",
  metadataUrl: "https://gateway.pinata.cloud/ipfs/QmTestMeta123",
  ipfsImageUri: "ipfs://QmTestImage123",
};

import { resetConfig } from "../src/config.ts";

describe("Bankr Deployer Integration", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Reset process.env required defaults for tests
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "dummy_gemini_key";
    process.env.FIRECRAWL_API_KEY = "dummy_firecrawl_key";
    process.env.PINATA_JWT = "dummy_pinata_jwt";
    process.env.EVM_PRIVATE_KEY = "0x" + "1".repeat(64);
    process.env.SOLANA_PRIVATE_KEY = "4rFNFAiMDHLdFkBNTNPeNBGxhGNVLUGTDdvMEfRhbhMqFWmXnLdFkBNTNPeNBGxhG";
    process.env.BANKR_API_KEY = "bk_usr_test1234_secret5678";
    process.env.BANKR_CHAIN = "base";
    process.env.BANKR_DEGEN_MODE = "true";
    process.env.DEPLOY_MODE = "mainnet";
    process.env.DRY_RUN = "false";
    process.env.BANKR_SIMULATE_ONLY = "false";
    process.env.API_TIMEOUT_MS = "5000";
    resetConfig();
  });

  afterEach(() => {
    if (axiosPostSpy) {
      axiosPostSpy.mockRestore();
    }
  });

  // 1. Valid deployment payload
  it("1. should construct a valid deployment payload conforming to Bankr OpenAPI schema", () => {
    const payload = buildBankrPayload(mockIdentity, mockAssets, {
      chain: "base",
      degenMode: true,
      simulateOnly: false,
    });

    expect(payload.tokenName).toBe("Doge Galactic");
    expect(payload.tokenSymbol).toBe("DGLC");
    expect(payload.description).toBe("Intergalactic meme coin on Base");
    expect(payload.image).toBe("https://gateway.pinata.cloud/ipfs/QmTestImage123");
    expect(payload.websiteUrl).toBe("https://dogegalactic.xyz");
    expect(payload.tweetUrl).toBe("https://x.com/dogegalactic");
    expect(payload.chain).toBe("base");
    expect(payload.degenMode).toBe(true);
    expect(payload.simulateOnly).toBe(false);

    // Ensure no undocumented fields are attached
    expect((payload as Record<string, unknown>).disableVesting).toBeUndefined();
  });

  // 2. Correct authentication header
  it("2. should set X-API-Key for user keys and X-Partner-Key for partner keys", () => {
    const userHeaders = getBankrHeaders("bk_usr_abc_123");
    expect(userHeaders["X-API-Key"]).toBe("bk_usr_abc_123");
    expect(userHeaders["X-Partner-Key"]).toBeUndefined();

    const partnerHeaders = getBankrHeaders("bk_ptr_org_xyz");
    expect(partnerHeaders["X-Partner-Key"]).toBe("bk_ptr_org_xyz");
    expect(partnerHeaders["X-API-Key"]).toBeUndefined();
  });

  // 3. simulateOnly: true
  it("3. should handle simulateOnly: true with HTTP 200 simulation response", async () => {
    axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        tokenAddress: "0x1111111111111111111111111111111111111111",
        poolId: "0xpool111111111111111111111111111111111111",
        chain: "base",
        simulated: true,
        feeDistribution: {
          creator: { address: "0xcreator", bps: 9500 },
          protocol: { address: "0xprotocol", bps: 500 },
        },
      },
    });

    const result = await deployViaBankr(mockIdentity, mockAssets, { simulateOnly: true });

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.simulated).toBe(true);
    expect(result.contractAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(result.poolId).toBe("0xpool111111111111111111111111111111111111");
    expect(result.txHash).toBeUndefined(); // Simulation does not produce on-chain tx
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);

    const [url, sentPayload] = axiosPostSpy.mock.calls[0];
    expect(url).toBe(BANKR_DEPLOY_URL);
    expect((sentPayload as Record<string, unknown>).simulateOnly).toBe(true);
  });

  // 4. Successful real deployment response
  it("4. should handle real deployment HTTP 201 response with txHash and explorer URL", async () => {
    axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({
      status: 201,
      data: {
        success: true,
        tokenAddress: "0x2222222222222222222222222222222222222222",
        poolId: "0xpool222222222222222222222222222222222222",
        txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chain: "base",
        simulated: false,
        feeDistribution: {
          creator: { address: "0xcreator", bps: 9500 },
          protocol: { address: "0xprotocol", bps: 500 },
        },
      },
    });

    const result = await deployViaBankr(mockIdentity, mockAssets, { simulateOnly: false });

    expect(result.success).toBe(true);
    expect(result.status).toBe("success");
    expect(result.simulated).toBe(false);
    expect(result.contractAddress).toBe("0x2222222222222222222222222222222222222222");
    expect(result.txHash).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.explorerUrl).toContain("basescan.org/tx/0xaaaa");
    expect(result.poolId).toBe("0xpool222222222222222222222222222222222222");
  });

  // 5. Malformed Bankr response
  it("5. should fail safely on malformed Bankr response (missing tokenAddress)", async () => {
    axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({
      status: 201,
      data: {
        success: true,
        // missing tokenAddress
        poolId: "0xpool123",
        txHash: "0xhash123",
      },
    });

    const result = await deployViaBankr(mockIdentity, mockAssets, { simulateOnly: false });

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("MALFORMED_RESPONSE");
  });

  // 6. 400 validation error response
  it("6. should format 400 validation errors accurately", async () => {
    const error = new AxiosError("Bad Request");
    error.response = {
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: {} as any,
      data: { error: "tokenName is required and must be between 1 and 100 characters" },
    };

    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(error);

    const result = await deployViaBankr(mockIdentity, mockAssets);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("VALIDATION_ERROR (400)");
    expect(result.error).toContain("tokenName is required");
  });

  // 7. 401/403 response
  it("7. should format 401 and 403 eligibility errors with diagnostic codes", async () => {
    // Test 401
    const err401 = new AxiosError("Unauthorized");
    err401.response = {
      status: 401,
      statusText: "Unauthorized",
      headers: {},
      config: {} as any,
      data: { error: "Missing or invalid authentication" },
    };
    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(err401);

    const result401 = await deployViaBankr(mockIdentity, mockAssets);
    expect(result401.success).toBe(false);
    expect(result401.error).toContain("AUTHENTICATION_ERROR (401)");

    // Test 403 with code TOKEN_LAUNCH_WALLET_TOO_NEW
    const err403 = new AxiosError("Forbidden");
    err403.response = {
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: {} as any,
      data: {
        code: "TOKEN_LAUNCH_WALLET_TOO_NEW",
        error: "Your Bankr wallet must be at least 24 hours old before launching a token.",
      },
    };
    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(err403);

    const result403 = await deployViaBankr(mockIdentity, mockAssets);
    expect(result403.success).toBe(false);
    expect(result403.error).toContain("ELIGIBILITY_OR_PERMISSION_ERROR (403)");
    expect(result403.error).toContain("TOKEN_LAUNCH_WALLET_TOO_NEW");
  });

  // 8. 429 rate limit response
  it("8. should include Retry-After information on 429 rate limit response", async () => {
    const err429 = new AxiosError("Too Many Requests");
    err429.response = {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "retry-after": "60" },
      config: {} as any,
      data: { error: "Rate limit exceeded: maximum 3 deploys per 24 hours" },
    };
    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(err429);

    const result = await deployViaBankr(mockIdentity, mockAssets);

    expect(result.success).toBe(false);
    expect(result.error).toContain("RATE_LIMIT_EXCEEDED (429)");
    expect(result.error).toContain("Retry after 60s");
  });

  // 9. Timeout / network failure
  it("9. should return AMBIGUOUS/UNKNOWN state on network timeout", async () => {
    const timeoutErr = new AxiosError("timeout of 5000ms exceeded");
    timeoutErr.code = "ECONNABORTED";

    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(timeoutErr);

    const result = await deployViaBankr(mockIdentity, mockAssets);

    expect(result.success).toBe(false);
    expect(result.status).toBe("unknown");
    expect(result.error).toContain("DEPLOYMENT_OUTCOME_UNKNOWN");
    expect(result.error).toContain("AUTOMATIC RETRY IS FORBIDDEN");
  });

  // 10. Prevention of blind retry after ambiguous outcome
  it("10. should ensure exactly one HTTP request was issued and blind retry is prevented", async () => {
    const timeoutErr = new AxiosError("Network timeout");
    timeoutErr.code = "ETIMEDOUT";

    axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(timeoutErr);

    const result = await deployViaBankr(mockIdentity, mockAssets);

    // Verifies that only 1 single HTTP request was dispatched (NO blind retries)
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("unknown");
  });

  // Secret sanitization utility test
  it("should sanitize API keys and Bearer tokens in error strings", () => {
    const sensitive = "Error with bk_usr_123456789_abcdef and Bearer secret_token_xyz";
    const sanitized = sanitizeSecret(sensitive);
    expect(sanitized).not.toContain("bk_usr_123456789_abcdef");
    expect(sanitized).not.toContain("secret_token_xyz");
    expect(sanitized).toContain("bk_usr_[REDACTED]");
    expect(sanitized).toContain("Bearer [REDACTED]");
  });
});
