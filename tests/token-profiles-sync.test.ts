/**
 * tests/token-profiles-sync.test.ts
 *
 * Automated test suite for GeckoTerminal and DexScreener Token Profilers,
 * IPFS Pump.fun metadata compliance, and multi-chain social link synchronization.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  normalizeGeckoTerminalNetwork,
  getGeckoTerminalPoolUrl,
  getGeckoTerminalTokenUrl,
  getGeckoTerminalUpdatePortalUrl,
  getExplorerTokenUpdateUrl,
  buildGeckoTerminalProfilePayload,
  generateGeckoTerminalUpdateRequestText,
  saveGeckoTerminalProfileJson,
} from "../src/modules/growth/geckoterminal-profiler.ts";
import {
  normalizeDexScreenerChain,
  buildDexScreenerProfilePayload,
  generateDexScreenerFastTrackText,
  getDexScreenerUpdatePortalUrl,
} from "../src/modules/growth/dexscreener-profiler.ts";

describe("GeckoTerminal & DexScreener Profile Synchronization Suite", () => {
  const testDir = path.resolve(process.cwd(), "sites", "test_gt_sync_unit");

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("1. GeckoTerminal Network Normalization & URL Builders", () => {
    it("should normalize network names for Base, Solana, Robinhood, Arbitrum, and Arc", () => {
      expect(normalizeGeckoTerminalNetwork(8453)).toBe("base");
      expect(normalizeGeckoTerminalNetwork("base")).toBe("base");
      expect(normalizeGeckoTerminalNetwork(101)).toBe("solana");
      expect(normalizeGeckoTerminalNetwork("solana")).toBe("solana");
      expect(normalizeGeckoTerminalNetwork(4663)).toBe("robinhood");
      expect(normalizeGeckoTerminalNetwork(5042)).toBe("arc");
      expect(normalizeGeckoTerminalNetwork("arc")).toBe("arc");
    });

    it("should generate correct GeckoTerminal pool and token URLs", () => {
      const poolUrl = getGeckoTerminalPoolUrl("base", "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9");
      expect(poolUrl).toBe("https://www.geckoterminal.com/base/pools/0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9");

      const tokenUrl = getGeckoTerminalTokenUrl("base", "0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(tokenUrl).toBe("https://www.geckoterminal.com/base/tokens/0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    });

    it("should generate valid CoinGecko update ticket form URL", () => {
      const portalUrl = getGeckoTerminalUpdatePortalUrl();
      expect(portalUrl).toContain("https://support.coingecko.com/hc/en-us/requests/new");
      expect(portalUrl).toContain("ticket_form_id=360000025353");
    });

    it("should generate correct explorer token update URLs", () => {
      expect(getExplorerTokenUpdateUrl("base", "0xabc")).toBe("https://basescan.org/tokenupdate/0xabc");
      expect(getExplorerTokenUpdateUrl("solana", "So111")).toBe("https://solscan.io/token/So111");
      expect(getExplorerTokenUpdateUrl("arc", "0xarc")).toBe("https://arcscan.app/token/0xarc");
    });
  });

  describe("2. GeckoTerminal Profile Payload & Update Request Generation", () => {
    it("should build a comprehensive GeckoTerminal payload with pool address and social links", () => {
      const payload = buildGeckoTerminalProfilePayload({
        chainId: 8453,
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenName: "Pump Hill Runner",
        tokenSymbol: "PUMPRUN",
        poolAddress: "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9",
        websiteUrl: "https://pumprun-web3.pages.dev",
        twitterUrl: "https://x.com/PUMPRUN_coin",
        telegramUrl: "https://t.me/pumprun_portal",
      });

      expect(payload.network).toBe("base");
      expect(payload.tokenAddress).toBe("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(payload.tokenSymbol).toBe("PUMPRUN");
      expect(payload.poolAddress).toBe("0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9");
      expect(payload.poolUrl).toContain("https://www.geckoterminal.com/base/pools/");
      expect(payload.links.website).toBe("https://pumprun-web3.pages.dev");
      expect(payload.links.twitter).toBe("https://x.com/PUMPRUN_coin");
      expect(payload.links.telegram).toBe("https://t.me/pumprun_portal");
      expect(payload.security.buyTax).toBe("0%");
      expect(payload.security.sellTax).toBe("0%");
    });

    it("should generate clean, copy-paste ready text for CoinGecko update request", () => {
      const payload = buildGeckoTerminalProfilePayload({
        chainId: 8453,
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenName: "Pump Hill Runner",
        tokenSymbol: "PUMPRUN",
        poolAddress: "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9",
        websiteUrl: "https://pumprun-web3.pages.dev",
        twitterUrl: "https://x.com/PUMPRUN_coin",
        telegramUrl: "https://t.me/pumprun_portal",
      });

      const text = generateGeckoTerminalUpdateRequestText(payload);
      expect(text).toContain("GECKOTERMINAL & COINGECKO TOKEN INFO UPDATE REQUEST DATA");
      expect(text).toContain("Pump Hill Runner");
      expect(text).toContain("$PUMPRUN");
      expect(text).toContain("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(text).toContain("0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9");
      expect(text).toContain("https://pumprun-web3.pages.dev");
      expect(text).toContain("https://x.com/PUMPRUN_coin");
      expect(text).toContain("https://t.me/pumprun_portal");
      expect(text).toContain("LANGKAH PENGAJUAN RESMI GECKOTERMINAL");
    });

    it("should persist both json and txt files in the target directory", () => {
      const payload = buildGeckoTerminalProfilePayload({
        chainId: 8453,
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenName: "Pump Hill Runner",
        tokenSymbol: "PUMPRUN",
      });

      const jsonPath = saveGeckoTerminalProfileJson(testDir, payload);
      const txtPath = path.join(testDir, "geckoterminal-update-request.txt");

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(txtPath)).toBe(true);

      const savedJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(savedJson.tokenSymbol).toBe("PUMPRUN");
    });
  });

  describe("3. DexScreener Profiler Multi-Chain & Link Harmonization", () => {
    it("should normalize Arc Chain ID 5042 to 'arc'", () => {
      expect(normalizeDexScreenerChain(5042)).toBe("arc");
      expect(normalizeDexScreenerChain("arc")).toBe("arc");
    });

    it("should generate DexScreener fast-track text with live URLs and marketplace links", () => {
      const payload = buildDexScreenerProfilePayload({
        chainId: "base",
        tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        tokenName: "Pump Hill Runner",
        tokenSymbol: "PUMPRUN",
        websiteUrl: "https://pumprun-web3.pages.dev",
        twitterUrl: "https://x.com/PUMPRUN_coin",
        telegramUrl: "https://t.me/pumprun_portal",
      });

      const text = generateDexScreenerFastTrackText(payload);
      expect(text).toContain("https://pumprun-web3.pages.dev");
      expect(text).toContain("https://x.com/PUMPRUN_coin");
      expect(text).toContain("https://t.me/pumprun_portal");
      expect(text).not.toContain("Telegram:          None");
      expect(text).not.toContain("Twitter / X:       None");
      expect(text).toContain("https://marketplace.dexscreener.com/product/token-info");
    });
  });
});
