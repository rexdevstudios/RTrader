/**
 * tests/telegram-webhook.test.ts
 *
 * Automated tests for Telegram Webhook Native Bun HTTP Server.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { Bot } from "grammy";
import { startTelegramBotWebhookServer } from "../src/modules/telegram/token-agent-bot.ts";

describe("Telegram Webhook Fast-Path Dispatcher Suite", () => {
  let webhookInstance: ReturnType<typeof startTelegramBotWebhookServer> | null = null;
  const testPort = 18443;
  let receivedUpdate = false;

  afterAll(() => {
    if (webhookInstance) {
      webhookInstance.stop();
    }
  });

  it("1. should start Bun HTTP server and respond to /health probe", async () => {
    // Dummy bot instance with offline botInfo to avoid outbound getMe() network call
    const bot = new Bot("123456789:AAFakeTokenForWebhookTestingPurposeOnly", {
      botInfo: {
        id: 123456789,
        is_bot: true,
        first_name: "TestBot",
        username: "TestBot",
        can_join_groups: true,
        can_read_all_group_messages: true,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      },
    });

    bot.on("message", (ctx) => {
      receivedUpdate = true;
    });

    webhookInstance = startTelegramBotWebhookServer(bot, {
      port: testPort,
      path: "/tg-test-webhook",
    });

    expect(webhookInstance.port).toBe(testPort);
    expect(webhookInstance.webhookPath).toBe("/tg-test-webhook");

    // Ping /health
    const res = await fetch(`http://localhost:${testPort}/health`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.mode).toBe("telegram_webhook");
    expect(json.path).toBe("/tg-test-webhook");
  });

  it("2. should reject unregistered paths with 404", async () => {
    const res = await fetch(`http://localhost:${testPort}/unknown-route`);
    expect(res.status).toBe(404);
  });

  it("3. should handle incoming webhook POST requests", async () => {
    const res = await fetch(`http://localhost:${testPort}/tg-test-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update_id: 999999,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 12345, type: "private" },
          from: { id: 12345, is_bot: false, first_name: "Tester" },
          text: "/ping",
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(receivedUpdate).toBe(true);
  });

  it("4. should stop the server cleanly", () => {
    expect(() => {
      if (webhookInstance) {
        webhookInstance.stop();
        webhookInstance = null;
      }
    }).not.toThrow();
  });
});
