/**
 * tests/telegram-bot-pool.test.ts
 *
 * Comprehensive Test Suite for Pre-Provisioned Telegram Bot Pool,
 * DAO Allocation, Lifecycle Idempotency, and Fail-Safe Fallbacks.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  addBotToPool,
  acquireBotFromPool,
  releaseBotToPool,
  syncBotPoolFromEnv,
  getBotPoolSummary,
  listBotPool,
  peekNextAvailableBot,
  updateBotPoolUsername,
} from "../src/db/vault.ts";
import { broadcastTokenLaunchAnnouncement } from "../src/modules/social/beacon-broadcaster.ts";

describe("Pre-Provisioned Telegram Bot Pool & Zero-Prompt DAO Suite", () => {
  const TEST_PREFIX = `test_token_${Date.now()}`;

  beforeEach(() => {
    // Reset env pool before each test
    delete process.env.TELEGRAM_BOT_POOL;
  });

  describe("1. Token Ingestion & Validation (addBotToPool)", () => {
    it("1.1 should reject empty or short tokens (< 10 chars)", () => {
      const resEmpty = addBotToPool("");
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.reason).toContain("pendek");

      const resShort = addBotToPool("12345:abc");
      expect(resShort.success).toBe(false);
      expect(resShort.reason).toContain("pendek");
    });

    it("1.2 should successfully add a valid bot token with AVAILABLE status", () => {
      const token = `${TEST_PREFIX}_valid_1234567890`;
      const res = addBotToPool(token, "test_alpha_bot");
      expect(res.success).toBe(true);

      const list = listBotPool();
      const found = list.find((b) => b.botToken === token);
      expect(found).toBeDefined();
      expect(found?.status).toBe("AVAILABLE");
      expect(found?.botUsername).toBe("test_alpha_bot");
      expect(found?.assignedContractAddr).toBeNull();
    });

    it("1.3 should safely strip leading @ from username", () => {
      const token = `${TEST_PREFIX}_strip_at_1234567890`;
      const res = addBotToPool(token, "@clean_username_bot");
      expect(res.success).toBe(true);

      const list = listBotPool();
      const found = list.find((b) => b.botToken === token);
      expect(found?.botUsername).toBe("clean_username_bot");
    });

    it("1.4 should handle duplicate token gracefully without throwing", () => {
      const token = `${TEST_PREFIX}_dup_1234567890`;
      const first = addBotToPool(token, "bot_v1");
      expect(first.success).toBe(true);

      // Attempt duplicate insertion
      const second = addBotToPool(token, "bot_v2_updated");
      expect(second.success).toBe(false);
      expect(second.reason).toContain("sudah ada");

      // Verify username was updated on conflict
      const list = listBotPool();
      const found = list.find((b) => b.botToken === token);
      expect(found?.botUsername).toBe("bot_v2_updated");
    });
  });

  describe("2. Atomic Allocation & Idempotency (acquireBotFromPool)", () => {
    it("2.1 should atomically acquire next available bot and assign to CA", () => {
      const token = `${TEST_PREFIX}_acq_1234567890`;
      addBotToPool(token, "acq_test_bot");

      const testCa = `0xCA_${Date.now()}_A1`;
      const acquired = acquireBotFromPool(testCa);
      expect(acquired).not.toBeNull();
      expect(acquired?.botToken).toBeDefined();

      // Verify status in DB is now ASSIGNED for the acquired token
      const list = listBotPool();
      const row = list.find((b) => b.botToken === acquired?.botToken);
      expect(row?.status).toBe("ASSIGNED");
      expect(row?.assignedContractAddr?.toLowerCase()).toBe(testCa.toLowerCase());
      expect(row?.assignedAt).not.toBeNull();
    });

    it("2.2 should guarantee idempotency: re-acquiring for the same CA returns the same bot", () => {
      const testCa = `0xCA_${Date.now()}_IDEM`;
      const first = acquireBotFromPool(testCa);
      const second = acquireBotFromPool(testCa);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first?.botToken).toBe(second?.botToken);
      expect(first?.botUsername).toBe(second?.botUsername);
    });

    it("2.3 should return null without throwing when pool is exhausted", () => {
      const nonExistentCa = `0xCA_EMPTY_POOL_${Date.now()}`;
      // Drain remaining available bots
      const drainedCas: string[] = [];
      while (true) {
        const dummyCa = `0xDRAIN_${Date.now()}_${Math.random()}`;
        const b = acquireBotFromPool(dummyCa);
        if (!b) break;
        drainedCas.push(dummyCa);
      }

      // Now pool is definitely empty of AVAILABLE bots
      const res = acquireBotFromPool(nonExistentCa);
      expect(res).toBeNull();

      // Restore drained bots
      for (const dCa of drainedCas) {
        releaseBotToPool(dCa);
      }
    });
  });

  describe("3. Pool Release & Lifecycle (releaseBotToPool)", () => {
    it("3.1 should release assigned bot back to AVAILABLE status", () => {
      const testCa = `0xCA_RELEASE_${Date.now()}`;
      const acquired = acquireBotFromPool(testCa);
      expect(acquired).not.toBeNull();

      // Verify assigned
      const afterAcq = listBotPool().find((b) => b.botToken === acquired?.botToken);
      expect(afterAcq?.status).toBe("ASSIGNED");

      // Release back to pool
      const released = releaseBotToPool(testCa);
      expect(released).toBe(true);

      const afterRel = listBotPool().find((b) => b.botToken === acquired?.botToken);
      expect(afterRel?.status).toBe("AVAILABLE");
      expect(afterRel?.assignedContractAddr).toBeNull();
      expect(afterRel?.assignedAt).toBeNull();
    });

    it("3.2 should return false when releasing unknown CA", () => {
      const res = releaseBotToPool("0xNON_EXISTENT_CA_9999");
      expect(res).toBe(false);
    });
  });

  describe("4. Environment Variable Synchronization (syncBotPoolFromEnv)", () => {
    it("4.1 should parse comma-separated tokens from TELEGRAM_BOT_POOL", () => {
      const tokA = `${TEST_PREFIX}_env_tokA_1234567890`;
      const tokB = `${TEST_PREFIX}_env_tokB_1234567890`;
      process.env.TELEGRAM_BOT_POOL = `${tokA}, ${tokB}`;

      const syncResult = syncBotPoolFromEnv();
      expect(syncResult.added).toBeGreaterThanOrEqual(2);

      const list = listBotPool();
      expect(list.some((b) => b.botToken === tokA)).toBe(true);
      expect(list.some((b) => b.botToken === tokB)).toBe(true);
    });

    it("4.2 should gracefully handle empty or undefined TELEGRAM_BOT_POOL", () => {
      delete process.env.TELEGRAM_BOT_POOL;
      const res = syncBotPoolFromEnv();
      expect(res.added).toBe(0);
    });
  });

  describe("5. Inventory Summary (getBotPoolSummary)", () => {
    it("5.1 should accurately report available, assigned, and total metrics", () => {
      const summaryBefore = getBotPoolSummary();

      const tok = `${TEST_PREFIX}_sum_1234567890`;
      addBotToPool(tok, "summary_bot");

      const summaryAfterAdd = getBotPoolSummary();
      expect(summaryAfterAdd.available).toBe(summaryBefore.available + 1);
      expect(summaryAfterAdd.total).toBe(summaryBefore.total + 1);

      const ca = `0xCA_SUM_${Date.now()}`;
      acquireBotFromPool(ca);

      const summaryAfterAcq = getBotPoolSummary();
      expect(summaryAfterAcq.available).toBe(summaryBefore.available);
      expect(summaryAfterAcq.assigned).toBe(summaryBefore.assigned + 1);

      // Clean up
      releaseBotToPool(ca);
    });

    it("5.2 should flag lowPoolAlert when available bots <= 2 and total > 0", () => {
      // Drain bots until available <= 2
      const drained: string[] = [];
      while (true) {
        const s = getBotPoolSummary();
        if (s.available <= 2) {
          expect(s.lowPoolAlert).toBe(true);
          break;
        }
        const tempCa = `0xCA_DRAIN_ALERT_${Date.now()}_${Math.random()}`;
        acquireBotFromPool(tempCa);
        drained.push(tempCa);
      }

      // Restore drained bots
      for (const dCa of drained) {
        releaseBotToPool(dCa);
      }
    });
  });

  describe("6. Pre-Allocation & Authentic IPFS Embedding (peekNextAvailableBot)", () => {
    it("6.1 should peek the next available bot without changing its status to ASSIGNED", () => {
      const tok = `${TEST_PREFIX}_peek_1234567890`;
      addBotToPool(tok, "peek_bot");

      const peeked = peekNextAvailableBot();
      expect(peeked).not.toBeNull();
      expect(peeked?.botToken).toBeDefined();

      // Ensure status is STILL 'AVAILABLE'
      const row = listBotPool().find((b) => b.botToken === peeked?.botToken);
      expect(row?.status).toBe("AVAILABLE");
      expect(row?.assignedContractAddr).toBeNull();
    });

    it("6.2 should update bot username in pool via updateBotPoolUsername", () => {
      const tok = `${TEST_PREFIX}_update_user_1234567890`;
      addBotToPool(tok);

      const peeked = peekNextAvailableBot();
      expect(peeked).not.toBeNull();

      const updated = updateBotPoolUsername(peeked!.id, "@new_live_bot_name");
      expect(updated).toBe(true);

      const row = listBotPool().find((b) => b.id === peeked!.id);
      expect(row?.botUsername).toBe("new_live_bot_name");
    });

    it("6.3 should atomically claim the preallocated bot using preferredBotId", () => {
      const tokTarget = `${TEST_PREFIX}_target_1234567890`;
      addBotToPool(tokTarget, "target_preferred_bot");

      const list = listBotPool();
      const targetRow = list.find((b) => b.botToken === tokTarget);
      expect(targetRow).toBeDefined();

      const testCa = `0xCA_PREF_${Date.now()}`;
      const acquired = acquireBotFromPool(testCa, targetRow!.id);

      expect(acquired).not.toBeNull();
      expect(acquired?.id).toBe(targetRow!.id);
      expect(acquired?.botToken).toBe(tokTarget);
      expect(acquired?.botUsername).toBe("target_preferred_bot");

      // Verify DB shows ASSIGNED to testCa
      const afterRow = listBotPool().find((b) => b.id === targetRow!.id);
      expect(afterRow?.status).toBe("ASSIGNED");
      expect(afterRow?.assignedContractAddr).toBe(testCa);
    });
  });

  describe("7. Community Launch Broadcaster (broadcastTokenLaunchAnnouncement)", () => {
    it("7.1 should format launch card correctly with links", async () => {
      const res = await broadcastTokenLaunchAnnouncement({
        ticker: "ALPHA",
        name: "Alpha Meme Token",
        contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
        chain: "base",
        botUsername: "alpha_dedicated_bot",
        poolId: "0xpool123",
      });

      expect(res.success).toBe(true);
      expect(res.messageText).toContain("$ALPHA");
      expect(res.messageText).toContain("0x1234567890abcdef1234567890abcdef12345678");
      expect(res.messageText).toContain("https://t.me/alpha_dedicated_bot");
      expect(res.messageText).toContain("dexscreener.com/base/");
      expect(res.messageText).toContain("uniswap.org");
    });

    it("7.2 should handle missing chat gracefully without crashing", async () => {
      // With no chat ID or token configured, it should return success=true and telegramSent=false
      delete process.env.COMMUNITY_TELEGRAM_CHANNEL;
      delete process.env.COMMUNITY_TELEGRAM_CHAT_ID;

      const res = await broadcastTokenLaunchAnnouncement({
        ticker: "BETA",
        name: "Beta Token",
        contractAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
        chain: "base",
      });

      expect(res.success).toBe(true);
      expect(res.telegramSent).toBe(false);
    });
  });
});
