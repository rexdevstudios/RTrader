/**
 * tests/ca-intelligence.test.ts
 *
 * Unit tests for CA Intelligence & Audit Engine:
 *  - Address format detection (EVM vs Solana)
 *  - DexScreener Orders parsing & Paid verification (/dp)
 *  - GoPlus security metric evaluation & risk scoring
 *  - Unified safety score calculation & verdict
 *  - Sniper & terminal deep link generation
 */

import { describe, it, expect } from "bun:test";
import {
  detectAddressFormat,
  calculateSafetyScore,
  generateSniperLinks,
  type TokenSecurityAudit,
} from "../src/modules/intelligence/ca-intelligence.ts";

describe("CA Intelligence Engine", () => {
  describe("detectAddressFormat", () => {
    it("should correctly identify EVM addresses (0x... 40 hex chars)", () => {
      expect(detectAddressFormat("0x4Fd4F708427bd4e4934327C472de4718b90C5845")).toBe("evm");
      expect(detectAddressFormat("0x0000000000000000000000000000000000000000")).toBe("evm");
    });

    it("should correctly identify Solana addresses (Base58 32-44 chars)", () => {
      expect(detectAddressFormat("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe("solana");
      expect(detectAddressFormat("So11111111111111111111111111111111111111112")).toBe("solana");
    });
  });

  describe("calculateSafetyScore", () => {
    const baseSafeSecurity: TokenSecurityAudit = {
      isHoneypot: false,
      cannotBuy: false,
      cannotSellAll: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      isMintable: false,
      isBlacklisted: false,
      canTakeBackOwnership: false,
      isOpenSource: true,
      rawGoPlusStatus: "success",
      riskWarnings: [],
    };

    it("should award top safety score (>=85) for clean, open-source, non-mintable token with DexScreener Paid", () => {
      const { score, verdict } = calculateSafetyScore(baseSafeSecurity, true, 25000);
      expect(score).toBeGreaterThanOrEqual(85);
      expect(verdict).toBe("VERY_SAFE");
    });

    it("should immediately flag Honeypot as score 0 and DANGEROUS_HONEYPOT", () => {
      const honeypotSec: TokenSecurityAudit = {
        ...baseSafeSecurity,
        isHoneypot: true,
      };
      const { score, verdict } = calculateSafetyScore(honeypotSec, false, 50000);
      expect(score).toBe(0);
      expect(verdict).toBe("DANGEROUS_HONEYPOT");
    });

    it("should penalize high taxes and mintable tokens", () => {
      const riskySec: TokenSecurityAudit = {
        ...baseSafeSecurity,
        isMintable: true,
        sellTaxPct: 20, // 20% sell tax
        buyTaxPct: 15,
      };
      const { score, verdict } = calculateSafetyScore(riskySec, false, 2000);
      expect(score).toBeLessThanOrEqual(50);
      expect(verdict).toBe("HIGH_RISK");
    });
  });

  describe("generateSniperLinks", () => {
    it("should generate proper EVM Base sniper & explorer links", () => {
      const ca = "0x4Fd4F708427bd4e4934327C472de4718b90C5845";
      const links = generateSniperLinks("base", ca);

      expect(links.maestro).toContain(ca);
      expect(links.bananaGun).toContain(ca);
      expect(links.gmgn).toContain(`base/token/${ca}`);
      expect(links.photon).toContain("photon-base");
      expect(links.explorer).toContain(`basescan.org/token/${ca}`);
      expect(links.dexScreener).toContain(`base/${ca}`);
      expect(links.trojan).toBeUndefined();
    });

    it("should generate proper Solana sniper & explorer links with Trojan and BonkBot", () => {
      const ca = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
      const links = generateSniperLinks("solana", ca);

      expect(links.maestro).toContain(ca);
      expect(links.bananaGun).toContain(ca);
      expect(links.trojan).toBeDefined();
      expect(links.trojan).toContain(ca);
      expect(links.bonkBot).toBeDefined();
      expect(links.bonkBot).toContain(ca);
      expect(links.photon).toContain("photon-sol");
      expect(links.explorer).toContain(`solscan.io/token/${ca}`);
    });
  });
});
