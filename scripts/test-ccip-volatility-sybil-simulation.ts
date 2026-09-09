import {
  CrossChainClaimAdapter,
  CHAINLINK_CCIP_SELECTORS,
} from '../packages/launchpad/cross-chain-claim-adapter';
import { VolatilityCurveService } from '../packages/launchpad/volatility-curve-service';
import { SybilResistanceService } from '../packages/social/sybil-resistance-service';
import { BountyEscrowService, BountyDbAdapter } from '../packages/launchpad/bounty-escrow';
import { BountyCampaign, BountyClaim, KolProfile, WorldIdProofPayload } from '../packages/shared/types/domain';
import { ethers } from 'ethers';

// Mock DB Adapter for testing Bounty Escrow
class MockBountyDbAdapter implements BountyDbAdapter {
  public campaigns: Map<string, BountyCampaign> = new Map();
  public claims: Map<string, BountyClaim> = new Map();
  public auditLogs: any[] = [];

  async getCampaign(campaignId: string): Promise<BountyCampaign | null> {
    return this.campaigns.get(campaignId) || null;
  }
  async getClaim(campaignId: string, kolId: string): Promise<BountyClaim | null> {
    const key = `${campaignId}:${kolId}`;
    return this.claims.get(key) || null;
  }
  async createClaim(campaignId: string, kolId: string, proofUrl: string): Promise<BountyClaim> {
    const claim: BountyClaim = {
      id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      campaignId,
      kolId,
      proofUrl,
      verificationStatus: 'PENDING',
      createdAt: new Date(),
    };
    this.claims.set(`${campaignId}:${kolId}`, claim);
    return claim;
  }
  async updateClaimStatus(claimId: string, status: 'VERIFIED' | 'REJECTED' | 'CLAIMED'): Promise<void> {
    for (const [key, claim] of this.claims.entries()) {
      if (claim.id === claimId) {
        claim.verificationStatus = status;
        this.claims.set(key, claim);
        break;
      }
    }
  }
  async incrementCampaignParticipant(campaignId: string): Promise<void> {
    const campaign = this.campaigns.get(campaignId);
    if (campaign) {
      campaign.currentParticipants += 1;
      this.campaigns.set(campaignId, campaign);
    }
  }
  async createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void> {
    this.auditLogs.push({ actorId, action, entityId, reason, timestamp: new Date() });
  }
}

