// ============================================================================
// DEFI LIQUID STAKING VAULT SERVICE (180-DAY TIME-LOCKED LIQUIDITY)
// ============================================================================

import { ethers } from 'ethers';

export interface YieldProjection {
  principalWei: bigint;
  principalEth: string;
  lockDurationDays: number;
  apyPercentage: number;
  totalProjectedYieldWei: bigint;
  totalProjectedYieldEth: string;
  communityShareWei: bigint;
  communityShareEth: string;
  treasuryShareWei: bigint;
  treasuryShareEth: string;
}

export class YieldVaultService {
  // 420 bps = 4.2% APY (standard liquid staking rate for stETH / wstETH on L2)
  public static readonly DEFAULT_APY_BPS = 420n;
  public static readonly SECONDS_PER_YEAR = 365n * 24n * 3600n;
  public static readonly COMMUNITY_SPLIT_BPS = 7000n; // 70%

  /**
   * Hitung estimasi yield dividen yang akan diperoleh selama masa time-lock 180 hari
   */
  static calculateProjectedYield(
    principalWei: bigint,
    lockDurationDays: number = 180,
    apyBps: bigint = YieldVaultService.DEFAULT_APY_BPS
  ): YieldProjection {
    const elapsedSeconds = BigInt(lockDurationDays) * 24n * 3600n;
    const totalYieldWei = (principalWei * apyBps * elapsedSeconds) / (10000n * YieldVaultService.SECONDS_PER_YEAR);
    const communityShareWei = (totalYieldWei * YieldVaultService.COMMUNITY_SPLIT_BPS) / 10000n;
    const treasuryShareWei = totalYieldWei - communityShareWei;

    return {
      principalWei,
      principalEth: ethers.formatEther(principalWei),
      lockDurationDays,
      apyPercentage: Number(apyBps) / 100,
      totalProjectedYieldWei: totalYieldWei,
      totalProjectedYieldEth: ethers.formatEther(totalYieldWei),
      communityShareWei,
      communityShareEth: ethers.formatEther(communityShareWei),
      treasuryShareWei,
      treasuryShareEth: ethers.formatEther(treasuryShareWei),
    };
  }

  /**
   * Hitung yield akrual real-time berdasarkan durasi detik yang telah berjalan
   */
  static calculateAccruedYield(
    principalWei: bigint,
    elapsedSeconds: number,
    apyBps: bigint = YieldVaultService.DEFAULT_APY_BPS
  ): bigint {
    if (elapsedSeconds <= 0) return 0n;
    return (principalWei * apyBps * BigInt(elapsedSeconds)) / (10000n * YieldVaultService.SECONDS_PER_YEAR);
  }

  /**
   * Format ringkasan metrik staking untuk kebutuhan UI / Nutrition Label
   */
  static formatYieldSummary(
    principalWei: bigint,
    elapsedSeconds: number = 0,
    apyBps: bigint = YieldVaultService.DEFAULT_APY_BPS
  ) {
    const accrued = YieldVaultService.calculateAccruedYield(principalWei, elapsedSeconds, apyBps);
    const projection = YieldVaultService.calculateProjectedYield(principalWei, 180, apyBps);

    return {
      isStaked: true,
      apy: `${Number(apyBps) / 100}%`,
      principalEth: ethers.formatEther(principalWei),
      accruedYieldEth: ethers.formatEther(accrued),
      projected180DayYieldEth: projection.totalProjectedYieldEth,
      communityEarnedEth: projection.communityShareEth,
    };
  }
}
