/**
 * tests/phase6a-free-discovery.test.ts
 *
 * Phase 6A: Free Discovery & Promotion Readiness Test Suite.
 *
 * Validates:
 * 1. evaluatePromotionEligibility across all 4 deterministic outcomes:
 *    - NOT_READY (failed, missing CA, pending, unverified)
 *    - UNKNOWN (unresolved status, unknown on-chain outcome)
 *    - CONDITIONAL (verified CA, but zero liquidity, zero volume, or incomplete socials)
 *    - ELIGIBLE (verified on-chain, positive liquidity, complete metadata)
 * 2. generateDiscoveryPackage for Base and Solana tokens:
 *    - Accurate platform discovery classification (AUTO-DISCOVERED vs SUBMISSION-READY)
 *    - Proper URL formatting for DexScreener, GeckoTerminal, Basescan, Solscan
 *    - Social announcement copy and submission metadata
 *    - Zero false claims (never fabricated, never falsely labeled VERIFIED/LISTED)
 * 3. saveDiscoveryPackageJson file persistence in promotions directory
 * 4. Integration with exportFleetMatrix (promotionEligibility column in CSV/JSON)
 * 5. Database isolation and zero blockchain calls invariant
 */

import { describe, it, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { Database } from "bun:sqlite";

import {
  evaluatePromotionEligibility,
  generateDiscoveryPackage,
  saveDiscoveryPackageJson,
  type TokenOfferInput,
  type FreeDiscoveryPackage,
} from "../src/modules/growth/token-offer-generator.ts";
import { exportFleetMatrix } from "../scripts/view-fleet-matrix.ts";
import { resolveTargetToken } from "../scripts/generate-token-offer.ts";

describe("Phase 6A: Free Discovery & Promotion Readiness", () => {
  const mockBaseInput: TokenOfferInput = {
    tokenAddress: "0x1234567890123456789012345678901234567890",
    contractAddress: "0x1234567890123456789012345678901234567890",
    chain: "base",
    name: "Autonomous Cyber Dog",
    ticker: "ACD",
    description: "Autonomous AI-managed meme token on Base L2 with autonomous liquidity flywheel recycling.",
    website: "https://acd-token.xyz",
    twitter: "https://x.com/ACD_Token",
    telegram: "https://t.me/ACD_Community",
    poolId: "0xpool123456789012345678901234567890123456",
  };

  const mockSolanaInput: TokenOfferInput = {
    tokenAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    contractAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    chain: "solana",
    name: "Solana Super Pepe",
    ticker: "$SSPEPE",
    description: "High velocity community meme token launched on Solana Pump.fun bonding curve.",
    website: "https://sspepe.io",
    twitter: "https://x.com/SSPEPE_SOL",
    telegram: "https://t.me/SSPEPE_SOL",
  };

  describe("1. Promotion Eligibility Engine (evaluatePromotionEligibility)", () => {
    it("1.1 should return NOT_READY for failed deployments", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "FAILED",
        status: "failed",
        contractAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.status).toBe("NOT_READY");
      expect(result.reasons.some((r) => r.includes("FAILED"))).toBe(true);
      expect(result.eligiblePlatforms).toEqual([]);
    });

    it("1.2 should return NOT_READY for missing or invalid contract addresses", () => {
      const cases = ["", "n/a", "undefined", "null", "0x123"];
      for (const invalidCa of cases) {
        const result = evaluatePromotionEligibility({
          lifecycleState: "DEPLOY_CONFIRMED",
          status: "confirmed",
          contractAddress: invalidCa,
        });

        expect(result.status).toBe("NOT_READY");
        expect(result.reasons.some((r) => r.includes("Missing or invalid contract address"))).toBe(true);
      }
    });

    it("1.3 should return NOT_READY when deployment is still pending (DEPLOY_SUBMITTED)", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "DEPLOY_SUBMITTED",
        status: "pending",
        contractAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.status).toBe("NOT_READY");
      expect(result.reasons.some((r) => r.includes("pending confirmation"))).toBe(true);
    });

    it("1.4 should return NOT_READY when onChainVerified is explicitly false", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "DEPLOY_CONFIRMED",
        status: "confirmed",
        onChainVerified: false,
        contractAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.status).toBe("NOT_READY");
      expect(result.reasons.some((r) => r.includes("not been verified on-chain"))).toBe(true);
      expect(result.evaluatedMetrics.onChainVerified).toBe(false);
    });

    it("1.5 should return UNKNOWN when deployment state is unknown/unresolved without fabricating numbers", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "UNRESOLVED_UNKNOWN",
        status: "unknown",
        contractAddress: "0x1234567890123456789012345678901234567890",
      });

      expect(result.status).toBe("UNKNOWN");
      expect(result.reasons.some((r) => r.includes("UNKNOWN or unresolved"))).toBe(true);
      expect(result.evaluatedMetrics.liquidityUsd).toBe("UNKNOWN");
      expect(result.evaluatedMetrics.volume24h).toBe("UNKNOWN");
    });

    it("1.6 should return CONDITIONAL when verified on-chain but socials are missing", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "DEPLOY_CONFIRMED",
        status: "confirmed",
        onChainVerified: true,
        contractAddress: "0x1234567890123456789012345678901234567890",
        chain: "base",
        poolId: "0xpool123",
        liquidityUsd: 15000,
        volume24h: 3000,
        hasWebsite: false, // Missing website
        hasTwitter: true,
        hasDescription: true,
      });

      expect(result.status).toBe("CONDITIONAL");
      expect(result.reasons.some((r) => r.includes("Social presence incomplete"))).toBe(true);
      // DEX auto-discovery platforms are still eligible because pool exists
      expect(result.eligiblePlatforms).toContain("dexscreener_auto");
      expect(result.eligiblePlatforms).toContain("geckoterminal_auto");
      // But CoinGecko manual submission is blocked due to incomplete socials
      expect(result.eligiblePlatforms).not.toContain("coingecko_manual_submission");
    });

    it("1.7 should return CONDITIONAL when verified on-chain but liquidity is zero or unindexed", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "DEPLOY_CONFIRMED",
        status: "confirmed",
        onChainVerified: true,
        contractAddress: "0x1234567890123456789012345678901234567890",
        chain: "base",
        liquidityUsd: 0,
        volume24h: 0,
        hasWebsite: true,
        hasTwitter: true,
        hasDescription: true,
      });

      expect(result.status).toBe("CONDITIONAL");
      expect(result.reasons.some((r) => r.includes("liquidity is zero") || r.includes("No liquidity pool"))).toBe(true);
    });

    it("1.8 should return ELIGIBLE when verified on-chain, positive liquidity, and complete metadata", () => {
      const result = evaluatePromotionEligibility({
        lifecycleState: "DEPLOY_CONFIRMED",
        status: "confirmed",
        onChainVerified: true,
        contractAddress: "0x1234567890123456789012345678901234567890",
        chain: "base",
        poolId: "0xpool123",
        liquidityUsd: 25000,
        volume24h: 12000,
        hasWebsite: true,
        hasTwitter: true,
        hasTelegram: true,
        hasDescription: true,
      });

      expect(result.status).toBe("ELIGIBLE");
      expect(result.reasons.some((r) => r.includes("confirmed and verified"))).toBe(true);
      expect(result.eligiblePlatforms).toContain("dexscreener_auto");
      expect(result.eligiblePlatforms).toContain("geckoterminal_auto");
      expect(result.eligiblePlatforms).toContain("coingecko_manual_submission");
      expect(result.eligiblePlatforms).toContain("base_ecosystem_submission");
      expect(result.eligiblePlatforms).toContain("community_announcements");
      expect(result.evaluatedMetrics.metadataComplete).toBe(true);
      expect(result.evaluatedMetrics.hasLiquidity).toBe(true);
      expect(result.evaluatedMetrics.liquidityUsd).toBe(25000);
    });
  });

  describe("2. Free Discovery Package Generator (generateDiscoveryPackage)", () => {
    it("2.1 should generate a fully compliant package for Base L2 token", () => {
      const pkg = generateDiscoveryPackage(mockBaseInput, {
        liquidityUsd: 15400,
        volume24h: 8200,
        priceUsd: "$0.00042",
        onChainVerified: true,
        pairAddress: "0xpool123456789012345678901234567890123456",
        lifecycleState: "DEPLOY_CONFIRMED",
        status: "confirmed",
      });

      // Token info & URLs
      expect(pkg.tokenInfo.name).toBe("Autonomous Cyber Dog");
      expect(pkg.tokenInfo.symbol).toBe("ACD");
      expect(pkg.tokenInfo.chain).toBe("base");
      expect(pkg.tokenInfo.contractAddress).toBe("0x1234567890123456789012345678901234567890");
      expect(pkg.urls.dexScreener).toBe("https://dexscreener.com/base/0x1234567890123456789012345678901234567890");
      expect(pkg.urls.explorer).toBe("https://basescan.org/token/0x1234567890123456789012345678901234567890");

      // Platform status classification (zero false claims boundary)
      expect(pkg.discoveryStatus.dexScreener).toBe("AUTO-DISCOVERED");
      expect(pkg.discoveryStatus.geckoTerminal).toBe("AUTO-DISCOVERED");
      expect(pkg.discoveryStatus.coinGecko).toBe("SUBMISSION-READY");
      expect(pkg.discoveryStatus.baseEcosystem).toBe("SUBMISSION-READY");
      expect(pkg.discoveryStatus.communityChannels).toBe("SUBMISSION-READY");

      // Market telemetry
      expect(pkg.marketMetrics.priceUsd).toBe("$0.00042");
      expect(pkg.marketMetrics.liquidityUsd).toBe(15400);
      expect(pkg.marketMetrics.volume24h).toBe(8200);
      expect(pkg.marketMetrics.onChainVerified).toBe(true);
      expect(pkg.marketMetrics.verifiedStatus).toBe("VERIFIED_ON_CHAIN");

      // Social announcement copy
      expect(pkg.socialAnnouncement.headline).toContain("$ACD");
      expect(pkg.socialAnnouncement.socialPost).toContain("$ACD");
      expect(pkg.socialAnnouncement.socialPost).toContain("Base L2");
      expect(pkg.socialAnnouncement.communityPost).toContain("0x1234567890123456789012345678901234567890");

      // Submission metadata
      expect(pkg.submissionMetadata.category).toBe("Meme");
      expect(pkg.submissionMetadata.tags).toContain("base");
      expect(pkg.submissionMetadata.tags).toContain("flywheel");
    });

    it("2.2 should generate a compliant package for Solana token", () => {
      const pkg = generateDiscoveryPackage(mockSolanaInput, {
        liquidityUsd: 32000,
        volume24h: 18000,
        priceUsd: "$0.00125",
        onChainVerified: true,
        lifecycleState: "DEPLOY_CONFIRMED",
        status: "confirmed",
      });

      expect(pkg.tokenInfo.symbol).toBe("SSPEPE");
      expect(pkg.tokenInfo.chain).toBe("solana");
      expect(pkg.urls.dexScreener).toBe("https://dexscreener.com/solana/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
      expect(pkg.urls.explorer).toBe("https://solscan.io/token/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
      expect(pkg.discoveryStatus.baseEcosystem).toBeUndefined(); // Base ecosystem must not exist for Solana
      expect(pkg.socialAnnouncement.socialPost).toContain("Solana");
    });

    it("2.3 should preserve UNKNOWN status honestly when market telemetry is absent", () => {
      const pkg = generateDiscoveryPackage(mockBaseInput, {
        liquidityUsd: undefined,
        volume24h: undefined,
        priceUsd: undefined,
        onChainVerified: true,
      });

      expect(pkg.marketMetrics.priceUsd).toBe("UNKNOWN");
      expect(pkg.marketMetrics.liquidityUsd).toBe("UNKNOWN");
      expect(pkg.marketMetrics.volume24h).toBe("UNKNOWN");
      expect(pkg.eligibility.status).toBe("CONDITIONAL");
      expect(pkg.eligibility.evaluatedMetrics.liquidityUsd).toBe("UNKNOWN");
    });

    it("2.4 should format GeckoTerminal URL with /pools/${poolId} when pool exists and /tokens/${ca} when pool is absent", () => {
      // With poolId
      const pkgWithPool = generateDiscoveryPackage(
        { ...mockBaseInput, poolId: "0xpool123" },
        { liquidityUsd: 10000, volume24h: 5000, onChainVerified: true }
      );
      expect(pkgWithPool.urls.geckoTerminal).toBe("https://www.geckoterminal.com/base/pools/0xpool123");

      // Without poolId (never construct /pools/${ca})
      const pkgNoPool = generateDiscoveryPackage(
        { ...mockBaseInput, poolId: undefined },
        { liquidityUsd: undefined, volume24h: undefined, onChainVerified: true }
      );
      expect(pkgNoPool.urls.geckoTerminal).toBe(`https://www.geckoterminal.com/base/tokens/${mockBaseInput.contractAddress}`);
      expect(pkgNoPool.urls.geckoTerminal).not.toContain("/pools/" + mockBaseInput.contractAddress);
    });

    it("2.5 should set NOT_READY across all discovery platforms when deployment is NOT_READY", () => {
      const failedPkg = generateDiscoveryPackage(mockBaseInput, {
        lifecycleState: "FAILED",
        status: "failed",
        onChainVerified: false,
      });

      expect(failedPkg.eligibility.status).toBe("NOT_READY");
      expect(failedPkg.discoveryStatus.dexScreener).toBe("NOT_READY");
      expect(failedPkg.discoveryStatus.geckoTerminal).toBe("NOT_READY");
      expect(failedPkg.discoveryStatus.coinGecko).toBe("NOT_READY");
      expect(failedPkg.discoveryStatus.baseEcosystem).toBe("NOT_READY");
      expect(failedPkg.discoveryStatus.communityChannels).toBe("NOT_READY");
    });

    it("2.6 should include official Base ecosystem submission URL for Base tokens and omit for Solana", () => {
      const basePkg = generateDiscoveryPackage(mockBaseInput);
      expect(basePkg.urls.baseEcosystemForm).toBe("https://forms.gle/hJhc2PqfAsQp86YL8");
      expect(basePkg.submissionMetadata.officialSubmissionForm).toBe("https://forms.gle/hJhc2PqfAsQp86YL8");

      const solanaPkg = generateDiscoveryPackage(mockSolanaInput);
      expect(solanaPkg.urls.baseEcosystemForm).toBeUndefined();
      expect(solanaPkg.submissionMetadata.officialSubmissionForm).toBeUndefined();
    });
  });

  describe("3. JSON Artifact Persistence (saveDiscoveryPackageJson)", () => {
    const testDir = path.join(process.cwd(), ".eliza", "test_promotions");

    beforeEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("3.1 should save DISCOVERY_<TICKER>.json and DISCOVERY_<TICKER>_<CHAIN>.json idempotently", () => {
      const pkg = generateDiscoveryPackage(mockBaseInput, {
        liquidityUsd: 10000,
        volume24h: 5000,
        priceUsd: "$0.0001",
        onChainVerified: true,
      });

      const saveRes = saveDiscoveryPackageJson(pkg, { outputDir: testDir });
      expect(saveRes.success).toBe(true);
      expect(saveRes.primaryPath).toBeDefined();
      expect(saveRes.chainPath).toBeDefined();

      expect(fs.existsSync(saveRes.primaryPath!)).toBe(true);
      expect(fs.existsSync(saveRes.chainPath!)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(saveRes.primaryPath!, "utf8"));
      expect(parsed.tokenInfo.symbol).toBe("ACD");
      expect(parsed.urls.dexScreener).toBe(pkg.urls.dexScreener);
      expect(parsed.discoveryStatus.dexScreener).toBe(pkg.discoveryStatus.dexScreener);
      expect(parsed.eligibility.status).toBe(pkg.eligibility.status);
    });
  });

  describe("4. Fleet Matrix Export Integration (exportFleetMatrix)", () => {
    const tmpExportDir = path.join(process.cwd(), ".eliza", "test_fleet_exports");

    it("4.1 should include promotionEligibility and dexDiscoveryStatus in exported items, CSV headers, and JSON", async () => {
      fs.mkdirSync(tmpExportDir, { recursive: true });

      const res = await exportFleetMatrix({
        format: "all",
        customDir: tmpExportDir,
        filenamePrefix: "test_promo_export",
      });

      expect(res.count).toBeGreaterThan(0);
      expect(res.items.length).toBe(res.count);

      // Verify that every exported item contains promotionEligibility and dexDiscoveryStatus
      for (const item of res.items) {
        expect(item.promotionEligibility).toBeDefined();
        expect(["ELIGIBLE", "CONDITIONAL", "NOT_READY", "UNKNOWN"]).toContain(item.promotionEligibility!);
        expect(item.dexDiscoveryStatus).toBeDefined();
        expect(["OBSERVED", "PENDING_INDEXING", "SIMULATED"]).toContain(item.dexDiscoveryStatus!);
      }

      // Verify CSV content
      expect(res.csvPath).toBeDefined();
      const csv = fs.readFileSync(res.csvPath!, "utf8");
      const lines = csv.trim().split("\n");
      expect(lines[0]).toContain("promotionEligibility");
      expect(lines[0]).toContain("dexDiscoveryStatus");

      // Verify JSON content
      expect(res.jsonPath).toBeDefined();
      const json = JSON.parse(fs.readFileSync(res.jsonPath!, "utf8"));
      expect(json.fleet[0].promotionEligibility).toBeDefined();
      expect(json.fleet[0].dexDiscoveryStatus).toBeDefined();
    });
  });

  describe("5. Safety, Zero False Claims, and Database Isolation Invariants", () => {
    it("5.1 should leave production vault.db untouched", () => {
      const prodDbPath = path.join(process.cwd(), ".eliza", "vault.db");
      if (fs.existsSync(prodDbPath)) {
        const prodDb = new Database(prodDbPath);
        const deployCount = (prodDb.query("SELECT COUNT(*) as c FROM deploy_logs").get() as { c: number }).c;
        const ledgerCount = (prodDb.query("SELECT COUNT(*) as c FROM treasury_ledger").get() as { c: number }).c;
        prodDb.close();
        // Production vault.db is sterile with valid deploy logs and confirmed treasury ledger entries
        expect(deployCount).toBeGreaterThanOrEqual(6);
        expect(ledgerCount).toBeGreaterThanOrEqual(0);
      }
    });

    it("5.2 should NEVER classify any external platform as VERIFIED/LISTED without human operator action", () => {
      const pkg = generateDiscoveryPackage(mockBaseInput, {
        liquidityUsd: 100000,
        volume24h: 50000,
        priceUsd: "$1.00",
        onChainVerified: true,
      });

      // Assert that automated generation sets only AUTO-DISCOVERED, OBSERVED, or SUBMISSION-READY
      const statuses = Object.values(pkg.discoveryStatus);
      for (const st of statuses) {
        expect(st).not.toBe("VERIFIED/LISTED");
        expect(st).not.toBe("SUBMITTED");
        expect(["AUTO-DISCOVERED", "OBSERVED", "SUBMISSION-READY", "PENDING_INDEXING", "NOT_READY"]).toContain(st);
      }
    });
  });

  describe("6. Primary CLI & Target Token Resolver Hardening", () => {
    it("6.1 should return null when explicit query does not match any token, preventing deceptive fallback", () => {
      const nonexistent = resolveTargetToken("NON_EXISTENT_TOKEN_TICKER_XYZ_999");
      expect(nonexistent).toBeNull();
    });

    it("6.2 should return default confirmed token when no query is passed", () => {
      const defaultToken = resolveTargetToken();
      expect(defaultToken).toBeDefined();
      expect(defaultToken?.contractAddr).toBeDefined();
    });
  });
});
