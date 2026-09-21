/**
 * tests/telegram-flywheel-commands.test.ts
 *
 * Unit tests for Telegram Bot Flywheel community keyboards and WebApp integration.
 */

import { describe, it, expect } from "bun:test";
import {
  buildReferralKeyboard,
  buildDividendKeyboard,
  buildJackpotKeyboard,
} from "../src/modules/telegram/token-agent-bot.ts";

describe("Telegram Flywheel Community Keyboards Suite", () => {
  describe("buildReferralKeyboard", () => {
    it("should generate referral keyboard with web_app when referralUrl is https", () => {
      const keyboard = buildReferralKeyboard(
        "$PUMPRUN",
        "https://pumprun-web3.pages.dev",
        "https://pumprun-web3.pages.dev?ref=0x1234567890123456789012345678901234567890"
      );
      const json = JSON.stringify(keyboard);

      expect(json).toContain("web_app");
      expect(json).toContain("https://pumprun-web3.pages.dev?ref=0x1234567890123456789012345678901234567890");
      expect(json).toContain("🚀 Buka DApp (Ref Active)");
      expect(json).toContain("🔗 Bagikan ke Teman");
      expect(json).toContain("https://t.me/share/url");
      expect(json).toContain("💸 Cek Komisi 5%");
      expect(json).toContain("https://pumprun-web3.pages.dev#flywheel");
    });

    it("should omit web_app if referralUrl is not https", () => {
      const keyboard = buildReferralKeyboard(
        "PUMP",
        "http://localhost:3000",
        "http://localhost:3000?ref=0x123"
      );
      const json = JSON.stringify(keyboard);

      expect(json).not.toContain("web_app");
      expect(json).toContain("🔗 Bagikan ke Teman");
      expect(json).toContain("http%3A%2F%2Flocalhost%3A3000%3Fref%3D0x123");
    });

    it("should sanitize leading dollar sign on ticker", () => {
      const keyboard = buildReferralKeyboard(
        "$OMNI",
        "https://omni.xyz",
        "https://omni.xyz?ref=0xABC"
      );
      const json = JSON.stringify(keyboard);
      expect(json).toContain("OMNI");
    });
  });

  describe("buildDividendKeyboard", () => {
    it("should generate dividend keyboard with WebApp pointing to #flywheel", () => {
      const keyboard = buildDividendKeyboard(
        "PUMPRUN",
        "https://pumprun-web3.pages.dev",
        "https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=0x123"
      );
      const json = JSON.stringify(keyboard);

      expect(json).toContain("web_app");
      expect(json).toContain("https://pumprun-web3.pages.dev#flywheel");
      expect(json).toContain("📊 Cek Dividen Dompet Saya");
      expect(json).toContain("🦄 Beli $PUMPRUN");
      expect(json).toContain("https://app.uniswap.org/swap");
      expect(json).toContain("🌐 Website DApp");
    });

    it("should omit web_app when websiteUrl is not https", () => {
      const keyboard = buildDividendKeyboard(
        "TEST",
        "http://localhost:3000",
        "https://app.uniswap.org/swap"
      );
      const json = JSON.stringify(keyboard);

      expect(json).not.toContain("web_app");
      expect(json).toContain("🦄 Beli $TEST");
    });
  });

  describe("buildJackpotKeyboard", () => {
    it("should generate jackpot keyboard with WebApp, Uniswap timer reset, and DexScreener chart", () => {
      const keyboard = buildJackpotKeyboard(
        "$PUMPRUN",
        "https://pumprun-web3.pages.dev",
        "https://app.uniswap.org/swap?chain=base&outputCurrency=0xCA",
        "https://dexscreener.com/base/0xCA"
      );
      const json = JSON.stringify(keyboard);

      expect(json).toContain("web_app");
      expect(json).toContain("https://pumprun-web3.pages.dev#flywheel");
      expect(json).toContain("🎰 Buka Live Jackpot DApp");
      expect(json).toContain("⚡ Reset Timer (Beli di Uniswap)");
      expect(json).toContain("📊 DexScreener Live");
      expect(json).toContain("https://dexscreener.com/base/0xCA");
    });

    it("should omit web_app when websiteUrl is not https", () => {
      const keyboard = buildJackpotKeyboard(
        "TEST",
        "http://localhost:3000",
        "https://app.uniswap.org/swap",
        "https://dexscreener.com/base/0xTEST"
      );
      const json = JSON.stringify(keyboard);

      expect(json).not.toContain("web_app");
      expect(json).toContain("⚡ Reset Timer (Beli di Uniswap)");
    });
  });
});
