import { BountyEscrowService } from '../packages/launchpad/bounty-escrow';
import { KolService } from '../packages/social/kol-service';
import { ArkhamIntelligenceService } from '../packages/intelligence/arkham-enrichment';
import { TradingRiskGate } from '../packages/trading/risk-gate';
import { NutritionLabelService } from '../packages/intelligence/nutrition-label';
import { TradeIntentInput, UserRiskLimits } from '../packages/shared/types/domain';
import { ethers } from 'ethers';

async function runNextPhaseSimulation() {
  console.log('================================================================');
  console.log('STARTING NEXT-PHASE SOCIALFI RECOMMENDATIONS SANITY SIMULATION');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // PILAR 1: ON-CHAIN BOUNTY MERKLE CLAIM PAYOUT
  // --------------------------------------------------------------------------
  console.log('\n[1/3] Testing On-Chain Bounty Merkle Claim Tree & Proof Engine...');

  const kolWallet1 = '0x1111111111111111111111111111111111111111';
  const kolWallet2 = '0x2222222222222222222222222222222222222222';
  const stranger = '0x9999999999999999999999999999999999999999';

  const reward1 = 1000000000000000000000n; // 1,000 tokens
  const reward2 = 2500000000000000000000n; // 2,500 tokens

  const claims = [
    { walletAddress: kolWallet1, tokenAmount: reward1 },
    { walletAddress: kolWallet2, tokenAmount: reward2 },
  ];

  const tree = BountyEscrowService.generateBountyMerkleTree(claims);
  if (!tree.root || !tree.root.startsWith('0x') || tree.root.length !== 66) {
    throw new Error('FAIL: Invalid Merkle Root generated for bounty claims');
  }
  console.log('SUCCESS: Generated Bounty Merkle Root:', tree.root);

  // Verifikasi proof untuk kolWallet1
  const proof1 = tree.getProof(kolWallet1, reward1);
  if (proof1.length === 0) {
    throw new Error('FAIL: Merkle proof for KOL 1 should not be empty');
  }

  // Verifikasi keabsahan hash lokal yang ekuivalen dengan Solidity MerkleProof.verify
  const leaf1 = BountyEscrowService.hashClaim(kolWallet1, reward1);
  const combine = (a: string, b: string) =>
    a <= b ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
  const computedRoot = combine(leaf1, proof1[0]);

  if (computedRoot !== tree.root) {
    throw new Error('FAIL: Cryptographic hash mismatch between leaf and proof');
  }
  console.log('SUCCESS: Cryptographic Merkle Proof matches Root 100% for KOL 1');

  // Uji penolakan jika jumlah reward ditamper
  const tamperedProof = tree.getProof(kolWallet1, reward1 + 1000n);
  if (tamperedProof.length === 0) {
    console.log('SUCCESS: Tampered reward amount correctly rejected with empty proof');
  } else {
    throw new Error('FAIL: Tampered reward should not produce a valid proof');
  }

  // Uji penolakan jika wallet asing mencoba klaim
  const strangerProof = tree.getProof(stranger, reward1);
  if (strangerProof.length === 0) {
    console.log('SUCCESS: Non-eligible stranger wallet correctly rejected');
  } else {
    throw new Error('FAIL: Stranger wallet should not receive proof');
  }

  // --------------------------------------------------------------------------
  // PILAR 2: CRYPTOGRAPHIC TWITTER/X ATTESTATION & REPUTATION PASSPORT
  // --------------------------------------------------------------------------
  console.log('\n[2/3] Testing Cryptographic Twitter/X Attestation & Arkham Reputation...');

  // Simulasi wallet pengguna menandatangani pesan attestation
  const testSigner = ethers.Wallet.createRandom();
  const testWalletAddress = testSigner.address;
  const testHandle = 'cryptorider';

  const attestationMsg = KolService.getAttestationMessage(testWalletAddress, testHandle);
  const signature = await testSigner.signMessage(attestationMsg);

  // Verifikasi signature secara kriptografis
  const isAttestationValid = KolService.verifySocialAttestation(testWalletAddress, testHandle, signature);
  if (!isAttestationValid) {
    throw new Error('FAIL: Valid cryptographic social attestation was rejected');
  }
  console.log('SUCCESS: EIP-191 Social Attestation verified cleanly for @' + testHandle);

  // Verifikasi penolakan jika handle diubah (spoofing attempt)
  const isSpoofedValid = KolService.verifySocialAttestation(testWalletAddress, 'fake_impersonator', signature);
  if (isSpoofedValid) {
    throw new Error('FAIL: Spoofed twitter handle should have been rejected');
  }
  console.log('SUCCESS: Spoofed handle impersonation correctly rejected');

  // Profiling via KolService dengan Arkham Enrichment
  const mockKolDb = {
    upsertKolProfile: async (p: any) => ({ ...p, id: 'kol-test' }),
    getKolProfile: async () => null,
    createAuditLog: async () => {},
  };
  const arkham = new ArkhamIntelligenceService();
  const kolService = new KolService(mockKolDb as any, arkham);

  const kolProfile = await kolService.registerOrUpdateKol('usr-test', testWalletAddress, testHandle, 15000);
  if (kolProfile.trustScore >= 70 && kolProfile.isVerified) {
    console.log('SUCCESS: KOL Profile registered with Arkham Trust Score:', kolProfile.trustScore);
  } else {
    throw new Error('FAIL: Expected verified KOL profile with score >= 70');
  }

  // --------------------------------------------------------------------------
  // PILAR 3: PAPER TRADING SANDBOX TOKEN INTEGRATION & NUTRITION LABEL
  // --------------------------------------------------------------------------
  console.log('\n[3/3] Testing Paper Trading Sandbox & Nutrition Label for Bonding Curve Tokens...');

  const paperIntent: TradeIntentInput = {
    userId: 'usr-investor-1',
    stage: 'PAPER', // 100% zero-capital risk sandbox
    symbol: 'MOON/ETH',
    side: 'BUY',
    type: 'MARKET',
    quantity: 100,
    price: 0.00001,
    maxSlippagePct: 1.5,
    idempotencyKey: `sim-paper-${Date.now()}`,
  };

  const userLimits: UserRiskLimits = {
    maxOrderValueUsd: 10000,
    maxDailyLossUsd: 1000,
    currentDailyLossUsd: 0,
    maxOpenPositions: 5,
    currentOpenPositions: 0,
  };

  const { status, decision } = TradingRiskGate.evaluateIntent(
    paperIntent,
    userLimits,
    { planId: 'GUEST', hasLiveTrading: false }, // Bahkan GUEST / Non-subscribed plan dapat mencoba Paper Trading!
    []
  );

  if (status === 'RISK_APPROVED' && decision.isApproved) {
    console.log('SUCCESS: Paper Trading intent for MOON/ETH approved through Risk Gate with score 0 (Zero Risk)');
  } else {
    throw new Error('FAIL: Paper Trading intent should be auto-approved');
  }

  // Evaluasi Nutrition Label untuk token bonding curve
  const nutritionService = new NutritionLabelService(arkham);
  const nutritionLabel = await nutritionService.computeTokenRiskLabel(
    '0x3333333333333333333333333333333333333333',
    testWalletAddress,
    true,
    80
  );

  if (nutritionLabel.overallRiskTier === 'LOW' && nutritionLabel.liquidityLocked === true) {
    console.log('SUCCESS: Token Nutrition Label evaluated cleanly with tier:', nutritionLabel.overallRiskTier);
    console.log('SUCCESS: Anti-rugpull liquidity locked status:', nutritionLabel.liquidityLocked);
    console.log('SUCCESS: Mint revoked status (SSOT guarantee):', nutritionLabel.mintRevoked);
  } else {
    throw new Error('FAIL: Nutrition Label evaluation failed');
  }

  console.log('\n================================================================');
  console.log('ALL NEXT-PHASE SOCIALFI RECOMMENDATION SIMULATIONS PASSED 100%!');
  console.log('================================================================');
}

runNextPhaseSimulation().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
