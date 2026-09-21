import { describe, it, expect, beforeEach, spyOn, afterEach } from "bun:test";
import axios from "axios";
import { getConfig, resetConfig } from "../src/config.ts";
import {
  generateTokenIdentity,
  callByteDanceModelArk,
  TokenIdentitySchema,
  SYSTEM_PROMPT,
} from "../src/modules/ai/gemini-brain.ts";

describe("AI Multi-Provider Fallback & English-First Generation", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.FIRECRAWL_API_KEY = "test_firecrawl";
    process.env.PINATA_JWT = "test_pinata";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.BYTEDANCE_ARK_API_KEY;
    axiosPostSpy = spyOn(axios, "post");
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
  });

  it("1. should validate config when only ByteDance ModelArk key is configured (Gemini absent)", () => {
    process.env.BYTEDANCE_ARK_API_KEY = "ark-test-key";
    process.env.BYTEDANCE_MODEL_ENDPOINT = "ep-test-endpoint";
    resetConfig();

    const cfg = getConfig();
    expect(cfg.BYTEDANCE_ARK_API_KEY).toBe("ark-test-key");
    expect(cfg.BYTEDANCE_MODEL_ENDPOINT).toBe("ep-test-endpoint");
    expect(cfg.GOOGLE_GENERATIVE_AI_API_KEY).toBeUndefined();
  });

  it("2. should validate config when only Gemini key is configured", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "ai-test-key";
    resetConfig();

    const cfg = getConfig();
    expect(cfg.GOOGLE_GENERATIVE_AI_API_KEY).toBe("ai-test-key");
    expect(cfg.BYTEDANCE_ARK_API_KEY).toBeUndefined();
  });

  it("3. SYSTEM_PROMPT should strictly enforce English rules and pure JSON format", () => {
    expect(SYSTEM_PROMPT).toContain("ALL FIELDS MUST BE IN ENGLISH");
    expect(SYSTEM_PROMPT).toContain("Ticker MUST be all-caps");
    expect(SYSTEM_PROMPT).toContain("STRICT PURE JSON");
  });

  it("4. callByteDanceModelArk should successfully call BytePlus endpoint and parse English TokenIdentity", async () => {
    process.env.BYTEDANCE_ARK_API_KEY = "ark-valid-key";
    process.env.BYTEDANCE_MODEL_ENDPOINT = "ep-20260906092451-nzlwx";
    process.env.BYTEDANCE_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
    resetConfig();
    const cfg = getConfig();

    const mockAiJson = JSON.stringify({
      name: "Galactic Doge",
      ticker: "GDOGE",
      description: "First astronaut dog riding high on decentralized rails to Mars",
      viralScore: 95,
      imagePrompt: "cute space dog wearing glass helmet on red planet, vibrant cartoon style",
      website: "https://galacticdoge.xyz",
      twitter: "https://x.com/galacticdoge",
      telegram: "https://t.me/galacticdoge",
    });

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: mockAiJson,
            },
          },
        ],
      },
    });

    const result = await callByteDanceModelArk("Trending: Mars exploration with cyber dog", cfg);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Galactic Doge");
    expect(result!.ticker).toBe("GDOGE");
    expect(result!.viralScore).toBe(95);

    // Verify axios call arguments
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    const calledUrl = axiosPostSpy.mock.calls[0][0];
    const calledBody = axiosPostSpy.mock.calls[0][1];
    const calledHeaders = axiosPostSpy.mock.calls[0][2]?.headers;

    expect(calledUrl).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions");
    expect(calledBody.model).toBe("ep-20260906092451-nzlwx");
    expect(calledHeaders.Authorization).toBe("Bearer ark-valid-key");
  });

  it("5. generateTokenIdentity should automatically fallback to ByteDance when Gemini is unconfigured", async () => {
    process.env.BYTEDANCE_ARK_API_KEY = "ark-fallback-key";
    process.env.BYTEDANCE_MODEL_ENDPOINT = "ep-test";
    resetConfig();

    const mockAiJson = JSON.stringify({
      name: "Solar Chad",
      ticker: "SCHAD",
      description: "Harnessing the solar flare energy for maximum staking gains",
      viralScore: 88,
      imagePrompt: "golden muscular lion with sunglasses standing on sun beam",
      website: "https://solarchad.io",
      twitter: "https://x.com/solarchad",
      telegram: "https://t.me/solarchad",
    });

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: mockAiJson,
            },
          },
        ],
      },
    });

    const result = await generateTokenIdentity("Raw solar flares trending data");

    expect(result).not.toBeNull();
    expect(result!.ticker).toBe("SCHAD");
    expect(result!.name).toBe("Solar Chad");
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
  });

  it("6. TokenIdentitySchema should reject non-alphanumeric tickers or names", () => {
    const invalidTicker = {
      name: "Valid Name",
      ticker: "INVALID_TICKER_TOO_LONG",
      description: "Valid description over 10 chars",
      viralScore: 80,
      imagePrompt: "Valid image prompt",
      website: "https://test.com",
      twitter: "https://x.com/test",
      telegram: "https://t.me/test",
    };

    const parseResult = TokenIdentitySchema.safeParse(invalidTicker);
    expect(parseResult.success).toBe(false);
  });
});
