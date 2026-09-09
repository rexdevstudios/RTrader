// ============================================================================
// INVESTOR RISK NUTRITION LABEL AGGREGATOR
// ============================================================================

import { NutritionLabelRiskScore } from '../shared/types/domain';
import { ArkhamIntelligenceService } from './arkham-enrichment';

export class NutritionLabelService {
  constructor(private arkham: ArkhamIntelligenceService) {}

  async computeTokenRiskLabel(
    tokenAddress: string,
    creatorWallet: string,
    isGraduatedOrLocked: boolean,
    creatorTrustScore: number
  ): Promise<NutritionLabelRiskScore> {
    const reasons: string[] = [];
    const arkhamProfile = await this.arkham.profileWallet(creatorWallet, 'SYSTEM_LABEL');

    const liquidityLocked = isGraduatedOrLocked;
    const mintRevoked = true; // Sesuai BondingCurveLaunchpad.sol yang tidak memiliki fungsi mint sepihak

    if (!liquidityLocked) {
      reasons.push('Liquidity is still in bonding curve (pre-graduation)');
    }
    if (arkhamProfile.isCounterpartyBlocked) {
      reasons.push('Creator wallet flagged by Arkham Intelligence');
    }
    if (creatorTrustScore < 40) {
      reasons.push('Creator/KOL has low social trust score');
    }

    let overallRiskTier: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (arkhamProfile.isCounterpartyBlocked || creatorTrustScore < 30) {
      overallRiskTier = 'HIGH';
    } else if (!liquidityLocked || creatorTrustScore < 60) {
      overallRiskTier = 'MEDIUM';
    }

    return {
      tokenAddress,
      liquidityLocked,
      mintRevoked,
      creatorTrustScore,
      arkhamRiskScore: arkhamProfile.riskPassportScore,
      overallRiskTier,
      reasons,
    };
  }
}
