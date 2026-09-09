import { KeeperAutomationService } from '../packages/launchpad/keeper-automation-service';
import { YieldVaultService } from '../packages/launchpad/yield-vault-service';
import { MevProtectionService } from '../packages/trading/mev-protection';
import { NutritionLabelService } from '../packages/intelligence/nutrition-label';
import { ArkhamIntelligenceService } from '../packages/intelligence/arkham-enrichment';
import { ethers } from 'ethers';

async function runKeeperMevBoosterSimulation() {
  console.log('================================================================');
  console.log('STARTING CHAINLINK KEEPER, KOL BOOSTER & ANTI-MEV SIMULATION');
  console.log('================================================================');

  const testTokenAddress = '0x1111111111111111111111111111111111111111';
  const graduationPoolLiquidityEth = 24n * 10n ** 18n; // 24 ETH

  // --------------------------------------------------------------------------
  // PILAR 1: CHAINLINK AUTOMATION & GELATO KEEPER AUTO-COMPOUNDING
  // --------------------------------------------------------------------------
  console.log('\n[1/3] Testing Chainlink Automation Keeper Service...');

  // 1.1 Check upkeep when less than 7 days have passed (upkeepNeeded should be false)
  const now = Math.floor(Date.now() / 1000);
  const recentHarvestTime = now - 3 * 86400; // 3 days ago
  const notNeededUpkeep = KeeperAutomationService.evaluateUpkeep(
    testTokenAddress,
    true, // isStaked
    recentHarvestTime,
    graduationPoolLiquidityEth,
    now
  );

  if (notNeededUpkeep.upkeepNeeded !== false) {
    throw new Error('FAIL: Upkeep should not be needed when interval is under 7 days');
  }
  console.log('SUCCESS: Upkeep correctly evaluated as FALSE before 7-day interval expires (elapsed: 3 days)');

  // 1.2 Check upkeep when 7+ days have elapsed (upkeepNeeded should be true)
  const overdueHarvestTime = now - 8 * 86400; // 8 days ago
  const neededUpkeep = KeeperAutomationService.evaluateUpkeep(
    testTokenAddress,
    true, // isStaked
    overdueHarvestTime,
    graduationPoolLiquidityEth,
    now
  );

  if (neededUpkeep.upkeepNeeded !== true) {
    throw new Error('FAIL: Upkeep should be needed when 8 days have elapsed');
  }
  console.log('SUCCESS: Upkeep correctly evaluated as TRUE after 7-day interval (elapsed: 8 days)');

  // 1.3 Validate performData ABI encoding and decoding
  const performData = KeeperAutomationService.encodePerformData(testTokenAddress);
  if (!performData || performData === '0x') {
    throw new Error('FAIL: performData should be populated with encoded ABI data');
  }
  const decodedToken = KeeperAutomationService.decodePerformData(performData);
  if (decodedToken.toLowerCase() !== testTokenAddress.toLowerCase()) {
    throw new Error(`FAIL: Decoded token address mismatch. Expected ${testTokenAddress}, got ${decodedToken}`);
  }
  console.log('SUCCESS: performData successfully roundtripped through ABI decode/encode:', decodedToken);

  // 1.4 Check upkeep when token is NOT staked
  const unstakedUpkeep = KeeperAutomationService.evaluateUpkeep(
    testTokenAddress,
    false, // isStaked
    overdueHarvestTime,
    graduationPoolLiquidityEth,
    now
  );
  if (unstakedUpkeep.upkeepNeeded !== false) {
    throw new Error('FAIL: Unstaked vault should never trigger upkeep');
  }
  console.log('SUCCESS: Unstaked pool correctly ignored by Keeper');

  // 1.5 Simulate Weekly Auto-Compounding Yield over 26 weeks (~180 days)
  const weeklySimulation = KeeperAutomationService.simulateWeeklyAutoCompounding(graduationPoolLiquidityEth, 26);
  console.log('SUCCESS: Weekly Auto-Compounding simulation for 24 ETH over 26 weeks:');
  console.log(`  - Initial Principal: ${ethers.formatEther(graduationPoolLiquidityEth)} ETH`);
  console.log(`  - Final Compounded Value: ${weeklySimulation.finalPrincipalEth} ETH`);
  console.log(`  - Total Yield Generated: ${weeklySimulation.totalCompoundedYieldEth} ETH`);
  console.log(`  - Effective APY: ${weeklySimulation.effectiveCompoundedApy.toFixed(2)}% (Nominal: 4.20%)`);

  if (weeklySimulation.totalCompoundedYieldWei <= 0n) {
    throw new Error('FAIL: Auto-compounded yield must be greater than zero');
  }

  // --------------------------------------------------------------------------
  // PILAR 2: KOL TIER-BASED STAKING BOOSTER ENGINE
  // --------------------------------------------------------------------------
  console.log('\n[2/3] Testing KOL Tier-Based Staking Booster Engine...');

  const lockupDurationSeconds = 180 * 86400; // 180 days

  // 2.1 Bronze tier (1.0x booster, unverified)
  const bronzeYield = YieldVaultService.calculateBoostedYield(
    graduationPoolLiquidityEth,
    'BRONZE',
    false,
    lockupDurationSeconds
  );
  console.log(`SUCCESS: Bronze Tier (Base): Multiplier ${bronzeYield.boosterMultiplier}x, Effective APY: ${bronzeYield.effectiveApy}%, Yield: ${bronzeYield.boostedYieldEth} ETH`);
  if (bronzeYield.boosterMultiplier !== 1.0 || bronzeYield.effectiveApy !== 4.20) {
    throw new Error('FAIL: Bronze tier must yield 1.0x booster / 4.20% APY');
  }

  // 2.2 Silver tier (1.15x booster, unverified)
  const silverYield = YieldVaultService.calculateBoostedYield(
    graduationPoolLiquidityEth,
    'SILVER',
    false,
    lockupDurationSeconds
  );
  console.log(`SUCCESS: Silver Tier: Multiplier ${silverYield.boosterMultiplier}x, Effective APY: ${silverYield.effectiveApy}%, Yield: ${silverYield.boostedYieldEth} ETH`);
  if (silverYield.boosterMultiplier !== 1.15 || Math.abs(silverYield.effectiveApy - 4.83) > 0.01) {
    throw new Error('FAIL: Silver tier must yield 1.15x booster / 4.83% APY');
  }

  // 2.3 Gold tier (1.25x booster, unverified)
  const goldYield = YieldVaultService.calculateBoostedYield(
    graduationPoolLiquidityEth,
    'GOLD',
    false,
    lockupDurationSeconds
  );
  console.log(`SUCCESS: Gold Tier: Multiplier ${goldYield.boosterMultiplier}x, Effective APY: ${goldYield.effectiveApy}%, Yield: ${goldYield.boostedYieldEth} ETH`);
  if (goldYield.boosterMultiplier !== 1.25 || Math.abs(goldYield.effectiveApy - 5.25) > 0.01) {
    throw new Error('FAIL: Gold tier must yield 1.25x booster / 5.25% APY');
  }

  // 2.4 Gold tier with Web3 Social Verification (Farcaster/Lens +0.10x booster -> 1.35x)
  const goldWeb3Yield = YieldVaultService.calculateBoostedYield(
    graduationPoolLiquidityEth,
    'GOLD',
    true,
    lockupDurationSeconds
  );
  console.log(`SUCCESS: Gold + Web3 Verified Tier: Multiplier ${goldWeb3Yield.boosterMultiplier}x, Effective APY: ${goldWeb3Yield.effectiveApy}%, Yield: ${goldWeb3Yield.boostedYieldEth} ETH`);
  if (goldWeb3Yield.boosterMultiplier !== 1.35 || Math.abs(goldWeb3Yield.effectiveApy - 5.67) > 0.01) {
    throw new Error('FAIL: Gold + Web3 verified tier must yield 1.35x booster / 5.67% APY');
  }

  // Verify monotonicity
  if (goldWeb3Yield.boostedYieldWei <= goldYield.boostedYieldWei ||
      goldYield.boostedYieldWei <= silverYield.boostedYieldWei ||
      silverYield.boostedYieldWei <= bronzeYield.boostedYieldWei) {
    throw new Error('FAIL: Yield monotonicity violation across tiers and web3 verification');
  }
  console.log('SUCCESS: Yield booster strict monotonicity validated across all 4 tiers');

  // --------------------------------------------------------------------------
  // PILAR 3: DYNAMIC SLIPPAGE & ANTI-MEV PROTECTION ENGINE
  // --------------------------------------------------------------------------
  console.log('\n[3/3] Testing Dynamic Slippage & Anti-MEV Protection Engine...');

  // 3.1 24 ETH graduation quote on Base (capped at 150 bps / 1.5%)
  const baseGraduationQuote = MevProtectionService.evaluateGraduationSlippage(
    testTokenAddress,
    graduationPoolLiquidityEth,
    8453 // Base Mainnet
  );
  console.log(`SUCCESS: Base 24 ETH Graduation Quote: Slippage ${baseGraduationQuote.maxSlippageBps} bps (${baseGraduationQuote.maxSlippageBps / 100}%), Protected: ${baseGraduationQuote.isProtected}, RPC: ${baseGraduationQuote.recommendedRpc}`);
  if (baseGraduationQuote.maxSlippageBps !== 150 || !baseGraduationQuote.isProtected) {
    throw new Error('FAIL: 24 ETH graduation quote should be capped at 150 bps');
  }
  if (!baseGraduationQuote.recommendedRpc.includes('base.mevblocker.io')) {
    throw new Error('FAIL: Base network should route through base.mevblocker.io');
  }

  // 3.2 Lower liquidity (e.g. 1 ETH) should have tighter slippage (50 bps)
  const smallPoolQuote = MevProtectionService.evaluateGraduationSlippage(
    testTokenAddress,
    1n * 10n ** 18n,
    8453
  );
  console.log(`SUCCESS: Small pool quote: Slippage ${smallPoolQuote.maxSlippageBps} bps (${smallPoolQuote.maxSlippageBps / 100}%)`);
  if (smallPoolQuote.maxSlippageBps !== 50) {
    throw new Error('FAIL: Small pool should have 50 bps slippage');
  }

  // 3.3 Verify safety check passes for valid quote
  const validCheck = MevProtectionService.verifyMevProtection(baseGraduationQuote);
  if (!validCheck.isSafe) {
    throw new Error(`FAIL: Valid Base MEV quote failed verification: ${validCheck.reason}`);
  }
  console.log('SUCCESS: Valid Base MEV quote passed verification');

  // 3.4 Verify safety check rejects unprotected RPC or excessive slippage
  const unsafeRpcQuote = {
    ...baseGraduationQuote,
    recommendedRpc: 'https://mainnet.infura.io/v3/public-mempool',
  };
  const unsafeRpcCheck = MevProtectionService.verifyMevProtection(unsafeRpcQuote);
  if (unsafeRpcCheck.isSafe) {
    throw new Error('FAIL: Unprotected public mempool RPC should fail verification');
  }
  console.log('SUCCESS: Unprotected public RPC correctly rejected:', unsafeRpcCheck.reason);

  const excessiveSlippageQuote = {
    ...baseGraduationQuote,
    maxSlippageBps: 250, // 2.5% > 1.5%
  };
  const excessiveCheck = MevProtectionService.verifyMevProtection(excessiveSlippageQuote);
  if (excessiveCheck.isSafe) {
    throw new Error('FAIL: Excessive slippage (250 bps) should fail verification');
  }
  console.log('SUCCESS: Excessive slippage correctly rejected:', excessiveCheck.reason);

  // 3.5 Token Nutrition Label Risk Integration
  console.log('\nTesting Token Risk Nutrition Label Integration with MEV & Auto-Compounding...');
  const arkham = new ArkhamIntelligenceService();
  const nutritionLabelService = new NutritionLabelService(arkham);
  const nutritionLabel = await nutritionLabelService.computeTokenRiskLabel(
    testTokenAddress,
    '0x4444444444444444444444444444444444444444',
    true, // isGraduatedOrLocked
    85, // creatorTrustScore
    now + 180 * 86400,
    true, // yieldStakingActive
    4.2,
    true, // mevProtectedGraduation
    true // autoCompoundingActive
  );

  console.log(`SUCCESS: Computed Nutrition Label Risk Tier: ${nutritionLabel.overallRiskTier}`);
  console.log(`  - MEV Protected: ${nutritionLabel.mevProtectedGraduation}`);
  console.log(`  - Auto Compounding Active: ${nutritionLabel.autoCompoundingActive}`);
  console.log(`  - Max Slippage BPS: ${nutritionLabel.maxGraduationSlippagePct}%`);
  console.log(`  - Reasons: ${JSON.stringify(nutritionLabel.reasons)}`);

  if (!nutritionLabel.mevProtectedGraduation || !nutritionLabel.autoCompoundingActive || nutritionLabel.maxGraduationSlippagePct !== 1.5) {
    throw new Error('FAIL: Nutrition Label does not properly reflect MEV or Auto-compounding status');
  }

  console.log('\n================================================================');
  console.log('✅ ALL CHAINLINK KEEPER, KOL BOOSTER & ANTI-MEV TESTS PASSED!');
  console.log('================================================================\n');
}

runKeeperMevBoosterSimulation().catch((err) => {
  console.error('\n❌ SIMULATION CRASHED:', err);
  process.exit(1);
});
