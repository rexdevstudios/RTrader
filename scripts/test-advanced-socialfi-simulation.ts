import { GaslessPaymasterService } from '../packages/launchpad/gasless-paymaster';
import { YieldVaultService } from '../packages/launchpad/yield-vault-service';
import { FarcasterLensService } from '../packages/social/farcaster-lens-service';
import { KolService, KolDbAdapter } from '../packages/social/kol-service';
import { NutritionLabelService } from '../packages/intelligence/nutrition-label';
import { ArkhamIntelligenceService } from '../packages/intelligence/arkham-enrichment';
import { KolProfile } from '../packages/shared/types/domain';
import { ethers } from 'ethers';

async function runAdvancedSocialFiSimulation() {
  console.log('================================================================');
  console.log('STARTING ADVANCED SOCIALFI SCALING SANITY SIMULATION');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // PILAR 1: ERC-4337 GASLESS PAYMASTER SERVICE
  // --------------------------------------------------------------------------
  console.log('\n[1/3] Testing ERC-4337 Gasless Paymaster Service & Signature Verification...');

  const paymaster = new GaslessPaymasterService({
    defaultChainId: 8453, // Base Mainnet
  });
  const sponsorAddress = paymaster.getSponsorAddress();
  console.log('SUCCESS: Initialized Gasless Paymaster with Sponsor Address:', sponsorAddress);

  const testToken = '0x1111111111111111111111111111111111111111';
  const testKolWallet = '0x2222222222222222222222222222222222222222';
  const rewardAmount = 1000n * 10n ** 18n; // 1,000 tokens

  // 1. Generate Sponsorship Quote
  const quote = await paymaster.signSponsorship(testToken, testKolWallet, rewardAmount, 3600, 8453);
  if (!quote.signature || !quote.deadline || quote.sponsoredTxType !== 'BOUNTY_CLAIM') {
    throw new Error('FAIL: Invalid sponsorship quote format');
  }
  console.log('SUCCESS: Generated Paymaster Sponsorship Quote with signature length:', quote.signature.length);

  // 2. Verify Valid Signature
  const isValidQuote = paymaster.verifySignature(quote);
  if (!isValidQuote) {
    throw new Error('FAIL: Valid sponsorship quote failed signature verification');
  }
  console.log('SUCCESS: Cryptographic signature verified cleanly by Paymaster engine');

  // 3. Reject Tampered Quote (Fraud Detection)
  const tamperedQuote = { ...quote, tokenAmount: (rewardAmount * 2n).toString() };
  const isTamperedValid = paymaster.verifySignature(tamperedQuote);
  if (isTamperedValid) {
    throw new Error('FAIL: Tampered reward amount should be rejected');
  }
  console.log('SUCCESS: Tampered reward amount correctly rejected by Paymaster');

  // 4. On-chain EIP-191 Hash Recovery Simulation
  const hash = GaslessPaymasterService.computeSponsorshipHash(
    quote.tokenAddress,
    quote.kolWallet,
    BigInt(quote.tokenAmount),
    quote.deadline,
    quote.chainId
  );
  const recoveredSigner = ethers.verifyMessage(ethers.getBytes(hash), quote.signature);
  if (recoveredSigner.toLowerCase() !== sponsorAddress.toLowerCase()) {
    throw new Error('FAIL: Recovered signer mismatch with paymaster sponsor address');
  }
  console.log('SUCCESS: On-chain ECDSA recovery matched authorized sponsor address 100%');

  // --------------------------------------------------------------------------
  // PILAR 2: DEFI LIQUID STAKING VAULT SERVICE
  // --------------------------------------------------------------------------
  console.log('\n[2/3] Testing DeFi Liquid Staking Vault Service for Locked Liquidity...');

  const graduatedLiquidityWei = 24n * 10n ** 18n; // 24 ETH raised on graduation
  const projection = YieldVaultService.calculateProjectedYield(graduatedLiquidityWei, 180);

  if (projection.apyPercentage !== 4.2) {
    throw new Error(`FAIL: Expected 4.2% APY, got ${projection.apyPercentage}%`);
  }
  if (projection.totalProjectedYieldWei <= 0n) {
    throw new Error('FAIL: Projected yield should be greater than zero');
  }
  if (projection.communityShareWei + projection.treasuryShareWei !== projection.totalProjectedYieldWei) {
    throw new Error('FAIL: Split calculation sum mismatch');
  }
  console.log(`SUCCESS: 180-Day 4.2% APY Yield on 24 ETH: ${projection.totalProjectedYieldEth} ETH`);
  console.log(`SUCCESS: Community Staking Share (70%): ${projection.communityShareEth} ETH`);
  console.log(`SUCCESS: Platform Treasury Share (30%): ${projection.treasuryShareEth} ETH`);

  // Real-time accrual after 30 days
  const thirtyDaysAccrued = YieldVaultService.calculateAccruedYield(graduatedLiquidityWei, 30 * 24 * 3600);
  if (thirtyDaysAccrued <= 0n) {
    throw new Error('FAIL: 30-day accrued yield should be > 0');
  }
  console.log(`SUCCESS: 30-Day Accrued Real-time Yield: ${ethers.formatEther(thirtyDaysAccrued)} ETH`);

  // Nutrition Label with Staking Yield Active
  const mockArkhamService = new ArkhamIntelligenceService();
  const nutritionService = new NutritionLabelService(mockArkhamService);
  const riskLabel = await nutritionService.computeTokenRiskLabel(
    testToken,
    '0x3333333333333333333333333333333333333333',
    true, // isGraduatedOrLocked
    85,   // high creator trust score
    Math.floor(Date.now() / 1000) + 180 * 86400,
    true, // yieldStakingActive
    4.2   // stakingApy
  );

  if (!riskLabel.yieldStakingActive || riskLabel.stakingApy !== 4.2) {
    throw new Error('FAIL: Nutrition label should record active liquid staking yield');
  }
  if (!riskLabel.reasons.some((r) => r.includes('4.2% APY'))) {
    throw new Error('FAIL: Nutrition label reasons should include staking yield disclosure');
  }
  console.log('SUCCESS: Nutrition Label recorded active staking yield with tier:', riskLabel.overallRiskTier);

  // --------------------------------------------------------------------------
  // PILAR 3: DECENTRALIZED REPUTATION GRAPH (FARCASTER & LENS PROTOCOL)
  // --------------------------------------------------------------------------
  console.log('\n[3/3] Testing Decentralized Reputation Graph (Farcaster & Lens Protocol)...');

  // 1. Farcaster Verification
  const fcValid = FarcasterLensService.verifyFarcasterAccount({
    walletAddress: testKolWallet,
    fid: 12345,
    username: 'vitalik.eth',
    followersCount: 1500,
    custodyAddress: testKolWallet,
  });
  if (!fcValid.isValid || fcValid.profile?.farcasterUsername !== 'vitalik.eth') {
    throw new Error('FAIL: Valid Farcaster profile should pass verification');
  }
  console.log('SUCCESS: Farcaster FID and custody address verified cleanly for @vitalik.eth');

  // Custody mismatch rejection
  const fcMismatch = FarcasterLensService.verifyFarcasterAccount({
    walletAddress: testKolWallet,
    fid: 12345,
    username: 'impostor',
    custodyAddress: '0x9999999999999999999999999999999999999999',
  });
  if (fcMismatch.isValid || fcMismatch.reason !== 'FARCASTER_CUSTODY_WALLET_MISMATCH') {
    throw new Error('FAIL: Custody mismatch should be rejected');
  }
  console.log('SUCCESS: Farcaster custody mismatch correctly rejected');

  // 2. Lens Protocol Verification
  const lensValid = FarcasterLensService.verifyLensProfile({
    walletAddress: testKolWallet,
    handle: 'cryptorider', // auto-appends .lens
    followersCount: 800,
  });
  if (!lensValid.isValid || lensValid.profile?.lensHandle !== 'cryptorider.lens') {
    throw new Error('FAIL: Lens profile should normalize handle to .lens');
  }
  console.log('SUCCESS: Lens Protocol Profile verified with handle:', lensValid.profile?.lensHandle);

  // 3. Web3 Social Score Calculation
  const web3Score = FarcasterLensService.calculateWeb3ReputationScore(true, true, 1500, 800);
  if (web3Score < 80) {
    throw new Error(`FAIL: Multi-protocol Web3 score should be high, got ${web3Score}`);
  }
  console.log('SUCCESS: Combined Web3 Social Reputation Score calculated:', web3Score);

  // 4. KolService Registration with Farcaster & Lens Integration
  const mockKolDb: KolDbAdapter = {
    async upsertKolProfile(p) {
      return {
        id: 'kol-test-web3',
        userId: p.userId,
        twitterHandle: p.twitterHandle,
        followersCount: p.followersCount || 2000,
        farcasterFid: p.farcasterFid,
        farcasterUsername: p.farcasterUsername,
        lensHandle: p.lensHandle,
        web3SocialScore: p.web3SocialScore,
        trustScore: p.trustScore || 80,
        completedBounties: 0,
        totalEarnedUsd: 0,
        isVerified: true,
      };
    },
    async getKolProfile() {
      return null;
    },
    async createAuditLog() {},
  };

  const kolService = new KolService(mockKolDb, mockArkhamService);
  const registeredKol = await kolService.registerOrUpdateKol(
    'usr-web3-kol',
    testKolWallet,
    'cryptorider',
    2500,
    12345,
    'cryptorider.eth',
    'cryptorider.lens'
  );

  if (!registeredKol.farcasterUsername || !registeredKol.lensHandle || !registeredKol.web3SocialScore) {
    throw new Error('FAIL: KOL Profile should retain Web3 social graph credentials');
  }
  if (registeredKol.trustScore < 80) {
    throw new Error('FAIL: KOL Trust Score should include Web3 native reputation bonus');
  }
  console.log(`SUCCESS: Registered KOL with Web3 Social Graph (FC: @${registeredKol.farcasterUsername}, Lens: ${registeredKol.lensHandle})`);
  console.log(`SUCCESS: Final Enhanced KOL Trust Score: ${registeredKol.trustScore}/100`);

  console.log('\n================================================================');
  console.log('ALL ADVANCED SOCIALFI SCALING SIMULATIONS PASSED 100%!');
  console.log('================================================================\n');
}

runAdvancedSocialFiSimulation().catch((err) => {
  console.error('SIMULATION FAILED:', err);
  process.exit(1);
});
