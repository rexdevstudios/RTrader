import { TweetQualityScorer } from '../packages/intelligence/tweet-quality-scorer';
import { CrossChainClaimAdapter, LAYERZERO_ENDPOINT_IDS } from '../packages/launchpad/cross-chain-claim-adapter';
import { BountyEscrowService } from '../packages/launchpad/bounty-escrow';
import { NutritionLabelService } from '../packages/intelligence/nutrition-label';
import { ArkhamIntelligenceService } from '../packages/intelligence/arkham-enrichment';
import { KolProfile } from '../packages/shared/types/domain';
import { ethers } from 'ethers';

async function runFutureScalingSimulation() {
  console.log('================================================================');
  console.log('STARTING FUTURE SCALING ROADMAP SANITY SIMULATION');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // PILAR 1: AI TWEET QUALITY & SENTIMENT SCORER
  // --------------------------------------------------------------------------
  console.log('\n[1/3] Testing AI Tweet Quality Scorer & Bounty Anti-Spam Gate...');

  const validTweet =
    'Loving the revolutionary utility of this protocol! Definitely a gem with strong community. LFG #DegenMoon to the moon!';
  const spamTweet =
    'Free crypto giveaway send ETH to receive 2x! DM for pump signals #DegenMoon';
  const fudTweet =
    'Avoid this token, it is a complete scam and honeypot worthless project #DegenMoon';
  const missingHashtagTweet =
    'Loving the revolutionary utility of this protocol! Definitely a gem with strong community.';

  const auditValid = TweetQualityScorer.auditTweet(validTweet, '#DegenMoon');
  if (auditValid.passedQualityGate && auditValid.sentiment === 'POSITIVE' && auditValid.qualityScore >= 70) {
    console.log('SUCCESS: High-quality authentic tweet passed AI Quality Gate with Score:', auditValid.qualityScore);
  } else {
    throw new Error('FAIL: Valid tweet should pass AI quality gate');
  }

  const auditSpam = TweetQualityScorer.auditTweet(spamTweet, '#DegenMoon');
  if (!auditSpam.passedQualityGate && auditSpam.isSpamOrBot) {
    console.log('SUCCESS: Spam bot pattern correctly identified and blocked (Score: ' + auditSpam.qualityScore + ')');
  } else {
    throw new Error('FAIL: Spam tweet should be rejected');
  }

  const auditFud = TweetQualityScorer.auditTweet(fudTweet, '#DegenMoon');
  if (!auditFud.passedQualityGate && auditFud.sentiment === 'NEGATIVE') {
    console.log('SUCCESS: Hostile FUD tweet correctly identified and rejected');
  } else {
    throw new Error('FAIL: FUD tweet should be rejected');
  }

  const auditMissing = TweetQualityScorer.auditTweet(missingHashtagTweet, '#DegenMoon');
  if (!auditMissing.passedQualityGate) {
    console.log('SUCCESS: Tweet without mandatory hashtag correctly rejected');
  } else {
    throw new Error('FAIL: Tweet missing hashtag should be rejected');
  }

  // End-to-end integration test with BountyEscrowService
  const mockBountyDb = {
    getCampaign: async () => ({
      id: 'camp-test-1',
      launchId: 'launch-test-1',
      creatorId: 'creator-test',
      title: 'Degen Moon Promo',
      requiredHashtag: '#DegenMoon',
      minFollowers: 1000,
      rewardPerKol: 1000000000000000000000n,
      maxParticipants: 10,
      currentParticipants: 0,
      isActive: true,
    }),
    getClaim: async () => null,
    createClaim: async (cId: string, kId: string, url: string) => ({
      id: 'claim-audit-1',
      campaignId: cId,
      kolId: kId,
      proofUrl: url,
      verificationStatus: 'PENDING' as const,
      createdAt: new Date(),
    }),
    updateClaimStatus: async () => {},
    incrementCampaignParticipant: async () => {},
    createAuditLog: async () => {},
  };

  const escrow = new BountyEscrowService(mockBountyDb as any);
  const kolMock: KolProfile = {
    id: 'kol-test-1',
    userId: 'usr-test-1',
    followersCount: 5000,
    trustScore: 85,
    completedBounties: 2,
    totalEarnedUsd: 500,
    isVerified: true,
  };

  const validSubmission = await escrow.submitAndVerifyClaim(
    'camp-test-1',
    kolMock,
    'https://x.com/kol/status/111',
    validTweet
  );
  if (validSubmission.success && validSubmission.qualityAudit?.passedQualityGate) {
    console.log('SUCCESS: BountyEscrowService approved authentic tweet via AI Quality Gate');
  } else {
    throw new Error('FAIL: Escrow service should approve valid tweet');
  }

  const spamSubmission = await escrow.submitAndVerifyClaim(
    'camp-test-1',
    kolMock,
    'https://x.com/kol/status/222',
    spamTweet
  );
  if (!spamSubmission.success && spamSubmission.qualityAudit?.isSpamOrBot) {
    console.log('SUCCESS: BountyEscrowService rejected spam tweet submission');
  } else {
    throw new Error('FAIL: Escrow service should reject spam tweet');
  }

  // --------------------------------------------------------------------------
  // PILAR 2: LAYERZERO V2 CROSS-CHAIN CLAIM ADAPTER
  // --------------------------------------------------------------------------
  console.log('\n[2/3] Testing LayerZero v2 Cross-Chain Claim Adapter...');

  const kolWallet = '0x1111111111111111111111111111111111111111';
  const tokenAddress = '0x2222222222222222222222222222222222222222';
  const amount = 1000000000000000000000n;

  const encodedPayload = CrossChainClaimAdapter.encodeCrossChainPayload(kolWallet, tokenAddress, amount);
  if (encodedPayload && encodedPayload.startsWith('0x') && encodedPayload.length > 66) {
    console.log('SUCCESS: LayerZero ABI Payload encoded cleanly (Length: ' + encodedPayload.length + ' chars)');
  } else {
    throw new Error('FAIL: Cross-chain payload encoding failed');
  }

  const quoteArbitrum = CrossChainClaimAdapter.estimateCrossChainFee(
    LAYERZERO_ENDPOINT_IDS.ARBITRUM_ONE,
    amount
  );
  if (quoteArbitrum.dstEid === 30110 && quoteArbitrum.chainName === 'Arbitrum One' && Number(quoteArbitrum.estimatedFeeEth) > 0) {
    console.log('SUCCESS: LayerZero Fee Quote for Arbitrum One estimated: ' + quoteArbitrum.estimatedFeeEth + ' ETH');
  } else {
    throw new Error('FAIL: LayerZero quote for Arbitrum failed');
  }

  const quoteOptimism = CrossChainClaimAdapter.estimateCrossChainFee(
    LAYERZERO_ENDPOINT_IDS.OPTIMISM_MAINNET,
    amount
  );
  if (quoteOptimism.dstEid === 30111 && quoteOptimism.chainName === 'Optimism Mainnet') {
    console.log('SUCCESS: LayerZero Quote for Optimism Mainnet resolved with EID 30111');
  } else {
    throw new Error('FAIL: LayerZero quote for Optimism failed');
  }

  // --------------------------------------------------------------------------
  // PILAR 3: DECENTRALIZED 6-MONTH LIQUIDITY TIME-LOCK VAULT
  // --------------------------------------------------------------------------
  console.log('\n[3/3] Testing Decentralized 6-Month Liquidity Time-Lock Vault...');

  const arkham = new ArkhamIntelligenceService();
  const nutritionService = new NutritionLabelService(arkham);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const future180Days = nowSeconds + 180 * 86400; // 180 hari kemudian

  const nutritionResult = await nutritionService.computeTokenRiskLabel(
    tokenAddress,
    kolWallet,
    true, // graduated
    85,   // creator trust score
    future180Days // unlockTimestamp
  );

  if (nutritionResult.timeLockDays && nutritionResult.timeLockDays >= 179) {
    console.log('SUCCESS: Time-Lock Vault calculated 180-day lock duration cleanly (' + nutritionResult.timeLockDays + ' days)');
    console.log('SUCCESS: Liquidity Unlock Timestamp recorded:', nutritionResult.liquidityUnlockTimestamp);
    console.log('SUCCESS: Anti-Rugpull Overall Risk Tier:', nutritionResult.overallRiskTier);
  } else {
    throw new Error('FAIL: Time-Lock Vault duration calculation failed');
  }

  console.log('\n================================================================');
  console.log('ALL FUTURE SCALING ROADMAP SIMULATIONS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runFutureScalingSimulation().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
