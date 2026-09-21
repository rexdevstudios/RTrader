/**
 * tests/ca-website-integration.test.ts
 *
 * Automated Regression Suite for:
 * 1. Scraped CA Web3 Sector Taxonomy & Curated Template Binding
 * 2. Dynamic Liquidity-Tiered Volume Spark Computation
 * 3. Pinata IPFS Banner Upload & DexScreener Header Sync
 * 4. End-to-End Dual-Engine Website Generation Integration
 *
 * Adheres strictly to Rule 4 of AGENTS.md:
 * Isolated test database environment (NODE_ENV=test).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as path from "path";
import * as fs from "fs";

// Enforce test database isolation before importing vault
process.env.NODE_ENV = "test";
process.env.VAULT_DB_PATH = path.join(process.cwd(), ".eliza", "test_vault_ca_website.db");

import { logDeploy, getAllDeployLogs } from "../src/db/vault.ts";
import {
  detectSector,
  getSectorTheme,
  CURATED_GITHUB_TEMPLATES,
} from "../src/modules/growth/template-registry.ts";
import { computeTieredMicroAmount } from "../src/modules/growth/trending-booster.ts";
import {
  buildDexScreenerProfilePayload,
  saveDexScreenerProfileJson,
} from "../src/modules/growth/dexscreener-profiler.ts";
import { uploadAssetFileToPinata } from "../src/modules/ipfs/pinata-uploader.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("Scraped CA Website Template & Growth Suite Integration", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_scraped_ca_token");
  const testCa = "0x7777777777777777777777777777777777777777";
  const testTicker = "NEURALAI";

  beforeAll(() => {
    logDeploy({
      chain: "base",
      tokenName: "Neural Intelligence Agent",
      ticker: testTicker,
      contractAddr: testCa,
      txHash: "0x7777777777777777777777777777777777777777777777777777777777777777",
      status: "confirmed",
      deployCost: 0,
      lifecycleState: "DEPLOY_CONFIRMED",
      signalSources: ["https://dexscreener.com/base/neuralai", "https://pump.fun/neuralai"],
    });
  });

  afterAll(() => {
    const dbPath = process.env.VAULT_DB_PATH!;
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
    if (fs.existsSync(testOutputDir)) {
      try {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
    delete process.env.VAULT_DB_PATH;
  });

  describe("1. Scraped CA Sector Classification & Template Binding", () => {
    it("should classify scraped CA data into matching Web3 sectors", () => {
      // AI Agent sector
      expect(detectSector("DeepMind Matrix", "DMATRIX", "Autonomous on-chain neural agent")).toBe("AI_AGENT");
      // DeFi Treasury sector
      expect(detectSector("Yield Vault Protocol", "VAULT", "Decentralized treasury buyback")).toBe("DEFI_TREASURY");
      // Gaming Utility sector
      expect(detectSector("Cyber Arcade", "PLAY", "Web3 gaming compute node")).toBe("GAMING_UTILITY");
      // Viral Meme sector
      expect(detectSector("Moon Rocket", "MOON", "Community degen flywheel")).toBe("VIRAL_MEME");
    });

    it("should provide valid themes and curated GitHub template repositories for each sector", () => {
      const sectors = ["AI_AGENT", "DEFI_TREASURY", "VIRAL_MEME", "GAMING_UTILITY"] as const;
      for (const sec of sectors) {
        const theme = getSectorTheme(sec);
        expect(theme.displayName).toBeDefined();
        expect(theme.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(theme.visualEffect).toBeDefined();

        const curated = CURATED_GITHUB_TEMPLATES[sec];
        expect(curated).toBeDefined();
        expect(curated.repoUrl).toContain("https://github.com/");
        expect(curated.configFilePath).toBe("config/token.ts");
      }
    });

    it("should correctly resolve deployed token records from vault with canonical column names", () => {
      const logs = getAllDeployLogs();
      const matched = logs.find((l) => l.contractAddr?.toLowerCase() === testCa.toLowerCase());

      expect(matched).toBeDefined();
      expect(matched?.ticker).toBe(testTicker);
      expect(matched?.tokenName).toBe("Neural Intelligence Agent");
      expect(matched?.chain).toBe("base");
      expect(matched?.signalSources?.length).toBeGreaterThan(0);
    });
  });

  describe("2. Dynamic Liquidity-Tiered Volume Spark", () => {
    it("should assign low liquidity micro-amount to protect seed pools (< $5k)", () => {
      expect(computeTieredMicroAmount(1000)).toBe(0.00005);
      expect(computeTieredMicroAmount(4999)).toBe(0.00005);
    });

    it("should assign medium liquidity standard micro-amount ($5k - $25k)", () => {
      expect(computeTieredMicroAmount(5000)).toBe(0.0001);
      expect(computeTieredMicroAmount(15000)).toBe(0.0001);
      expect(computeTieredMicroAmount(25000)).toBe(0.0001);
    });

    it("should assign deep liquidity high visual impact micro-amount (> $25k)", () => {
      expect(computeTieredMicroAmount(25001)).toBe(0.00025);
      expect(computeTieredMicroAmount(100000)).toBe(0.00025);
    });

    it("should respect explicit micro-amount override regardless of liquidity", () => {
      expect(computeTieredMicroAmount(2000, 0.005)).toBe(0.005);
      expect(computeTieredMicroAmount(50000, 0.00001)).toBe(0.00001);
    });

    it("should fall back to safe default (0.0001 ETH) when liquidity is unknown or zero", () => {
      expect(computeTieredMicroAmount(undefined)).toBe(0.0001);
      expect(computeTieredMicroAmount(0)).toBe(0.0001);
      expect(computeTieredMicroAmount(-100)).toBe(0.0001);
    });
  });

  describe("3. DexScreener Profile IPFS Banner & Header Sync", () => {
    it("should include header field in DexScreener profile payload", () => {
      const bannerUrl = "https://gateway.pinata.cloud/ipfs/QmTestBanner123456789";
      const payload = buildDexScreenerProfilePayload({
        chainId: "base",
        tokenAddress: testCa,
        tokenName: "Neural Intelligence Agent",
        tokenSymbol: testTicker,
        headerUrl: bannerUrl,
      });

      expect(payload.header).toBe(bannerUrl);
      expect(payload.tokenAddress).toBe(testCa);
      expect(payload.links.some((l) => l.type === "website")).toBe(true);
    });

    it("should handle IPFS asset upload gracefully when credentials are mock or missing", async () => {
      const dummyFile = path.join(process.cwd(), "package.json");
      const result = await uploadAssetFileToPinata(dummyFile);
      // In test/mock environment without real Pinata JWT, returns null safely without throwing
      expect(result === null || typeof result === "string").toBe(true);
    });
  });

  describe("4. End-to-End Dual-Engine Website Generation Integration", () => {
    it("should generate a complete 3D Parallax Web3 bundle matching the classified sector", async () => {
      const result = await generateTokenWebsite({
        name: "Neural Intelligence Agent",
        ticker: testTicker,
        contractAddress: testCa,
        chainName: "base",
        chainId: 8453,
        description: "Autonomous Web3 AI Agent",
        trendNarrative: "ai agent neural intelligence swarm",
        outputDir: testOutputDir,
      });

      expect(result.sector).toBe("AI_AGENT");
      expect(fs.existsSync(result.indexHtmlPath)).toBe(true);
      expect(fs.existsSync(result.envProductionPath)).toBe(true);
      expect(fs.existsSync(result.ciCdWorkflowPath)).toBe(true);

      // Verify sector visual injected into index.html
      const htmlContent = fs.readFileSync(result.indexHtmlPath, "utf-8");
      expect(htmlContent).toContain("Autonomous On-Chain AI Agent Protocol");
      expect(htmlContent).toContain("#00ff66");
      expect(htmlContent).toContain(testCa);
      expect(htmlContent).toContain(testTicker);

      // Verify DexScreener profile json saved
      const profilePath = path.join(result.siteDirectory, "dexscreener-profile.json");
      expect(fs.existsSync(profilePath)).toBe(true);
      const profileJson = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
      expect(profileJson.tokenAddress).toBe(testCa);
    });
  });
});
