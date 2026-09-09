import { KolService } from '../packages/social/kol-service';
import { BountyEscrowService } from '../packages/launchpad/bounty-escrow';
import { NutritionLabelService } from '../packages/intelligence/nutrition-label';
import { ArkhamIntelligenceService } from '../packages/intelligence/arkham-enrichment';

async function runSocialFiSimulation() {
  console.log('================================================================');
  console.log('STARTING SOCIALFI & KOL LAUNCHPAD SANITY SIMULATION');
  console.log('================================================================');

  const mockDb = {
    getArkhamProfile: async () => null,
    upsertArkhamProfile: async () => {},
    createAuditLog: async () => {},
    upsertKolProfile: async (p: any) => ({ ...p, id: 'kol-1', completedBounties: 0, totalEarnedUsd: 0 }),
    getKolProfile: async (userId: string) => ({
      id: 'kol-1',
      userId,
      twitterHandle: 'cryptoking',
      followersCount: 15000,
      trustScore: 80,
      completedBounties: 0,
      totalEarnedUsd: 0,
      isVerified: true,
    }),
    getCampaign: async () => ({
      id: 'camp-1',
      launchId: 'launch-1',
      creatorId: 'creator-1',
      title: 'Degen Promo',
      isActive: true,
      requiredHashtag: '#DEGEN',
      minFollowers: 1000,
      rewardPerKol: BigInt(5000),
      currentParticipants: 0,
      maxParticipants: 5
    }),
    getClaim: async () => null,
    createClaim: async (cId: string, kId: string, url: string) => ({
      id: 'claim-1',
      campaignId: cId,
      kolId: kId,
      proofUrl: url,
      verificationStatus: 'PENDING' as const,
      createdAt: new Date(),
    }),
    updateClaimStatus: async () => {},
    incrementCampaignParticipant: async () => {},
  };

  const arkham = new ArkhamIntelligenceService('TEST_KEY', mockDb as any);

  // Test 1: KOL Registration & Trust Scoring
  console.log('\n[1/3] Testing KOL Profile Registration & Trust Score Calculation...');
  const kolService = new KolService(mockDb as any, arkham);
  const kol = await kolService.registerOrUpdateKol('user-1', '0x1234567890123456789012345678901234567890', 'cryptoking', 15000);
  if (kol.trustScore >= 70 && kol.isVerified) {
    console.log('SUCCESS: KOL registered with valid Trust Score:', kol.trustScore);
  } else {
    throw new Error('FAIL: Trust score calculation incorrect');
  }

  // Test 2: Social Proof Bounty Verification
  console.log('\n[2/3] Testing Social Proof Bounty Verification Engine...');
  const bountyService = new BountyEscrowService(mockDb as any);
  const claimRes = await bountyService.submitAndVerifyClaim('camp-1', kol, 'https://x.com/cryptoking/status/123456');
  if (claimRes.success) {
    console.log('SUCCESS: Bounty claim verified and accepted cleanly!');
  } else {
    throw new Error(`FAIL: Bounty claim failed with status: ${claimRes.reason}`);
  }

  // Test 3: Nutrition Label Risk Score Computation
  console.log('\n[3/3] Testing Investor Nutrition Label Risk Aggregator...');
  const nutritionService = new NutritionLabelService(arkham);
  const label = await nutritionService.computeTokenRiskLabel(
    '0xTOKEN123',
    '0x1234567890123456789012345678901234567890',
    false,
    kol.trustScore
  );
  if (label.mintRevoked && label.overallRiskTier) {
    console.log('SUCCESS: Nutrition Label evaluated token tier as:', label.overallRiskTier, '(Reasons:', label.reasons.length, ')');
  } else {
    throw new Error('FAIL: Nutrition label computation invalid');
  }

  console.log('\n================================================================');
  console.log('ALL SOCIALFI SIMULATIONS PASSED CLEANLY! ZERO REGRESSION DETECTED');
  console.log('================================================================');
}

runSocialFiSimulation().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
