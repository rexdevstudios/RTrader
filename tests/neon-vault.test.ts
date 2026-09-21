/**
 * tests/neon-vault.test.ts
 *
 * Automated test suite for Neon Serverless PostgreSQL Multi-Tenant Cloud Database.
 */

import { describe, it, expect } from "bun:test";
import {
  normalizeTokenDatabaseName,
  getNeonTokenDatabaseUrl,
  isNeonConfigured,
  ensureNeonTokenDatabase,
  initTokenDatabaseSchema,
  syncTokenDeploymentToNeon,
  getTokenDatabaseStats,
  listNeonTokenDatabases,
} from "../src/db/neon-vault.ts";

describe("Neon Serverless PostgreSQL Multi-Tenant Cloud Database Suite", () => {
  describe("1. Database Name Normalization & Security", () => {
    it("should convert uppercase tickers to lowercase with token_ prefix", () => {
      expect(normalizeTokenDatabaseName("PUMPRUN")).toBe("token_pumprun");
      expect(normalizeTokenDatabaseName("CLANKAI")).toBe("token_clankai");
      expect(normalizeTokenDatabaseName("BTC")).toBe("token_btc");
    });

    it("should sanitize spaces, hyphens and special characters into underscores", () => {
      expect(normalizeTokenDatabaseName("MY-TOKEN")).toBe("token_my_token");
      expect(normalizeTokenDatabaseName("DOGE COIN!")).toBe("token_doge_coin");
      expect(normalizeTokenDatabaseName("$$$PUMP$$$")).toBe("token_pump");
    });

    it("should enforce the 63-character PostgreSQL identifier length limit", () => {
      const longTicker = "A".repeat(100);
      const dbName = normalizeTokenDatabaseName(longTicker);
      expect(dbName.length).toBeLessThanOrEqual(63);
      expect(dbName.startsWith("token_")).toBe(true);
    });
  });

  describe("2. Connection URL Derivation", () => {
    it("should correctly replace the database pathname with the token database name", () => {
      const tokenUrl = getNeonTokenDatabaseUrl("PUMPRUN");
      expect(tokenUrl).toContain("/token_pumprun");
      expect(tokenUrl).toContain("sslmode=require");
      expect(tokenUrl).toContain("neondb_owner");
    });

    it("should handle already normalized database names without double prefix", () => {
      const tokenUrl = getNeonTokenDatabaseUrl("token_pumprun");
      expect(tokenUrl).toContain("/token_pumprun");
      expect(tokenUrl).not.toContain("token_token_");
    });
  });

  describe("3. Cloud Database Provisioning & Schema Synchronization", () => {
    it("should detect that Neon is configured in environment", () => {
      expect(isNeonConfigured()).toBe(true);
    });

    it("should list existing token databases in Neon including token_pumprun", async () => {
      const dbs = await listNeonTokenDatabases();
      expect(Array.isArray(dbs)).toBe(true);
      expect(dbs).toContain("token_pumprun");
    });

    it("should verify token_pumprun database schema and identity record", async () => {
      const stats = await getTokenDatabaseStats("PUMPRUN");
      expect(stats).not.toBeNull();
      expect(stats?.exists).toBe(true);
      expect(stats?.dbName).toBe("token_pumprun");
      expect(stats?.identityCount).toBeGreaterThan(0);
      expect(stats?.tokenDetails).toBeDefined();
      expect(stats?.tokenDetails?.ticker).toBe("PUMPRUN");
    }, 15000);

    it("should successfully sync a mock token deployment to Neon Cloud", async () => {
      const mockCA = "0x" + "a1b2c3d4".repeat(5);
      const res = await syncTokenDeploymentToNeon({
        contractAddr: mockCA,
        ticker: "NEONTEST",
        tokenName: "Neon Multi-Tenant Unit Test",
        chain: "base",
        websiteUrl: "https://neontest-web3.pages.dev",
      });

      expect(res.success).toBe(true);
      expect(res.dbName).toBe("token_neontest");
      expect(res.connectionUrl).toContain("/token_neontest");

      // Verify stats
      const stats = await getTokenDatabaseStats("NEONTEST");
      expect(stats?.exists).toBe(true);
      expect(stats?.identityCount).toBe(1);
      expect(stats?.tokenDetails?.name).toBe("Neon Multi-Tenant Unit Test");

      // Test dual-write telemetry
      const { recordTokenTelemetry, recordTokenFeeEvent, recordTokenWeb3Event, getNeonMasterSql } = await import("../src/db/neon-vault.ts");
      const telOk = await recordTokenTelemetry("NEONTEST", {
        contractAddr: mockCA,
        priceUsd: 0.00045,
        liquidityUsd: 12500,
        volume24hUsd: 85000,
        holderCount: 142,
        uniqueMakers: 38,
      });
      expect(telOk).toBe(true);

      // Test dual-write fee event
      const feeOk = await recordTokenFeeEvent("NEONTEST", {
        contractAddr: mockCA,
        claimTxHash: "0xtest_fee_claim_tx",
        wethClaimed: 0.025,
        buybackWeth: 0.0075,
        dividendWeth: 0.005,
        burnedTokens: 750000,
      });
      expect(feeOk).toBe(true);

      // Test dual-write web3 event
      const web3Ok = await recordTokenWeb3Event("NEONTEST", {
        contractAddr: mockCA,
        eventType: "connect_wallet",
        userAddress: "0xuser1234567890abcdef1234567890abcdef1234",
        walletProvider: "metamask",
      });
      expect(web3Ok).toBe(true);

      // Verify updated stats
      const updatedStats = await getTokenDatabaseStats("NEONTEST");
      expect(updatedStats?.telemetryCount).toBeGreaterThanOrEqual(1);
      expect(updatedStats?.feeCount).toBeGreaterThanOrEqual(1);
      expect(updatedStats?.web3EventCount).toBeGreaterThanOrEqual(1);

      // Clean up test database
      const masterSql = getNeonMasterSql();
      try {
        await masterSql.unsafe(`DROP DATABASE IF EXISTS token_neontest WITH (FORCE);`);
      } finally {
        await masterSql.close();
      }
    }, 35000);
  });
});
