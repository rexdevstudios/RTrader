// ============================================================================
// CHAINLINK AUTOMATION & KEEPER SERVICE (YIELD AUTO-COMPOUNDING)
// ============================================================================

import { ethers } from 'ethers';
import { UpkeepStatus } from '../shared/types/domain';
import { YieldVaultService } from './yield-vault-service';

export class KeeperAutomationService {
  public static readonly HARVEST_INTERVAL_SECONDS = 7 * 24 * 3600; // 7 days

  /**
   * Evaluasi kesiapan token untuk dieksekusi oleh Chainlink Automation / Gelato Keeper
   */
  static evaluateUpkeep(
    tokenAddress: string,
    isStaked: boolean,
    lastHarvestTimestamp: number,
    principalWei: bigint = 24n * 10n ** 18n,
    currentTimestamp: number = Math.floor(Date.now() / 1000)
  ): UpkeepStatus {
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`INVALID_TOKEN_ADDRESS: ${tokenAddress}`);
    }

    const nextHarvestTimestamp = lastHarvestTimestamp + KeeperAutomationService.HARVEST_INTERVAL_SECONDS;
    const upkeepNeeded = isStaked && currentTimestamp >= nextHarvestTimestamp;

    const elapsed = Math.max(0, currentTimestamp - lastHarvestTimestamp);
    const pendingYieldWei = isStaked
      ? YieldVaultService.calculateAccruedYield(principalWei, elapsed)
      : 0n;

    return {
      tokenAddress: ethers.getAddress(tokenAddress),
      upkeepNeeded,
      lastHarvestTimestamp,
      nextHarvestTimestamp,
      pendingYieldWei,
    };
  }

  /**
   * ABI Encoding calldata untuk Chainlink Automation performUpkeep
   */
  static encodePerformData(tokenAddress: string): string {
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`INVALID_TOKEN_ADDRESS: ${tokenAddress}`);
    }
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(['address'], [ethers.getAddress(tokenAddress)]);
  }

  /**
   * ABI Decoding calldata dari Chainlink Automation performData
   */
  static decodePerformData(performData: string): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const [tokenAddress] = abiCoder.decode(['address'], performData);
    return tokenAddress;
  }

  /**
   * Simulasi auto-compounding mingguan (weekly compounding) selama 26 minggu (~180 hari)
   */
  static simulateWeeklyAutoCompounding(
    initialPrincipalWei: bigint,
    totalWeeks: number = 26
  ): {
    finalPrincipalWei: bigint;
    finalPrincipalEth: string;
    totalCompoundedYieldWei: bigint;
    totalCompoundedYieldEth: string;
    effectiveCompoundedApy: number;
  } {
    let currentPrincipal = initialPrincipalWei;
    const weeklyRateBps = (YieldVaultService.DEFAULT_APY_BPS * 7n) / 365n; // Weekly interest rate bps

    for (let i = 0; i < totalWeeks; i++) {
      const weeklyYield = (currentPrincipal * weeklyRateBps) / 10000n;
      // 70% di-compound kembali ke staking pool komunitas
      const compoundAmount = (weeklyYield * YieldVaultService.COMMUNITY_SPLIT_BPS) / 10000n;
      currentPrincipal += compoundAmount;
    }

    const totalCompoundedYieldWei = currentPrincipal - initialPrincipalWei;
    const effectiveApy = Number(totalCompoundedYieldWei * 10000n / initialPrincipalWei) / 100 * (52 / totalWeeks);

    return {
      finalPrincipalWei: currentPrincipal,
      finalPrincipalEth: ethers.formatEther(currentPrincipal),
      totalCompoundedYieldWei,
      totalCompoundedYieldEth: ethers.formatEther(totalCompoundedYieldWei),
      effectiveCompoundedApy: Number(effectiveApy.toFixed(2)),
    };
  }
}
