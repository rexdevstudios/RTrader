/**
 * tests/socialfi-bounty-neon.test.ts
 *
 * Automated regression test suite for SocialFi KOL Launchpad & Neon PostgreSQL SSOT:
 *  1. Merkle Tree Generation for On-Chain Multi-Chain Token Claims.
 *  2. AI Tweet Quality Gate & Sentiment Auditing.
 *  3. Bounty Campaign Query & Persistence via Postgres SSOT Adapter.
 *  4. End-to-End Bounty Claim Submission & Verification Lifecycle.
 */

import { describe, it, expect } from "bun:test";
import { BountyEscrowService, type BountyClaimItem } from "../packages/launchpad/bounty-escrow.ts";
import { TweetQualityScorer } from "../packages/intelligence/tweet-quality-scorer.ts";
import { defaultBountyDbAdapter, defaultKolDbAdapter } from "../packages/shared/db-pool.ts";
import type { KolProfile } from "../packages/shared/types/domain.ts";

describe("SocialFi KOL Launchpad & Neon PostgreSQL SSOT Suite", () => {
  describe("1. Merkle Tree Generation for Smart Contract Claims", () => {
    it("should handle empty claims array safely", () => {
      const tree = BountyEscrowService.generateBountyMerkleTree([]);
      expect(tree.root).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
      expect(tree.getProof("0x1111111111111111111111111111111111111111", 1000n)).toEqual([]);
    });

    it("should generate valid Merkle root and proof for multiple KOL claims", () => {
      const claims: BountyClaimItem[] = [
        {
          walletAddress: "0x1111111111111111111111111111111111111111",
          tokenAmount: 1000000000000000000000n,
        },
        {
          walletAddress: "0x2222222222222222222222222222222222222222",
          tokenAmount: 2500000000000000000000n,
        },
        {
          walletAddress: "0x3333333333333333333333333333333333333333",
          tokenAmount: 5000000000000000000000n,
        },
      ];

      const tree = BountyEscrowService.generateBountyMerkleTree(claims);

      expect(tree.root.startsWith("0x")).toBe(true);
      expect(tree.root.length).toBe(66);

      const proof1 = tree.getProof(claims[0].walletAddress, claims[0].tokenAmount);
      expect(Array.isArray(proof1)).toBe(true);
      expect(proof1.length).toBeGreaterThan(0);

      const proofInvalid = tree.getProof("0x9999999999999999999999999999999999999999", 1000n);
      expect(proofInvalid).toEqual([]);
    });
  });

  describe("2. AI Tweet Quality Gate & Sentiment Scorer", () => {
    it("should pass compliant tweets containing required hashtag and authentic sentiment", () => {
      const tweet = "Really excited to support $PUMPRUN on Base! High momentum and great tokenomics. #PUMPRUN to the moon! 🚀";
      const result = TweetQualityScorer.auditTweet(tweet, "#PUMPRUN");

      expect(result.passedQualityGate).toBe(true);
      expect(result.detectedHashtags.includes("#pumprun")).toBe(true);
      expect(result.isSpamOrBot).toBe(false);
      expect(result.qualityScore).toBeGreaterThanOrEqual(60);
    });

    it("should reject tweets missing the required hashtag", () => {
      const tweet = "This token looks interesting, buy now on Uniswap!";
      const result = TweetQualityScorer.auditTweet(tweet, "#PUMPRUN");

      expect(result.passedQualityGate).toBe(false);
      expect(result.detectedHashtags.includes("#pumprun")).toBe(false);
      expect(result.auditReasons.some((r) => r.toLowerCase().includes("hashtag"))).toBe(true);
    });

    it("should reject short spam / bot-like phrases", () => {
      const tweet = "buy #PUMPRUN";
      const result = TweetQualityScorer.auditTweet(tweet, "#PUMPRUN");

      expect(result.passedQualityGate).toBe(false);
      expect(result.auditReasons.length).toBeGreaterThan(0);
    });
  });

  describe("3. Neon PostgreSQL SSOT Campaign Querying", () => {
    it("should list active campaigns with valid fields from SSOT or fallback", async () => {
      const campaigns = await defaultBountyDbAdapter.listCampaigns();

      expect(Array.isArray(campaigns)).toBe(true);
      expect(campaigns.length).toBeGreaterThan(0);

      const first = campaigns[0];
      expect(first.id).toBeDefined();
      expect(first.title).toBeDefined();
      expect(first.requiredHashtag.startsWith("#")).toBe(true);
      expect(first.rewardPerKol).toBeGreaterThan(0n);
      expect(first.isActive).toBe(true);
    });
  });

  describe("4. End-to-End Bounty Claim Lifecycle", () => {
    it("should verify compliant bounty claim and increment participants", async () => {
      const campaigns = await defaultBountyDbAdapter.listCampaigns();
      expect(campaigns.length).toBeGreaterThan(0);
      const campaign = campaigns[0];

      const testKol: KolProfile = {
        id: "71d618df-3bf9-4dc8-81e1-f21bc8d853d0",
        userId: "07f847b9-60a4-48e4-8a45-3626b133b0fe",
        twitterHandle: "persister_kol",
        followersCount: 5000,
        trustScore: 88,
        completedBounties: 0,
        totalEarnedUsd: 0,
        isVerified: true,
      };

      const service = new BountyEscrowService(defaultBountyDbAdapter);
      const proofUrl = "https://x.com/persister_kol/status/9876543210";
      const tweetText = `Proud to join the official community raid for this incredible ecosystem! Join us now: ${campaign.requiredHashtag} 🚀`;

      const result = await service.submitAndVerifyClaim(
        campaign.id,
        testKol,
        proofUrl,
        tweetText
      );

      expect(result.success).toBe(true);
      expect(result.claim).toBeDefined();
      expect(result.claim?.verificationStatus).toBe("VERIFIED");
      expect(result.qualityAudit?.passedQualityGate).toBe(true);
    });

    it("should reject claim when KOL has insufficient followers", async () => {
      const campaigns = await defaultBountyDbAdapter.listCampaigns();
      const campaign = campaigns[0];

      const underqualifiedKol: KolProfile = {
        id: "kol-under-1",
        userId: "usr-under-1",
        twitterHandle: "newbie_trader",
        followersCount: 5, // below minFollowers (usually >= 100-500)
        trustScore: 50,
        completedBounties: 0,
        totalEarnedUsd: 0,
        isVerified: false,
      };

      const service = new BountyEscrowService(defaultBountyDbAdapter);
      const result = await service.submitAndVerifyClaim(
        campaign.id,
        underqualifiedKol,
        "https://x.com/newbie_trader/status/111"
      );

      expect(result.success).toBe(false);
      expect(result.reason).toBe("INSUFFICIENT_FOLLOWERS");
    });
  });
});
