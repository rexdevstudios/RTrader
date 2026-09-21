/**
 * tests/flywheel-telegram-broadcast.test.ts
 *
 * Automated tests for Telegram Auto Buyback & Burn Hype Alert:
 *   - Rich HTML card formatting with flame emojis and 4-pillar breakdown
 *   - Interactive InlineKeyboard buttons (BaseScan, DexScreener, Uniswap, WebApp)
 *   - Fail-safe non-blocking execution under network errors or missing credentials
 *   - End-to-end integration with executeFlywheelCycle
 *   - CLI argument parsing for test broadcast
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import {
  broadcastFlywheelBurnAlert,
  type FlywheelBurnAlertParams,
} from "../src/modules/social/beacon-broadcaster.ts";
import { executeFlywheelCycle } from "../src/modules/growth/flywheel-engine.ts";
import { parseDaemonArgs } from "../scripts/run-flywheel-worker.ts";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";

describe("Flywheel Telegram Burn Hype Alert Suite", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;
  const testCA = "0x9999999999999999999999999999999999999999";
  const testTicker = "BURNTEST";

  beforeEach(() => {
    // Clean state before each test
  });

  afterEach(() => {
    if (axiosPostSpy) {
      axiosPostSpy.mockRestore();
    }
    // Clean test records from database (Rule 4 Isolation)
    try {
      const db = new Database(DB_PATH);
      db.run("DELETE FROM flywheel_events WHERE token_symbol = ? OR token_address = ?", [
        testTicker,
        testCA,
      ]);
    } catch {}
  });

  describe("1. Message Content & HTML Formatting", () => {
    it("1.1 should generate rich HTML card with flame emojis, token amount, WETH, and 0xdead", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: { ok: true, result: { message_id: 12345 } },
      });

      const params: FlywheelBurnAlertParams = {
        tokenSymbol: testTicker,
        contractAddress: testCA,
        burnedTokens: 1_500_000,
        wethUsed: 0.045,
        burnTxHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        totalClaimedWeth: 0.150,
        split: {
          creatorWeth: 0.0525,
          buybackWeth: 0.045,
          dividendWeth: 0.030,
          jackpotWeth: 0.0225,
        },
        botToken: "123456:FAKE_BOT_TOKEN",
        chatId: "-1001234567890",
      };

      const result = await broadcastFlywheelBurnAlert(params);

      expect(result.success).toBe(true);
      expect(result.telegramSent).toBe(true);
      expect(result.messageText).toContain("LIVE ON-CHAIN BURN BEACON");
      expect(result.messageText).toContain("$BURNTEST");
      expect(result.messageText).toContain("1,500,000");
      expect(result.messageText).toContain("0.045000 WETH");
      expect(result.messageText).toContain("0x000000000000000000000000000000000000dEaD");
      expect(result.messageText).toContain("Creator Kas");
      expect(result.messageText).toContain("Auto-Burn (30%)");
      expect(result.messageText).toContain("Pasif Dividen (20%)");
      expect(result.messageText).toContain("FOMO Jackpot (15%)");
    });

    it("1.2 should display SIMULASI badge when burn is simulated", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: { ok: true },
      });

      const result = await broadcastFlywheelBurnAlert({
        tokenSymbol: testTicker,
        contractAddress: testCA,
        burnedTokens: 500_000,
        wethUsed: 0.015,
        burnTxHash: "sim_burn_12345_test",
        isSimulated: true,
        botToken: "123456:FAKE_BOT_TOKEN",
        chatId: "-1001234567890",
      });

      expect(result.success).toBe(true);
      expect(result.messageText).toContain("SIMULASI");
    });
  });

  describe("2. Interactive Inline Keyboard & WebApp Attachment", () => {
    it("2.1 should attach WebApp button when websiteUrl starts with https://", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: { ok: true },
      });

      await broadcastFlywheelBurnAlert({
        tokenSymbol: testTicker,
        contractAddress: testCA,
        burnedTokens: 1_000_000,
        wethUsed: 0.03,
        burnTxHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        botToken: "123456:FAKE_BOT_TOKEN",
        chatId: "-1001234567890",
        websiteUrl: "https://burntest.pages.dev",
      });

      expect(axiosPostSpy).toHaveBeenCalledTimes(1);
      const call = axiosPostSpy.mock.calls[0];
      const payload = call[1] as any;

      expect(payload.reply_markup).toBeDefined();
      expect(payload.reply_markup.inline_keyboard).toBeDefined();

      // Row 1 should contain the WebApp button
      const row1 = payload.reply_markup.inline_keyboard[0];
      expect(row1[0].text).toContain("Buka Web3 DApp ($BURNTEST)");
      expect(row1[0].web_app.url).toBe("https://burntest.pages.dev");

      // Row 2 should contain BaseScan and DexScreener
      const row2 = payload.reply_markup.inline_keyboard[1];
      expect(row2[0].text).toContain("Bukti Tx BaseScan");
      expect(row2[1].text).toContain("DexScreener Chart");

      // Row 3 should contain Uniswap Buy
      const row3 = payload.reply_markup.inline_keyboard[2];
      expect(row3[0].text).toContain("1-Click Uniswap Buy");
    });

    it("2.2 should omit WebApp button when websiteUrl is not https", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: { ok: true },
      });

      await broadcastFlywheelBurnAlert({
        tokenSymbol: testTicker,
        contractAddress: testCA,
        burnedTokens: 1_000_000,
        wethUsed: 0.03,
        burnTxHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        botToken: "123456:FAKE_BOT_TOKEN",
        chatId: "-1001234567890",
        websiteUrl: "http://insecure-url.local",
      });

      const call = axiosPostSpy.mock.calls[0];
      const payload = call[1] as any;
      const flatButtons = payload.reply_markup.inline_keyboard.flat();

      const hasWebApp = flatButtons.some((b: any) => b.web_app !== undefined);
      expect(hasWebApp).toBe(false);
    });
  });

  describe("3. Fail-Safe & Non-Blocking Resilience", () => {
    it("3.1 should fail gracefully without throwing when botToken or chatId is missing", async () => {
      // Mock axios to ensure no unexpected calls
      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({ status: 200 });

      const result = await broadcastFlywheelBurnAlert({
        tokenSymbol: testTicker,
        contractAddress: testCA,
        burnedTokens: 500_000,
        wethUsed: 0.01,
        burnTxHash: "0xabc",
        botToken: "",
        chatId: "",
      });

      expect(result.success).toBe(true);
      expect(result.telegramSent).toBe(false);
      expect(result.messageText).toBeDefined();
    });

    it("3.2 should catch Telegram API network rejection non-blockingly", async () => {
      axiosPostSpy = spyOn(axios, "post").mockRejectedValue(new Error("ETIMEDOUT: Telegram unreachable"));

      const result = await broadcastFlywheelBurnAlert({
        tokenSymbol: testTicker,
        contractAddress: testCA,
        burnedTokens: 100_000,
        wethUsed: 0.005,
        burnTxHash: "0xabc",
        botToken: "123456:FAKE_BOT_TOKEN",
        chatId: "-1001234567890",
      });

      expect(result.success).toBe(true);
      expect(result.telegramSent).toBe(false);
      expect(result.error).toContain("Telegram send failed");
    });
  });

  describe("4. End-to-End executeFlywheelCycle Integration", () => {
    it("4.1 should trigger broadcastFlywheelBurnAlert when flywheel cycle executes", async () => {
      const origToken = process.env.TELEGRAM_BOT_TOKEN;
      const origChannel = process.env.COMMUNITY_TELEGRAM_CHANNEL;
      process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE_BOT_TOKEN";
      process.env.COMMUNITY_TELEGRAM_CHANNEL = "-1001234567890";

      try {
        axiosPostSpy = spyOn(axios, "post").mockResolvedValue({
          status: 200,
          data: { ok: true, result: { message_id: 999 } },
        });

        const res = await executeFlywheelCycle({
          tokenAddress: testCA,
          tokenSymbol: testTicker,
          customWethAmount: 0.10,
          simulateOnly: true,
        });

        expect(res.success).toBe(true);
        expect(res.split.buybackWeth).toBeCloseTo(0.03, 4); // 30% of 0.10
        expect(res.burnedTokensEstimate).toBe(Math.floor(0.03 * 100_000_000));

        // Wait a microtick for non-blocking broadcast promise
        await Bun.sleep(100);

        // Verify that axios.post was called to send the Telegram burn beacon
        expect(axiosPostSpy).toHaveBeenCalled();
      } finally {
        if (origToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = origToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;

        if (origChannel !== undefined) process.env.COMMUNITY_TELEGRAM_CHANNEL = origChannel;
        else delete process.env.COMMUNITY_TELEGRAM_CHANNEL;
      }
    });
  });

  describe("5. CLI Argument Parsing for Test Broadcast", () => {
    it("5.1 should parse --test-broadcast flag", () => {
      const args = parseDaemonArgs(["--test-broadcast"]);
      expect(args.isTestBroadcast).toBe(true);
      expect(args.isDaemon).toBe(false);
      expect(args.intervalMinutes).toBe(5);
    });

    it("5.2 should parse -t shorthand flag", () => {
      const args = parseDaemonArgs(["-t"]);
      expect(args.isTestBroadcast).toBe(true);
    });

    it("5.3 should parse --broadcast-preview flag", () => {
      const args = parseDaemonArgs(["--broadcast-preview"]);
      expect(args.isTestBroadcast).toBe(true);
    });
  });
});