async function runCcipVolatilitySybilSimulation() {
  console.log('================================================================');
  console.log('STARTING CHAINLINK CCIP, DYNAMIC VOLATILITY & ZK SYBIL SIMULATION');
  console.log('================================================================');

  const testTokenAddress = '0x1111111111111111111111111111111111111111';
  const testRecipientWallet = '0x2222222222222222222222222222222222222222';
  const testYieldAmountWei = 500000000000000000n; // 0.5 ETH yield

  // --------------------------------------------------------------------------
  // PILAR 1: CHAINLINK CCIP CROSS-CHAIN YIELD BRIDGE
  // --------------------------------------------------------------------------
  console.log('\n[1/3] Testing Chainlink CCIP Cross-Chain Yield Bridge...');

  // 1.1 Verify Chain Selectors
  if (
    CHAINLINK_CCIP_SELECTORS.BASE_MAINNET !== '15971525489660198786' ||
    CHAINLINK_CCIP_SELECTORS.ARBITRUM_ONE !== '4949039107694359620' ||
    CHAINLINK_CCIP_SELECTORS.OPTIMISM_MAINNET !== '5224473277236331295' ||
    CHAINLINK_CCIP_SELECTORS.POLYGON_MAINNET !== '4051577828743386545'
  ) {
    throw new Error('FAIL: Chainlink CCIP Chain Selectors mismatch official specification');
  }
  console.log('SUCCESS: Chainlink CCIP Chain Selectors verified for Base, Arbitrum, Optimism, and Polygon');

  // 1.2 CCIP Message Payload ABI Encoding & Decoding
  const encodedCcipMessage = CrossChainClaimAdapter.encodeCcipBridgeMessage(
    testRecipientWallet,
    testTokenAddress,
    testYieldAmountWei,
    CHAINLINK_CCIP_SELECTORS.ARBITRUM_ONE
  );
  if (!encodedCcipMessage || !encodedCcipMessage.startsWith('0x')) {
    throw new Error('FAIL: Encoded CCIP message is invalid or empty');
  }
  console.log('SUCCESS: CCIP Any2EVMMessage payload encoded cleanly (length:', encodedCcipMessage.length, 'chars)');

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const [decodedReceiver, decodedToken, decodedAmount, decodedSelector] = abiCoder.decode(
    ['address', 'address', 'uint256', 'uint64'],
    encodedCcipMessage
  );
  if (
    decodedReceiver.toLowerCase() !== testRecipientWallet.toLowerCase() ||
    decodedToken.toLowerCase() !== testTokenAddress.toLowerCase() ||
    decodedAmount !== testYieldAmountWei ||
    decodedSelector.toString() !== CHAINLINK_CCIP_SELECTORS.ARBITRUM_ONE
  ) {
    throw new Error('FAIL: Decoded CCIP message roundtrip mismatch');
  }
  console.log('SUCCESS: CCIP message payload successfully roundtripped via ABI decode');

  // 1.3 Fee Estimation Quote
  const ccipQuote = CrossChainClaimAdapter.estimateCcipBridgeFee(
    CHAINLINK_CCIP_SELECTORS.ARBITRUM_ONE,
    testYieldAmountWei,
    testRecipientWallet,
    testTokenAddress
  );
  console.log(`SUCCESS: CCIP Fee Quote: Destination=${ccipQuote.chainName}, EstimatedFee=${ccipQuote.estimatedFeeEth} ETH`);
  if (!ccipQuote.estimatedFeeEth || Number(ccipQuote.estimatedFeeEth) <= 0) {
    throw new Error('FAIL: CCIP fee estimation must be positive');
  }

  // 1.4 Unsupported chain selector rejection
  try {
    CrossChainClaimAdapter.encodeCcipBridgeMessage(
      testRecipientWallet,
      testTokenAddress,
      testYieldAmountWei,
      '999999999999999' // Invalid selector
    );
    throw new Error('FAIL: Unsupported CCIP selector should have thrown error');
  } catch (err: any) {
    if (!err.message.includes('UNSUPPORTED_CCIP_CHAIN_SELECTOR')) {
      throw err;
    }
    console.log('SUCCESS: Unsupported CCIP chain selector rejected as expected');
  }

  // --------------------------------------------------------------------------
  // PILAR 2: DYNAMIC BONDING CURVE SLOPE ADAPTATION (VOLATILITY-AWARE PRICING)
  // --------------------------------------------------------------------------
  console.log('\n[2/3] Testing Dynamic Bonding Curve Slope Adaptation...');

  // 2.1 Normal buying velocity (< 2 ETH in 10 min)
  const normalSlope = VolatilityCurveService.evaluateVolatilitySlope(1.2, 10);
  console.log(`SUCCESS: Normal velocity (1.2 ETH): Slope Multiplier=${normalSlope.slopeMultiplierBps} bps (${normalSlope.multiplierFactor}x), Tier=${normalSlope.volatilityTier}`);
  if (normalSlope.slopeMultiplierBps !== 10000 || normalSlope.isSurgeProtected !== false) {
    throw new Error('FAIL: Normal volume should maintain base 1.0x slope');
  }

  // 2.2 Elevated buying velocity (2 - 5 ETH in 10 min)
  const mediumSlope = VolatilityCurveService.evaluateVolatilitySlope(3.5, 10);
  console.log(`SUCCESS: Elevated velocity (3.5 ETH): Slope Multiplier=${mediumSlope.slopeMultiplierBps} bps (${mediumSlope.multiplierFactor}x), Tier=${mediumSlope.volatilityTier}`);
  if (mediumSlope.slopeMultiplierBps !== 12000 || mediumSlope.volatilityTier !== 'MEDIUM') {
    throw new Error('FAIL: Elevated volume should trigger 1.2x slope');
  }

  // 2.3 Surging velocity (> 5 ETH in 10 min)
  const surgeSlope = VolatilityCurveService.evaluateVolatilitySlope(7.8, 10);
  console.log(`SUCCESS: Surging velocity (7.8 ETH): Slope Multiplier=${surgeSlope.slopeMultiplierBps} bps (${surgeSlope.multiplierFactor}x), Tier=${surgeSlope.volatilityTier}, Protected=${surgeSlope.isSurgeProtected}`);
  if (surgeSlope.slopeMultiplierBps !== 15000 || surgeSlope.volatilityTier !== 'SURGING' || !surgeSlope.isSurgeProtected) {
    throw new Error('FAIL: Surging volume must trigger max 1.5x slope');
  }

  // 2.4 Math cost verification & Monotonicity
  const initialPriceWei = 1000000000000000n; // 0.001 ETH
  const supplySold = 500000n * 10n ** 18n;
  const amountToBuy = 10000n * 10n ** 18n;

  const normalCost = VolatilityCurveService.calculateVolatilityAdjustedCost(
    initialPriceWei,
    supplySold,
    amountToBuy,
    normalSlope.slopeMultiplierBps
  );
  const surgeCost = VolatilityCurveService.calculateVolatilityAdjustedCost(
    initialPriceWei,
    supplySold,
    amountToBuy,
    surgeSlope.slopeMultiplierBps
  );

  console.log(`SUCCESS: Cost Comparison for 10,000 tokens: Normal Cost=${ethers.formatEther(normalCost)} ETH, Surge Cost (1.5x)=${ethers.formatEther(surgeCost)} ETH`);
  if (surgeCost <= normalCost) {
    throw new Error('FAIL: Surge cost must be strictly greater than normal cost');
  }

  // --------------------------------------------------------------------------
  // PILAR 3: ON-CHAIN SYBIL RESISTANCE (GITCOIN PASSPORT & WORLD ID ZK-PROOF)
  // --------------------------------------------------------------------------
  console.log('\n[3/3] Testing On-Chain Sybil Resistance & Bounty Protection Gate...');

  const testKolWallet = '0x3333333333333333333333333333333333333333';
  SybilResistanceService.resetNullifiers();

  // 3.1 Gitcoin Passport Evaluation (High Score with multiple stamps)
  const validGitcoin = SybilResistanceService.verifyGitcoinPassport(testKolWallet, 20.0, [
    'ens',
    'twitter',
    'github',
    'civic',
  ]);
  console.log(`SUCCESS: Gitcoin Passport with ENS+Twitter+Github+Civic: Score=${validGitcoin.humanityScore}/100, Passed=${validGitcoin.passedThreshold}`);
  if (!validGitcoin.passedThreshold || validGitcoin.humanityScore < 20.0) {
    throw new Error('FAIL: Gitcoin Passport should pass with high-quality stamps');
  }

  // 3.2 Gitcoin Passport Evaluation (Low Score with single stamp)
  const lowGitcoin = SybilResistanceService.verifyGitcoinPassport(testKolWallet, 20.0, ['twitter']);
  console.log(`SUCCESS: Gitcoin Passport with Twitter only: Score=${lowGitcoin.humanityScore}/100, Passed=${lowGitcoin.passedThreshold}`);
  if (lowGitcoin.passedThreshold) {
    throw new Error('FAIL: Gitcoin Passport with only Twitter stamp should not pass 20.0 threshold');
  }

  // 3.3 World ID ZK-SNARK Verification
  const testCampaignId = 'bounty-campaign-alpha';
  const validWorldIdPayload: WorldIdProofPayload = {
    merkleRoot: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    nullifierHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    proof: '0x9999888877776666555544443333222211110000',
    credentialType: 'orb',
    action: 'rtrader_bounty_claim',
    signal: testKolWallet,
  };

  const worldIdResult = SybilResistanceService.verifyWorldIdProof(validWorldIdPayload, testCampaignId);
  console.log(`SUCCESS: World ID ZK-Proof Verification: Valid=${worldIdResult.isValid}, Nullifier=${worldIdResult.nullifierHash}`);
  if (!worldIdResult.isValid) {
    throw new Error(`FAIL: World ID proof failed: ${worldIdResult.reason}`);
  }

  // 3.4 World ID Anti-Replay Gate (Nullifier Reuse should be blocked)
  const replayResult = SybilResistanceService.verifyWorldIdProof(validWorldIdPayload, testCampaignId);
  console.log(`SUCCESS: World ID Replay Attempt: Blocked=${!replayResult.isValid}, Reason=${replayResult.reason}`);
  if (replayResult.isValid) {
    throw new Error('FAIL: Reusing nullifier hash in same campaign should be rejected');
  }

  // 3.5 Integration with BountyEscrowService
  const db = new MockBountyDbAdapter();
  const escrowService = new BountyEscrowService(db);

  // Set up standard campaign (no sybil proof required - backward compatibility check)
  const standardCampaign: BountyCampaign = {
    id: 'campaign-standard',
    launchId: 'launch-1',
    creatorId: 'creator-1',
    title: 'Standard Viral Raid',
    requiredHashtag: '#RTraderAlpha',
    minFollowers: 100,
    rewardPerKol: 1000n * 10n ** 18n,
    maxParticipants: 50,
    currentParticipants: 0,
    isActive: true,
  };
  db.campaigns.set(standardCampaign.id, standardCampaign);

  const mockKol: KolProfile = {
    id: 'kol-1',
    userId: 'user-1',
    twitterHandle: 'rtrader_pro',
    followersCount: 1500,
    trustScore: 85,
    isVerified: true,
    completedBounties: 2,
    totalEarnedUsd: 500,
  };

  const standardClaimResult = await escrowService.submitAndVerifyClaim(
    standardCampaign.id,
    mockKol,
    'https://x.com/rtrader_pro/status/123456789',
    'Excited to trade on RTrader! LFG #RTraderAlpha to the moon!'
  );
  if (!standardClaimResult.success) {
    throw new Error(`FAIL: Standard campaign claim should succeed without sybil proof: ${standardClaimResult.reason}`);
  }
  console.log('SUCCESS: Standard campaign claim succeeded without Sybil proof (Backward compatibility verified)');

  // Set up high-value protected campaign (requires humanity proof)
  const protectedCampaign: BountyCampaign = {
    id: 'campaign-protected',
    launchId: 'launch-2',
    creatorId: 'creator-1',
    title: 'VIP High-Reward Grant',
    requiredHashtag: '#RTraderVIP',
    minFollowers: 100,
    rewardPerKol: 10000n * 10n ** 18n,
    maxParticipants: 10,
    currentParticipants: 0,
    isActive: true,
    requiresHumanityProof: true,
    minGitcoinScore: 20.0,
  };
  db.campaigns.set(protectedCampaign.id, protectedCampaign);

  // Claim without humanity proof should fail
  const failedProtectedClaim = await escrowService.submitAndVerifyClaim(
    protectedCampaign.id,
    mockKol,
    'https://x.com/rtrader_pro/status/987654321',
    'VIP trading is amazing! Join #RTraderVIP now!'
  );
  if (failedProtectedClaim.success) {
    throw new Error('FAIL: Protected campaign should reject claim without humanity proof');
  }
  console.log('SUCCESS: Protected campaign rejected claim without humanity proof (Reason:', failedProtectedClaim.reason, ')');

  // Claim with low Gitcoin score should fail
  const lowScoreProtectedClaim = await escrowService.submitAndVerifyClaim(
    protectedCampaign.id,
    mockKol,
    'https://x.com/rtrader_pro/status/987654321',
    'VIP trading is amazing! Join #RTraderVIP now!',
    { gitcoinScore: 12.0 } // 12 < 20
  );
  if (lowScoreProtectedClaim.success) {
    throw new Error('FAIL: Protected campaign should reject claim with low Gitcoin score');
  }
  console.log('SUCCESS: Protected campaign rejected claim with low Gitcoin score (12.0 < 20.0)');

  // Claim with valid World ID ZK-proof should succeed
  const freshNullifierPayload: WorldIdProofPayload = {
    merkleRoot: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    nullifierHash: '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
    proof: '0x9999888877776666555544443333222211110000',
    credentialType: 'orb',
    action: 'rtrader_bounty_claim',
    signal: testKolWallet,
  };

  const validProtectedClaim = await escrowService.submitAndVerifyClaim(
    protectedCampaign.id,
    mockKol,
    'https://x.com/rtrader_pro/status/987654321',
    'VIP trading is amazing! Join #RTraderVIP now!',
    { worldIdProof: freshNullifierPayload }
  );
  if (!validProtectedClaim.success) {
    throw new Error(`FAIL: Protected campaign should accept claim with valid World ID ZK proof: ${validProtectedClaim.reason}`);
  }
  console.log('SUCCESS: Protected campaign approved claim with valid World ID ZK-proof!');

  console.log('\n================================================================');
  console.log('✅ ALL CCIP, VOLATILITY CURVE & ZK SYBIL RESISTANCE TESTS PASSED!');
  console.log('================================================================\n');
}

runCcipVolatilitySybilSimulation().catch((err) => {
  console.error('\n❌ SIMULATION CRASHED:', err);
  process.exit(1);
});
