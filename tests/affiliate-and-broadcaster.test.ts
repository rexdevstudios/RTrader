import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import {
  recordAffiliateBounty,
  getTopAffiliates,
  getAffiliateStats,
} from "../src/db/vault.ts";
import {
  dispatchBeaconCard,
  type BroadcastOptions,
} from "../src/modules/social/beacon-broadcaster.ts";
import {
  executeFlywheelCycle,
  calculateFeeSplit,
} from "../src/modules/growth/flywheel-engine.ts";
import { resetConfig } from "../src/config.ts";

describe("V3.1 — Social Broadcaster & Community Affiliate Ledger", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    if (axiosPostSpy) {
      axiosPostSpy.mockRestore();
    }
  });

  describe("1. SQLite Affiliate Stats Ledger & Aggregations", () => {
    const testToken = `0xTestToken_${Date.now()}`;
    const affWalletA = `0xAffiliateA_${Date.now()}`;
    const affWalletB = `0xAffiliateB_${Date.now()}`;

    it("1.1 should record a new affiliate bounty with default 20x volume routing", () => {
      const record = recordAffiliateBounty(affWalletA, testToken, 0.005);

      expect(record.affiliateAddress.toLowerCase()).toBe(affWalletA.toLowerCase());
      expect(record.tokenAddress.toLowerCase()).toBe(testToken.toLowerCase());
      expect(record.bountyEarnedWeth).toBeCloseTo(0.005, 6);
      expect(record.volumeRoutedWeth).toBeCloseTo(0.10, 6); // 20x
      expect(record.claimCount).toBe(1);
      expect(record.lastClaimedAt).toBeDefined();
    });

    it("1.2 should accumulate bounty and volume on repeated claims for the same affiliate", () => {
      // Second claim for affWalletA
      const updated = recordAffiliateBounty(affWalletA, testToken, 0.010, 0.25);

      expect(updated.bountyEarnedWeth).toBeCloseTo(0.015, 6); // 0.005 + 0.010
      expect(updated.volumeRoutedWeth).toBeCloseTo(0.35, 6); // 0.10 + 0.25
      expect(updated.claimCount).toBe(2);
    });

    it("1.3 should retrieve individual affiliate stats case-insensitively", () => {
      const statsLower = getAffiliateStats(affWalletA.toLowerCase(), testToken);
      expect(statsLower).not.toBeNull();
      expect(statsLower?.claimCount).toBe(2);

      const statsUpper = getAffiliateStats(affWalletA.toUpperCase(), testToken);
      expect(statsUpper).not.toBeNull();
      expect(statsUpper?.bountyEarnedWeth).toBeCloseTo(0.015, 6);

      const nonExistent = getAffiliateStats("0xUnknownWalletAddress", testToken);
      expect(nonExistent).toBeNull();
    });

    it("1.4 should rank top affiliates by bountyEarnedWeth DESC", () => {
      // Create affiliate B with higher bounty
      recordAffiliateBounty(affWalletB, testToken, 0.050);

      const topList = getTopAffiliates(testToken, 10);
      expect(topList.length).toBeGreaterThanOrEqual(2);

      // affWalletB should be ranked #1 because 0.050 > 0.015
      expect(topList[0].affiliateAddress.toLowerCase()).toBe(affWalletB.toLowerCase());
      expect(topList[0].bountyEarnedWeth).toBeCloseTo(0.050, 6);

      // affWalletA should be ranked #2
      expect(topList[1].affiliateAddress.toLowerCase()).toBe(affWalletA.toLowerCase());
      expect(topList[1].bountyEarnedWeth).toBeCloseTo(0.015, 6);
    });

    it("1.5 should respect limit parameter in getTopAffiliates", () => {
      const top1 = getTopAffiliates(testToken, 1);
      expect(top1.length).toBe(1);
      expect(top1[0].affiliateAddress.toLowerCase()).toBe(affWalletB.toLowerCase());
    });
  });

  describe("2. Automated Social Beacon Broadcaster", () => {
    const sampleCard = `
🔥 ─── [LIVE ON-CHAIN BURN BEACON] ─── 🔥
Token: $PUMPRUN
Status: VERIFIED ON-CHAIN INCINERATION
Burn Amount: 1,000,000 $PUMPRUN
🧾 BaseScan: https://basescan.org/tx/0x123
──────────────────────────────────────────
`.trim();

    it("2.1 should gracefully handle missing webhooks without crashing or errors", async () => {
      delete process.env.COMMUNITY_DISCORD_WEBHOOK;
      delete process.env.COMMUNITY_TELEGRAM_WEBHOOK;
      resetConfig();

      const res = await dispatchBeaconCard(sampleCard);
      expect(res.discordDispatched).toBe(false);
      expect(res.telegramDispatched).toBe(false);
      expect(res.errors.length).toBe(0);
      expect(res.cardText).toBe(sampleCard);
    });

    it("2.2 should dispatch card to Discord webhook when configured", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({ status: 204 });

      const res = await dispatchBeaconCard(sampleCard, {
        discordWebhook: "https://discord.com/api/webhooks/test/123",
      });

      expect(res.discordDispatched).toBe(true);
      expect(res.telegramDispatched).toBe(false);
      expect(res.errors.length).toBe(0);

      expect(axiosPostSpy).toHaveBeenCalledTimes(1);
      const [url, payload] = axiosPostSpy.mock.calls[0];
      expect(url).toBe("https://discord.com/api/webhooks/test/123");
      expect(payload).toEqual({ content: sampleCard });
    });

    it("2.3 should dispatch card to Telegram webhook when configured", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({ status: 200 });

      const res = await dispatchBeaconCard(sampleCard, {
        telegramWebhook: "https://api.telegram.org/bot123:token/sendMessage",
      });

      expect(res.discordDispatched).toBe(false);
      expect(res.telegramDispatched).toBe(true);
      expect(res.errors.length).toBe(0);

      expect(axiosPostSpy).toHaveBeenCalledTimes(1);
      const [url, payload] = axiosPostSpy.mock.calls[0];
      expect(url).toBe("https://api.telegram.org/bot123:token/sendMessage");
      expect(payload).toEqual({ text: sampleCard });
    });

    it("2.4 should dispatch to both Discord and Telegram concurrently", async () => {
      axiosPostSpy = spyOn(axios, "post")
        .mockResolvedValueOnce({ status: 204 })
        .mockResolvedValueOnce({ status: 200 });

      const res = await dispatchBeaconCard(sampleCard, {
        discordWebhook: "https://discord.com/api/webhooks/test/123",
        telegramWebhook: "https://api.telegram.org/bot123:token/sendMessage",
      });

      expect(res.discordDispatched).toBe(true);
      expect(res.telegramDispatched).toBe(true);
      expect(res.errors.length).toBe(0);
      expect(axiosPostSpy).toHaveBeenCalledTimes(2);
    });

    it("2.5 should catch network/HTTP errors non-blockingly without throwing", async () => {
      axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(
        new Error("Network timeout: Discord webhook unreachable")
      );

      const res = await dispatchBeaconCard(sampleCard, {
        discordWebhook: "https://discord.com/api/webhooks/test/timeout",
      });

      expect(res.discordDispatched).toBe(false);
      expect(res.errors.length).toBe(1);
      expect(res.errors[0]).toContain("Discord dispatch notice");
    });
  });

  describe("3. End-to-End Flywheel Referral Cycle Integration", () => {
    it("3.1 should automatically record affiliate bounty and dispatch beacon in executeFlywheelCycle", async () => {
      const referralWallet = `0xReferralPromotor_${Date.now()}`;
      const tokenAddress = `0xFlywheelToken_${Date.now()}`;

      // Mock axios to simulate beacon broadcaster webhook
      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({ status: 204 });

      const result = await executeFlywheelCycle({
        tokenAddress,
        tokenSymbol: "TESTPROMO",
        customWethAmount: 0.20,
        referralAddress: referralWallet,
        simulateOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.totalClaimedWeth).toBe(0.20);
      expect(result.split.creatorWeth).toBeCloseTo(0.06, 4); // 30% of 0.20
      expect(result.split.referralWeth).toBeCloseTo(0.01, 4); // 5% of 0.20
      expect(result.split.referralAddress).toBe(referralWallet);

      // Verify that affiliate_stats in SQLite was credited
      const stats = getAffiliateStats(referralWallet, tokenAddress);
      expect(stats).not.toBeNull();
      expect(stats?.bountyEarnedWeth).toBeCloseTo(0.01, 4);
      expect(stats?.claimCount).toBe(1);

      // Verify affiliate appears on leaderboard
      const top = getTopAffiliates(tokenAddress, 5);
      expect(top.some((a) => a.affiliateAddress.toLowerCase() === referralWallet.toLowerCase())).toBe(true);
    });
  });
});
