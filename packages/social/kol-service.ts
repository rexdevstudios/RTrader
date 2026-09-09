// ============================================================================
// SOCIALFI & KOL REPUTATION SERVICE
// ============================================================================

import { KolProfile } from '../shared/types/domain';
import { ArkhamIntelligenceService } from '../intelligence/arkham-enrichment';

export interface KolDbAdapter {
  upsertKolProfile(profile: Partial<KolProfile> & { userId: string }): Promise<KolProfile>;
  getKolProfile(userId: string): Promise<KolProfile | null>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class KolService {
  constructor(
    private db: KolDbAdapter,
    private arkhamService: ArkhamIntelligenceService
  ) {}

  async registerOrUpdateKol(
    userId: string,
    walletAddress: string,
    twitterHandle: string,
    followersCount: number
  ): Promise<KolProfile> {
    // 1. Ambil reputasi wallet dari Arkham yang sudah ada
    const arkhamProfile = await this.arkhamService.profileWallet(walletAddress, userId);

    // 2. Hitung Trust Score (kombinasi reputasi on-chain Arkham + metrik followers)
    let score = arkhamProfile.riskPassportScore;
    if (followersCount > 10000) score = Math.min(100, score + 10);
    if (followersCount < 500) score = Math.max(10, score - 20);

    const profile = await this.db.upsertKolProfile({
      userId,
      twitterHandle,
      followersCount,
      trustScore: score,
      isVerified: score >= 60,
    });

    await this.db.createAuditLog(userId, 'KOL_PROFILE_UPDATED', profile.id, `Twitter: @${twitterHandle}`);
    return profile;
  }

  async getProfile(userId: string): Promise<KolProfile | null> {
    return this.db.getKolProfile(userId);
  }
}
