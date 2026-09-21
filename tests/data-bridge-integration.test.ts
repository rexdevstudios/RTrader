/**
 * tests/data-bridge-integration.test.ts
 *
 * Automated Integration Test Suite for Phase 2:
 * Automated On-Chain & SSOT Data Bridge.
 *
 * Tests:
 *  1. Multibot execution plane sync to Neon PostgreSQL master SSOT (neondb).
 *  2. Relational integrity (entities -> launch_drafts -> token_launches -> bounty_campaigns).
 *  3. Control Plane adapters (defaultDraftDbAdapter & defaultBountyDbAdapter).
 *  4. 3D Parallax Swap Widget calldata and referral selector (0x07226af5).
 */

import { describe, it, expect, afterAll } from "bun:test";
import { syncTokenDeploymentToNeon, getNeonMasterSql, isNeonConfigured } from "../src/db/neon-vault.ts";
import { defaultDraftDbAdapter, defaultBountyDbAdapter } from "../packages/shared/db-pool.ts";
import { ethers } from "ethers";

describe("Phase 2: Automated On-Chain & SSOT Data Bridge Suite", () => {
  const testTicker = "BRIDGEX";
  const testCA = "0x" + "b81d9e20".repeat(5);
  const testWallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  let createdLaunchId: string | undefined;
  let createdDraftId: string | undefined;
  let createdCampaignId: string | undefined;

  it("should verify Neon PostgreSQL connection is active", () => {
    expect(isNeonConfigured()).toBe(true);
  });

  it("should sync token deployment to both isolated DB and master SSOT (neondb)", async () => {
    const res = await syncTokenDeploymentToNeon({
      contractAddr: testCA,
      ticker: testTicker,
      tokenName: "Bridge Integration Token",
      chain: "base",
      poolId: "0xpool1234567890abcdef1234567890abcdef1234",
      txHash: "0xtx1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      websiteUrl: "https://bridgex-web3.pages.dev",
      creatorWallet: testWallet,
      description: "Automated Data Bridge Verification Token",
      launchMode: "BONDING_CURVE",
    });

    expect(res.success).toBe(true);
    expect(res.dbName).toBe("token_bridgex");
    expect(res.tokenLaunchId).toBeDefined();
    expect(res.draftId).toBeDefined();

    createdLaunchId = res.tokenLaunchId;
    createdDraftId = res.draftId;

    // Verify directly on master PostgreSQL
    const masterSql = getNeonMasterSql();
    try {
      const launchRows = await masterSql`
        SELECT * FROM token_launches WHERE id = ${createdLaunchId} LIMIT 1;
      `;
      expect(launchRows.length).toBe(1);
      expect(launchRows[0].contract_address.toLowerCase()).toBe(testCA.toLowerCase());
      expect(launchRows[0].chain).toBe("base-mainnet");

      const draftRows = await masterSql`
        SELECT * FROM launch_drafts WHERE id = ${createdDraftId} LIMIT 1;
      `;
      expect(draftRows.length).toBe(1);
      expect(draftRows[0].ticker).toBe(testTicker);
      expect(draftRows[0].status).toBe("PUBLISHED");
    } finally {
      await masterSql.close().catch(() => {});
    }
  }, 45000);

  it("should read active token launches via defaultDraftDbAdapter in Control Plane", async () => {
    const activeLaunches = await defaultDraftDbAdapter.getActiveTokenLaunches();
    expect(Array.isArray(activeLaunches)).toBe(true);
    expect(activeLaunches.length).toBeGreaterThan(0);

    const match = activeLaunches.find((l: any) => l.ticker === testTicker);
    expect(match).toBeDefined();
    expect(match.contractAddress.toLowerCase()).toBe(testCA.toLowerCase());
    expect(match.chain).toBe("base-mainnet");
    expect(match.launchMode).toBe("BONDING_CURVE");
  });

  it("should create and list a bounty campaign linked to the synced token_launch", async () => {
    expect(createdLaunchId).toBeDefined();

    const campaignId = await defaultBountyDbAdapter.createCampaign({
      id: "test-camp-" + Date.now(),
      launchId: createdLaunchId!,
      creatorId: testWallet,
      title: "Bridge Viral Raid Bounty",
      requiredHashtag: "#BridgeXRaid",
      minFollowers: 250,
      rewardPerKol: 500000000000000000000n, // 500 tokens
      maxParticipants: 25,
      currentParticipants: 0,
      isActive: true,
    });

    createdCampaignId = campaignId;
    expect(campaignId).toBeDefined();

    const campaigns = await defaultBountyDbAdapter.listCampaigns();
    expect(Array.isArray(campaigns)).toBe(true);
    expect(campaigns.length).toBeGreaterThan(0);

    const match = campaigns.find((c: any) => c.id === campaignId || c.requiredHashtag === "#BridgeXRaid");
    expect(match).toBeDefined();
    expect(match.title).toBe("Bridge Viral Raid Bounty");
  });

  it("should verify 3D Parallax Swap Widget buyTokensWithReferral calldata construction", () => {
    const selector = "0x07226af5";
    const iface = new ethers.Interface([
      "function buyTokensWithReferral(address tokenAddress, uint256 tokenAmount, address payable referralWallet) payable"
    ]);

    expect(iface.getFunction("buyTokensWithReferral")?.selector).toBe(selector);

    const tokenAddr = testCA;
    const tokenAmount = 250000n * 10n ** 18n;
    const referralWallet = testWallet;

    const encoded = iface.encodeFunctionData("buyTokensWithReferral", [tokenAddr, tokenAmount, referralWallet]);
    expect(encoded.startsWith(selector)).toBe(true);

    // Verify manual lightweight client hex packing matches ethers exact output
    const cleanCa = tokenAddr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const tokenAmountHex = tokenAmount.toString(16).padStart(64, "0");
    const cleanRef = referralWallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const manualCalldata = selector + cleanCa + tokenAmountHex + cleanRef;

    expect(manualCalldata.toLowerCase()).toBe(encoded.toLowerCase());
  });

  afterAll(async () => {
    // Clean up test records from master SSOT to maintain clean database state
    if (createdCampaignId || createdLaunchId || createdDraftId) {
      const masterSql = getNeonMasterSql();
      try {
        if (createdCampaignId) {
          await masterSql`DELETE FROM bounty_campaigns WHERE id::text = ${createdCampaignId} OR required_hashtag = '#BridgeXRaid';`.catch(() => {});
        }
        if (createdLaunchId) {
          await masterSql`DELETE FROM token_launches WHERE id::text = ${createdLaunchId};`.catch(() => {});
          await masterSql`DELETE FROM entities WHERE id::text = ${createdLaunchId};`.catch(() => {});
        }
        if (createdDraftId) {
          await masterSql`DELETE FROM launch_drafts WHERE id::text = ${createdDraftId};`.catch(() => {});
          await masterSql`DELETE FROM entities WHERE id::text = ${createdDraftId};`.catch(() => {});
        }
      } finally {
        await masterSql.close().catch(() => {});
      }
    }
  });
});
