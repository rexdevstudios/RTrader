/**
 * tests/telegram-announcement-pack.test.ts
 *
 * Automated test suite for the Telegram Broadcast Formatting Pack (Post-Launch Blitz).
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  generateLaunchAnnouncementPack,
  saveLaunchAnnouncementPack,
} from "../src/modules/growth/launch-pack-generator.ts";

describe("Telegram Broadcast Formatting Pack (Post-Launch Blitz) Suite", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_telegram_pack");

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe("1. Telegram Card Generation Engine", () => {
    it("should generate rich HTML card with <code> tag for 1-tap CA copying", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "TELE",
        name: "Telegram Alpha Protocol",
        contractAddress: "0x7777777777777777777777777777777777777777",
        chain: "base",
      });

      expect(pack.telegram).toBeDefined();

      // HTML Card assertions
      const html = pack.telegram.htmlCard;
      expect(html).toContain("<b>OFFICIAL LAUNCH ALPHA: $TELE (Telegram Alpha Protocol)</b>");
      expect(html).toContain("<code>0x7777777777777777777777777777777777777777</code>");
      expect(html).toContain("<b>Chain:</b> Base Mainnet");
      expect(html).toContain("30% Auto Buyback & Burn");
      expect(html).toContain("0x000000000000000000000000000000000000dEaD");
      expect(html).toContain("dexscreener.com/base/0x7777777777777777777777777777777777777777");
      expect(html).toContain("app.uniswap.org");
    });

    it("should generate MarkdownV2/Standard Markdown card for community bots", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "ROSE",
        name: "Rose Bot Friendly",
        contractAddress: "0x2222222222222222222222222222222222222222",
        chain: "base",
      });

      const md = pack.telegram.markdownCard;
      expect(md).toContain("*OFFICIAL LAUNCH ALPHA: $ROSE (Rose Bot Friendly)*");
      expect(md).toContain("`0x2222222222222222222222222222222222222222`");
      expect(md).toContain("[Live DexScreener Chart]");
      expect(md).toContain("[1-Click Swap]");
      expect(md).toContain("[Official Web3 DApp]");
    });

    it("should generate valid 1-click share web deep link for instant forwarding", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "VIRAL",
        name: "Viral Meme Coin",
        contractAddress: "0x5555555555555555555555555555555555555555",
        chain: "base",
        websiteUrl: "https://viral-dapp.vercel.app",
      });

      const deepLink = pack.telegram.shareDeepLink;
      expect(deepLink).toStartWith("https://t.me/share/url?");
      expect(deepLink).toContain("url=https%3A%2F%2Fviral-dapp.vercel.app");
      expect(deepLink).toContain("0x5555555555555555555555555555555555555555");
    });

    it("should structure 2x2 inline keyboard button matrix", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "BUTTONS",
        name: "Buttons Test",
        contractAddress: "0x3333333333333333333333333333333333333333",
        chain: "base",
      });

      const kb = pack.telegram.inlineKeyboard;
      expect(kb).toHaveLength(2);
      expect(kb[0]).toHaveLength(2);
      expect(kb[1]).toHaveLength(2);

      // Row 1: DexScreener + Swap
      expect(kb[0][0].text).toContain("DexScreener");
      expect(kb[0][0].url).toContain("dexscreener.com");
      expect(kb[0][1].text).toContain("Swap");
      expect(kb[0][1].url).toContain("uniswap.org");

      // Row 2: WebApp + Telegram
      expect(kb[1][0].text).toContain("Web3 DApp");
      expect(kb[1][1].text).toContain("Telegram");
    });

    it("should adapt links and tags properly for Solana chain", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "SOLTG",
        name: "Solana Telegram Protocol",
        contractAddress: "So11111111111111111111111111111111111111112",
        chain: "solana",
      });

      expect(pack.telegram.htmlCard).toContain("<b>Chain:</b> Solana");
      expect(pack.telegram.htmlCard).toContain("jup.ag/swap/SOL-");
      expect(pack.telegram.inlineKeyboard[0][1].url).toContain("jup.ag");
    });
  });

  describe("2. File Persistence & Dedicated Exports", () => {
    it("should save dedicated telegram-announcement.txt and telegram-announcement.json", () => {
      const pack = generateLaunchAnnouncementPack({
        ticker: "TGSAVE",
        name: "Telegram Save Token",
        contractAddress: "0x4444444444444444444444444444444444444444",
        chain: "base",
      });

      const saved = saveLaunchAnnouncementPack(testOutputDir, pack);

      expect(fs.existsSync(saved.telegramTxtPath)).toBe(true);
      expect(fs.existsSync(saved.telegramJsonPath)).toBe(true);
      expect(fs.existsSync(saved.txtPath)).toBe(true);
      expect(fs.existsSync(saved.jsonPath)).toBe(true);

      // Verify telegram.txt content
      const txt = fs.readFileSync(saved.telegramTxtPath, "utf-8");
      expect(txt).toContain("[FORMAT 1: HTML RICH MESSAGE");
      expect(txt).toContain("[FORMAT 2: MARKDOWN MESSAGE");
      expect(txt).toContain("[FORMAT 3: 1-CLICK SHARE DEEP-LINK]");
      expect(txt).toContain("[FORMAT 4: INLINE KEYBOARD BUTTONS (JSON)]");
      expect(txt).toContain("0x4444444444444444444444444444444444444444");

      // Verify telegram.json content
      const json = JSON.parse(fs.readFileSync(saved.telegramJsonPath, "utf-8"));
      expect(json.htmlCard).toBeDefined();
      expect(json.shareDeepLink).toBeDefined();
      expect(json.inlineKeyboard.length).toBe(2);

      // Verify omnichannel launch-announcement.txt contains Option C
      const omniTxt = fs.readFileSync(saved.txtPath, "utf-8");
      expect(omniTxt).toContain("[OPTION C: TELEGRAM POST-LAUNCH BLITZ (HTML FORMAT)]");
      expect(omniTxt).toContain("[TELEGRAM 1-CLICK SHARE WEB LINK]");
    });
  });
});
