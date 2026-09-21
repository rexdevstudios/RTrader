import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import {
  getBankrProfiles,
  createBankrProfile,
  updateBankrProfile,
  linkTokenToBankrProject,
  type CreateProfilePayload,
} from "../scripts/manage-bankr-project.ts";
import { applyIdentityOverrides, type TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { resetConfig } from "../src/config.ts";
import { bootstrapDefaultWallet } from "../src/modules/identity/wallet-manager.ts";

describe("Bankr Agent Profile & Project Integration Suite", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;
  let axiosPostSpy: ReturnType<typeof spyOn>;
  let axiosPutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_key";
    process.env.FIRECRAWL_API_KEY = "test_key";
    process.env.PINATA_JWT = "test_jwt";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_test_profile_key";
    bootstrapDefaultWallet();

    axiosGetSpy = spyOn(axios, "get");
    axiosPostSpy = spyOn(axios, "post");
    axiosPutSpy = spyOn(axios, "put");
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
    axiosPostSpy?.mockRestore();
    axiosPutSpy?.mockRestore();
  });

  describe("1. getBankrProfiles", () => {
    it("1.1 should return array of profiles when server responds with 200 OK", async () => {
      const mockProfiles = [
        {
          id: "prof_1",
          slug: "pump-hill-runner",
          projectName: "Pump Hill Runner",
          approved: false,
          tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
          tokenSymbol: "PUMPRUN",
        },
      ];

      axiosGetSpy.mockResolvedValueOnce({
        status: 200,
        data: mockProfiles,
      });

      const profiles = await getBankrProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].projectName).toBe("Pump Hill Runner");
      expect(profiles[0].slug).toBe("pump-hill-runner");
    });

    it("1.2 should return empty array when server responds with 404", async () => {
      axiosGetSpy.mockResolvedValueOnce({
        status: 404,
        data: null,
      });

      const profiles = await getBankrProfiles();
      expect(profiles).toEqual([]);
    });
  });

  describe("2. createBankrProfile", () => {
    it("2.1 should post profile payload and return created project", async () => {
      const payload: CreateProfilePayload = {
        projectName: "Pump Hill Runner",
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        description: "Autonomous meme agent",
        website: "https://pumprunner.xyz",
      };

      axiosPostSpy.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "prof_new",
          slug: "pump-hill-runner",
          ...payload,
          approved: false,
        },
      });

      const result = await createBankrProfile(payload);
      expect(result.id).toBe("prof_new");
      expect(result.slug).toBe("pump-hill-runner");
      expect(result.tokenAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. updateBankrProfile", () => {
    it("3.1 should encode slug and send PUT request with updated fields", async () => {
      axiosPutSpy.mockResolvedValueOnce({
        status: 200,
        data: {
          id: "prof_updated",
          slug: "pump-runner",
          projectName: "Pump Runner",
          tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
          approved: true,
        },
      });

      const result = await updateBankrProfile("pump-runner", {
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      });

      expect(result.slug).toBe("pump-runner");
      expect(result.tokenAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(axiosPutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("4. linkTokenToBankrProject High-Level Orchestrator", () => {
    it("4.1 should create new project if no project exists", async () => {
      // Mock GET returning empty
      axiosGetSpy.mockResolvedValueOnce({
        status: 200,
        data: [],
      });

      // Mock POST creating project
      axiosPostSpy.mockResolvedValueOnce({
        status: 201,
        data: {
          id: "prof_auto_created",
          slug: "pump-hill-runner",
          projectName: "Pump Hill Runner",
          tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
          approved: false,
        },
      });

      const res = await linkTokenToBankrProject(
        "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        "Pump Hill Runner"
      );

      expect(res.action).toBe("created");
      expect(res.profile.slug).toBe("pump-hill-runner");
    });

    it("4.2 should update existing project if project already exists", async () => {
      // Mock GET returning existing project
      axiosGetSpy.mockResolvedValueOnce({
        status: 200,
        data: [
          {
            id: "prof_existing",
            slug: "existing-agent",
            projectName: "Existing Agent",
            approved: true,
            tokenAddress: undefined,
          },
        ],
      });

      // Mock PUT updating project
      axiosPutSpy.mockResolvedValueOnce({
        status: 200,
        data: {
          id: "prof_existing",
          slug: "existing-agent",
          projectName: "Existing Agent",
          approved: true,
          tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        },
      });

      const res = await linkTokenToBankrProject(
        "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        "Existing Agent"
      );

      expect(res.action).toBe("updated");
      expect(res.profile.tokenAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    });
  });

  describe("5. Dynamic Anonymous Social & Website Identity Overrides (applyIdentityOverrides)", () => {
    const baseIdentity: TokenIdentity = {
      name: "Pump Hill Runner",
      ticker: "PUMPRUN",
      description: "Sample description",
      viralScore: 85,
      imagePrompt: "test prompt",
      website: "https://generated-random.xyz",
      twitter: "https://twitter.com/randomcoin",
      telegram: "https://t.me/randomportal",
    };

    it("5.1 should dynamically generate anonymous token-centric links when no overrides are set", () => {
      delete process.env.DEFAULT_PROJECT_WEBSITE;
      delete process.env.DEFAULT_TWITTER_HANDLE;
      delete process.env.DEFAULT_TELEGRAM_LINK;
      resetConfig();

      const res = applyIdentityOverrides(baseIdentity);
      expect(res.website).toBe("https://bankr.bot/agents/pump-hill-runner");
      expect(res.twitter).toBe("https://x.com/PUMPRUN_coin");
      expect(res.telegram).toBe("https://t.me/PUMPRUN_portal");
    });

    it("5.2 should interpolate dynamic templates for anonymous branding", () => {
      process.env.DEFAULT_PROJECT_WEBSITE = "https://bankr.bot/agents/{slug}";
      process.env.DEFAULT_TWITTER_HANDLE = "agent_{ticker}";
      process.env.DEFAULT_TELEGRAM_LINK = "https://t.me/{slug}_hub";
      resetConfig();

      const res = applyIdentityOverrides(baseIdentity);
      expect(res.website).toBe("https://bankr.bot/agents/pump-hill-runner");
      expect(res.twitter).toBe("https://x.com/agent_PUMPRUN");
      expect(res.telegram).toBe("https://t.me/pump-hill-runner_hub");
    });

    it("5.3 should apply static override when specified by operator", () => {
      process.env.DEFAULT_PROJECT_WEBSITE = "https://customproject.org";
      process.env.DEFAULT_TWITTER_HANDLE = "custom_anon";
      process.env.DEFAULT_TELEGRAM_LINK = "https://t.me/custom_portal";
      resetConfig();

      const res = applyIdentityOverrides(baseIdentity);
      expect(res.website).toBe("https://customproject.org");
      expect(res.twitter).toBe("https://x.com/custom_anon");
      expect(res.telegram).toBe("https://t.me/custom_portal");
    });

    it("5.4 should shield personal operator handles and sanitize to anonymous token handle", () => {
      delete process.env.DEFAULT_TWITTER_HANDLE;
      resetConfig();

      const personalIdentity: TokenIdentity = {
        ...baseIdentity,
        twitter: "https://x.com/AbdulRochimx",
      };
      const res = applyIdentityOverrides(personalIdentity);
      expect(res.twitter).toBe("https://x.com/PUMPRUN_coin");
      expect(res.twitter).not.toContain("AbdulRochim");
    });
  });
});
