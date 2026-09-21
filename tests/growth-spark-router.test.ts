/**
 * tests/growth-spark-router.test.ts
 *
 * Automated Regression Suite for:
 * 1. Cross-Chain Omnichain Fleet Router & URL Resolvers (Base, Solana, Robinhood, Clanker)
 * 2. DexScreener Fast-Track Payment Webhook & Order Verifier
 * 3. Smart Multi-Wallet Volume Spark Lifecycle
 *
 * Adheres strictly to Rule 4 of AGENTS.md:
 * Isolated test database environment (NODE_ENV=test).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as path from "path";
import * as fs from "fs";

// Enforce test database isolation before importing vault
process.env.NODE_ENV = "test";
process.env.VAULT_DB_PATH = path.join(process.cwd(), ".eliza", "test_vault_growth_spark_router.db");

import { logDeploy } from "../src/db/vault.ts";
import {
  getChainBadge,
  getSwapUrl,
  getDexScreenerUrl,
  findFleetToken,
} from "../src/modules/telegram/token-agent-bot.ts";
import {
  processFastTrackPaymentPayload,
  verifyFastTrackPayment,
  normalizeFastTrackChain,
  startFastTrackWebhookServer,
} from "../src/modules/growth/fast-track-webhook.ts";
import { runDexScreenerWatchdog } from "../src/modules/intelligence/dexscreener-monitor.ts";

describe("Production Growth Spark & Cross-Chain Router Suite", () => {
  const baseCa = "0x1111111111111111111111111111111111111111";
  const solanaCa = "So11111111111111111111111111111111111111112";
  const robinhoodCa = "0x2222222222222222222222222222222222222222";

  beforeAll(() => {
    // Populate isolated test database with multi-chain deployments
    logDeploy({
      chain: "base",
      tokenName: "Base Omnichain Token",
      ticker: "BASECOIN",
      contractAddr: baseCa,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "confirmed",
      deployCost: 0,
      lifecycleState: "DEPLOY_CONFIRMED",
    });

    logDeploy({
      chain: "solana",
      tokenName: "Solana Pump Token",
      ticker: "SOLPUMP",
      contractAddr: solanaCa,
      txHash: "5abcde1111111111111111111111111111111111111111111111111111111111",
      status: "confirmed",
      deployCost: 0,
      lifecycleState: "DEPLOY_CONFIRMED",
    });

    logDeploy({
      chain: "robinhood",
      tokenName: "Robinhood Retail Token",
      ticker: "RHOOD",
      contractAddr: robinhoodCa,
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "confirmed",
      deployCost: 0,
      lifecycleState: "DEPLOY_CONFIRMED",
    });
  });

  afterAll(() => {
    const dbPath = process.env.VAULT_DB_PATH!;
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
    delete process.env.VAULT_DB_PATH;
  });

  describe("1. Cross-Chain Fleet Router & Badges", () => {
    it("should format distinctive chain badges for each ecosystem", () => {
      expect(getChainBadge("base")).toContain("Base L2");
      expect(getChainBadge("solana")).toContain("Solana");
      expect(getChainBadge("robinhood")).toContain("Robinhood");
      expect(getChainBadge("clanker")).toContain("Clanker");
      expect(getChainBadge("arbitrum")).toContain("ARBITRUM");
    });

    it("should resolve correct DEX swap URLs per chain", () => {
      const baseSwap = getSwapUrl(baseCa, "base");
      expect(baseSwap).toContain("app.uniswap.org");
      expect(baseSwap).toContain(baseCa);

      const solanaSwap = getSwapUrl(solanaCa, "solana");
      expect(solanaSwap).toContain("pump.fun");
      expect(solanaSwap).toContain(solanaCa);

      const robinhoodSwap = getSwapUrl(robinhoodCa, "robinhood");
      expect(robinhoodSwap).toContain("dexscreener.com/robinhood");
      expect(robinhoodSwap).toContain(robinhoodCa);

      const clankerSwap = getSwapUrl(baseCa, "clanker");
      expect(clankerSwap).toContain("clanker.world/clanker");
    });

    it("should resolve DexScreener URLs per chain", () => {
      expect(getDexScreenerUrl(baseCa, "base")).toBe(`https://dexscreener.com/base/${baseCa}`);
      expect(getDexScreenerUrl(solanaCa, "solana")).toBe(`https://dexscreener.com/solana/${solanaCa}`);
      expect(getDexScreenerUrl(robinhoodCa, "robinhood")).toBe(`https://dexscreener.com/robinhood/${robinhoodCa}`);
    });

    it("should resolve fleet tokens across multiple chains by ticker", () => {
      const baseToken = findFleetToken("BASECOIN");
      expect(baseToken.ticker).toBe("BASECOIN");
      expect(baseToken.address).toBe(baseCa);

      const solanaToken = findFleetToken("SOLPUMP");
      expect(solanaToken.ticker).toBe("SOLPUMP");
      expect(solanaToken.address).toBe(solanaCa);

      const rhoodToken = findFleetToken("RHOOD");
      expect(rhoodToken.ticker).toBe("RHOOD");
      expect(rhoodToken.address).toBe(robinhoodCa);
    });
  });

  describe("2. Fast-Track Payment Webhook & Order Verifier", () => {
    it("should normalize chain identifiers correctly", () => {
      expect(normalizeFastTrackChain("8453")).toBe("base");
      expect(normalizeFastTrackChain("base")).toBe("base");
      expect(normalizeFastTrackChain("101")).toBe("solana");
      expect(normalizeFastTrackChain("solana")).toBe("solana");
      expect(normalizeFastTrackChain("46688")).toBe("robinhood");
      expect(normalizeFastTrackChain("clanker")).toBe("base");
    });

    it("should reject requests missing valid tokenAddress", async () => {
      const res = await processFastTrackPaymentPayload({
        tokenAddress: "",
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("valid tokenAddress is required");
    });

    it("should enforce webhook secret when configured", async () => {
      const res = await processFastTrackPaymentPayload(
        {
          tokenAddress: baseCa,
          secret: "wrong_secret",
        },
        {
          webhookSecret: "super_secure_secret_123",
        }
      );
      expect(res.success).toBe(false);
      expect(res.message).toContain("Unauthorized");
    });

    it("should successfully process payment webhook with authorized secret", async () => {
      const res = await processFastTrackPaymentPayload(
        {
          chainId: "base",
          tokenAddress: baseCa,
          tokenSymbol: "BASECOIN",
          orderId: "ORD_DEX_9988",
          secret: "super_secure_secret_123",
        },
        {
          webhookSecret: "super_secure_secret_123",
          autoTriggerVolumeSpark: false, // Disarm live trades during unit test
        }
      );

      expect(res.success).toBe(true);
      expect(res.tokenAddress).toBe(baseCa);
      expect(res.chain).toBe("base");
      expect(res.orderId).toBe("ORD_DEX_9988");
      expect(res.vaultUpdated).toBe(true);
    });

    it("should start and stop native Bun HTTP server for webhook events", async () => {
      const testPort = 39871;
      const testSecret = "integration_test_secret";
      const serverInstance = startFastTrackWebhookServer(testPort, testSecret, {
        autoTriggerVolumeSpark: false,
      });

      try {
        // Test /health
        const healthRes = await fetch(`http://localhost:${testPort}/health`);
        expect(healthRes.status).toBe(200);
        const healthData = await healthRes.json();
        expect(healthData.status).toBe("ok");

        // Test /webhook/dexscreener/fast-track (authorized)
        const webhookRes = await fetch(`http://localhost:${testPort}/webhook/dexscreener/fast-track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId: "base",
            tokenAddress: baseCa,
            tokenSymbol: "BASECOIN",
            secret: testSecret,
          }),
        });
        expect(webhookRes.status).toBe(200);
        const webhookData = await webhookRes.json();
        expect(webhookData.success).toBe(true);
        expect(webhookData.chain).toBe("base");

        // Test unauthorized
        const unauthRes = await fetch(`http://localhost:${testPort}/webhook/dexscreener/fast-track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenAddress: baseCa,
            secret: "wrong",
          }),
        });
        expect(unauthRes.status).toBe(401);
      } finally {
        serverInstance.stop();
      }
    });

    it("should query on-demand payment verification cleanly", async () => {
      const verif = await verifyFastTrackPayment(baseCa, "base");
      expect(verif).toBeDefined();
      expect(typeof verif.isPaid).toBe("boolean");
      expect(typeof verif.statusText).toBe("string");
    });
  });

  describe("3. DexScreener Watchdog Loop Resilience", () => {
    it("should execute watchdog scan with autoTriggerVolumeSpark=false without crashing", async () => {
      const res = await runDexScreenerWatchdog({
        maxTokens: 1,
        autoTriggerVolumeSpark: false,
      });
      expect(res.checked).toBeGreaterThanOrEqual(0);
      expect(typeof res.activations).toBe("number");
      expect(typeof res.errors).toBe("number");
    });
  });
});
