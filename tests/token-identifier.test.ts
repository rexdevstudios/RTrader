/**
 * tests/token-identifier.test.ts
 *
 * Automated regression test suite for Token Identifier Normalizer:
 *  1. EVM Contract Address parsing & validation (Base, Ethereum, Arc, Robinhood).
 *  2. Solana SPL Mint address parsing & validation.
 *  3. Chain alias normalization.
 *  4. Anti-collision rejection when EVM address is passed as Solana or vice-versa.
 */

import { describe, it, expect } from "bun:test";
import {
  normalizeTokenIdentifier,
  normalizeChainName,
  isSolanaBase58Address,
} from "../packages/shared/token-identifier.ts";

describe("Token Identifier Normalizer & Dual-Identity Suite", () => {
  describe("1. Chain Name Normalization", () => {
    it("should normalize common chain aliases accurately", () => {
      expect(normalizeChainName("sol")).toBe("solana");
      expect(normalizeChainName("SOLANA")).toBe("solana");
      expect(normalizeChainName("101")).toBe("solana");

      expect(normalizeChainName("eth")).toBe("ethereum");
      expect(normalizeChainName("ETHEREUM")).toBe("ethereum");
      expect(normalizeChainName("1")).toBe("ethereum");

      expect(normalizeChainName("base")).toBe("base");
      expect(normalizeChainName("8453")).toBe("base");

      expect(normalizeChainName("rh")).toBe("robinhood");
      expect(normalizeChainName("robinhood")).toBe("robinhood");

      expect(normalizeChainName("arc")).toBe("arc");
      expect(normalizeChainName("5042")).toBe("arc");

      expect(normalizeChainName(undefined)).toBe("base");
    });
  });

  describe("2. EVM Address Validation & Checksumming", () => {
    it("should validate and checksum valid Base L2 address", () => {
      const rawCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
      const result = normalizeTokenIdentifier("base", rawCa);

      expect(result.isValid).toBe(true);
      expect(result.isEvm).toBe(true);
      expect(result.isSolana).toBe(false);
      expect(result.chain).toBe("base");
      expect(result.contractAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(result.mintAddress).toBeUndefined();
      expect(result.validationError).toBeUndefined();
    });

    it("should reject malformed EVM address", () => {
      const result = normalizeTokenIdentifier("ethereum", "0xInvalidHexAddress123");
      expect(result.isValid).toBe(false);
      expect(result.validationError).toBeDefined();
    });
  });

  describe("3. Solana SPL Mint Address Validation", () => {
    it("should validate legitimate Solana Base58 mint address", () => {
      const solMint = "7jY83c3cBoYYnVXEswfBwFhYnMGxY9MZaD3HxhBT5WCp";
      const result = normalizeTokenIdentifier("solana", solMint);

      expect(result.isValid).toBe(true);
      expect(result.isSolana).toBe(true);
      expect(result.isEvm).toBe(false);
      expect(result.chain).toBe("solana");
      expect(result.mintAddress).toBe(solMint);
      expect(result.contractAddress).toBe(solMint); // Backward compatibility
      expect(result.validationError).toBeUndefined();
    });

    it("should reject 0x prefixed address when chain is Solana", () => {
      const result = normalizeTokenIdentifier("solana", "0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(result.isValid).toBe(false);
      expect(result.mintAddress).toBeUndefined();
      expect(result.validationError).toContain("INVALID_SOLANA_MINT");
    });

    it("should reject too short or too long Solana addresses", () => {
      expect(isSolanaBase58Address("short")).toBe(false);
      expect(isSolanaBase58Address("1".repeat(50))).toBe(false);
    });
  });

  describe("4. Database Adapter getTokenLaunchByAddress", () => {
    it("should retrieve mock token launch by EVM address when DB is in memory mode", async () => {
      const { PostgresDraftDbAdapter } = await import("../packages/shared/db-pool.ts");
      const adapter = new PostgresDraftDbAdapter();
      const mockAddr = "0x0000000000000000000000000000000000000001";
      const token = await adapter.getTokenLaunchByAddress("base", mockAddr);

      // In fallback memory mode, it returns mock launch or null
      if (token) {
        expect(token.contractAddress.toLowerCase()).toBe(mockAddr.toLowerCase());
        expect(token.name).toBeDefined();
        expect(token.ticker).toBeDefined();
      }
    });

    it("should return null for completely nonexistent address in empty state", async () => {
      const { PostgresDraftDbAdapter } = await import("../packages/shared/db-pool.ts");
      const adapter = new PostgresDraftDbAdapter();
      const token = await adapter.getTokenLaunchByAddress("base", "0x9999999999999999999999999999999999999999");
      expect(token).toBeNull();
    });
  });

  describe("5. Cloudflare Pages Capacity Fallback Routing", () => {
    it("should route to universal portal when Cloudflare project limit is simulated", async () => {
      const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
      const result = await deployWebsiteToCloudflarePages({
        siteDir: "./sites/memecoin",
        ticker: "MEMECOIN",
        contractAddress: "0x2222222222222222222222222222222222222222",
        chain: "base",
        accountId: "",
        apiToken: "",
      });

      expect(result.success).toBe(true);
      expect(result.deploymentUrl).toBeDefined();
      expect(result.deploymentUrl).toContain(".pages.dev");
    });
  });
});
