/**
 * tests/telegram-webapp-integration.test.ts
 *
 * Automated tests for Telegram WebApp Button integration and URL safety guards.
 */

import { describe, it, expect } from "bun:test";
import {
  buildTelegramWebsiteKeyboard,
  broadcastAndPinTokenWebsite,
} from "../src/modules/telegram/token-agent-bot.ts";

describe("Telegram WebApp Button Integration Suite", () => {
  it("should attach a web_app button when websiteUrl starts with https://", () => {
    const keyboard = buildTelegramWebsiteKeyboard("PUMP", "https://pump-official.vercel.app");
    const json = JSON.stringify(keyboard);

    expect(json).toContain("web_app");
    expect(json).toContain("https://pump-official.vercel.app");
    expect(json).toContain("🚀 Buka Web3 DApp ($PUMP)");
    expect(json).toContain("🌐 Website Resmi");
    expect(json).toContain("https://pump-official.vercel.app#swap");
  });

  it("should omit web_app button and only provide standard url buttons if websiteUrl is not https", () => {
    const keyboard = buildTelegramWebsiteKeyboard("$ALPHA", "http://localhost:3000");
    const json = JSON.stringify(keyboard);

    // Telegram Bot API rejects web_app with non-https URLs, so web_app MUST be omitted
    expect(json).not.toContain("web_app");
    expect(json).toContain("🌐 Website Resmi");
    expect(json).toContain("http://localhost:3000");
    expect(json).toContain("http://localhost:3000#swap");
  });

  it("should sanitize ticker by removing leading dollar sign and capitalizing", () => {
    const keyboard = buildTelegramWebsiteKeyboard("$doge", "https://doge-moon.vercel.app");
    const json = JSON.stringify(keyboard);

    expect(json).toContain("🚀 Buka Web3 DApp ($DOGE)");
  });

  it("should safely handle empty or undefined URL gracefully without crashing", () => {
    const keyboard = buildTelegramWebsiteKeyboard("TEST", "");
    const json = JSON.stringify(keyboard);

    expect(json).not.toContain("web_app");
  });

  it("should fail gracefully if botToken is missing in broadcast", async () => {
    const res = await broadcastAndPinTokenWebsite(
      {
        address: "0x1234567890abcdef1234567890abcdef12345678",
        ticker: "NOBOT",
        name: "No Bot Token",
        chain: "base",
      },
      { botToken: "" }
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("TIDAK_ADA_BOT_TOKEN");
  });

  it("should fail gracefully if targetChat is missing in broadcast", async () => {
    const origChannel = process.env.COMMUNITY_TELEGRAM_CHANNEL;
    const origChatId = process.env.COMMUNITY_TELEGRAM_CHAT_ID;
    delete process.env.COMMUNITY_TELEGRAM_CHANNEL;
    delete process.env.COMMUNITY_TELEGRAM_CHAT_ID;
    try {
      const res = await broadcastAndPinTokenWebsite(
        {
          address: "0x1234567890abcdef1234567890abcdef12345678",
          ticker: "NOCHAT",
          name: "No Chat",
          chain: "base",
        },
        { botToken: "123456789:MOCK_TOKEN_XYZ", chatId: "" }
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("TIDAK_ADA_CHAT_ID");
    } finally {
      if (origChannel) process.env.COMMUNITY_TELEGRAM_CHANNEL = origChannel;
      if (origChatId) process.env.COMMUNITY_TELEGRAM_CHAT_ID = origChatId;
    }
  });
});
