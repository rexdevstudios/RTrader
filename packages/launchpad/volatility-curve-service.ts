// ============================================================================
// DYNAMIC BONDING CURVE SLOPE ADAPTATION (VOLATILITY-AWARE PRICING)
// ============================================================================

export interface VolatilitySlopeEvaluation {
  rollingInflowEth: number;
  windowMinutes: number;
  slopeMultiplierBps: number;
  multiplierFactor: number;
  volatilityTier: 'LOW' | 'MEDIUM' | 'SURGING';
  isSurgeProtected: boolean;
  reasons: string[];
}

export class VolatilityCurveService {
  public static readonly BASE_SLOPE_MULTIPLIER_BPS = 10000; // 1.0x
  public static readonly MEDIUM_SLOPE_MULTIPLIER_BPS = 12000; // 1.2x
  public static readonly MAX_SLOPE_MULTIPLIER_BPS = 15000; // 1.5x hard cap

  public static readonly VELOCITY_THRESHOLD_MEDIUM_ETH = 2.0; // 2.0 ETH / 10 min
  public static readonly VELOCITY_THRESHOLD_HIGH_ETH = 5.0; // 5.0 ETH / 10 min

  /**
   * Mengevaluasi kecepatan inflow beli dalam jendela waktu (default 10 menit)
   * dan merekomendasikan multiplier kemiringan kurva (slope multiplier)
   */
  static evaluateVolatilitySlope(
    rollingInflowEth: number,
    windowMinutes: number = 10,
    currentMultiplierBps: number = VolatilityCurveService.BASE_SLOPE_MULTIPLIER_BPS
  ): VolatilitySlopeEvaluation {
    if (rollingInflowEth < 0) {
      throw new Error('INVALID_INFLOW_AMOUNT: Rolling inflow cannot be negative');
    }

    const reasons: string[] = [];
    let slopeMultiplierBps = VolatilityCurveService.BASE_SLOPE_MULTIPLIER_BPS;
    let volatilityTier: 'LOW' | 'MEDIUM' | 'SURGING' = 'LOW';

    if (rollingInflowEth >= VolatilityCurveService.VELOCITY_THRESHOLD_HIGH_ETH) {
      slopeMultiplierBps = VolatilityCurveService.MAX_SLOPE_MULTIPLIER_BPS;
      volatilityTier = 'SURGING';
      reasons.push(
        `High velocity buying detected (${rollingInflowEth} ETH in ${windowMinutes}m >= ${VolatilityCurveService.VELOCITY_THRESHOLD_HIGH_ETH} ETH). Applying max 1.5x slope multiplier to curb front-running bots.`
      );
    } else if (rollingInflowEth >= VolatilityCurveService.VELOCITY_THRESHOLD_MEDIUM_ETH) {
      slopeMultiplierBps = VolatilityCurveService.MEDIUM_SLOPE_MULTIPLIER_BPS;
      volatilityTier = 'MEDIUM';
      reasons.push(
        `Elevated buying velocity detected (${rollingInflowEth} ETH in ${windowMinutes}m). Applying 1.2x dynamic slope multiplier.`
      );
    } else {
      reasons.push(
        `Normal buying volume (${rollingInflowEth} ETH in ${windowMinutes}m). Base 1.0x slope retained.`
      );
    }

    const multiplierFactor = Number((slopeMultiplierBps / 10000).toFixed(2));
    const isSurgeProtected = slopeMultiplierBps > VolatilityCurveService.BASE_SLOPE_MULTIPLIER_BPS;

    return {
      rollingInflowEth,
      windowMinutes,
      slopeMultiplierBps,
      multiplierFactor,
      volatilityTier,
      isSurgeProtected,
      reasons,
    };
  }

  /**
   * Kalkulasi biaya pembelian token dengan komponen dynamic slope multiplier
   */
  static calculateVolatilityAdjustedCost(
    initialPriceWei: bigint,
    supplySold: bigint,
    amountToBuy: bigint,
    slopeMultiplierBps: number = VolatilityCurveService.BASE_SLOPE_MULTIPLIER_BPS
  ): bigint {
    const clampedMultiplierBps = BigInt(
      Math.min(
        VolatilityCurveService.MAX_SLOPE_MULTIPLIER_BPS,
        Math.max(VolatilityCurveService.BASE_SLOPE_MULTIPLIER_BPS, slopeMultiplierBps)
      )
    );

    const baseCost = amountToBuy * initialPriceWei;
    const curveComponent =
      (supplySold * amountToBuy * clampedMultiplierBps) / (10n ** 18n * 10000n);

    return baseCost + curveComponent;
  }
}
