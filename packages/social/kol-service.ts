// ============================================================================
// SOCIALFI & KOL REPUTATION SERVICE
// ============================================================================

import { KolProfile } from '../shared/types/domain';
import { ArkhamIntelligenceService } from '../intelligence/arkham-enrichment';
import { FarcasterLensService } from './farcaster-lens-service';
import { ethers } from 'ethers';

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

  static getAttestationMessage(walletAddress: string, twitterHandle: string): string {
    return `RTrader SocialFi Identity Attestation:\nWallet: ${ethers.getAddress(walletAddress).toLowerCase()}\nTwitter: @${twitterHandle.toLowerCase()}`;
  }

  static verifySocialAttestation(
    walletAddress: string,
    twitterHandle: string,
    signature: string
  ): boolean {
    if (!ethers.isAddress(walletAddress)) return false;
    try {
      const message = KolService.getAttestationMessage(walletAddress, twitterHandle);
      const recovered = ethers.verifyMessage(message, signature);
      return recovered.toLowerCase() === walletAddress.toLowerCase();
    } catch {
      return false;
    }
  }

  static generateTwitterAuthUrl(state: string, redirectUri: string): string {
    const clientId = process.env.TWITTER_CLIENT_ID || 'mock_twitter_client_id';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'users.read tweet.read offline.access',
      state,
      code_challenge: 'challenge',
      code_challenge_method: 'plain',
    });
    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  async registerOrUpdateKol(
    userId: string,
    walletAddress: string,
    twitterHandle: string,
    followersCount: number,
    farcasterFid?: number,
    farcasterUsername?: string,
    lensHandle?: string
  ): Promise<KolProfile> {
    // 1. Ambil reputasi wallet dari Arkham yang sudah ada
    const arkhamProfile = await this.arkhamService.profileWallet(walletAddress, userId);

    // 2. Hitung Trust Score (kombinasi reputasi on-chain Arkham + metrik followers)
    let score = arkhamProfile.riskPassportScore;
    if (followersCount > 10000) score = Math.min(100, score + 10);
    if (followersCount < 500) score = Math.max(10, score - 20);

    // 3. Web3 Social Graph Bonus (Farcaster & Lens)
    let web3SocialScore: number | undefined;
    if (farcasterFid || lensHandle) {
      web3SocialScore = FarcasterLensService.calculateWeb3ReputationScore(
        !!farcasterFid,
        !!lensHandle,
        farcasterFid ? 350 : 0,
        lensHandle ? 200 : 0
      );
      score = Math.min(100, score + 10); // Reward KOL for Web3 native identity
    }

    const profile = await this.db.upsertKolProfile({
      userId,
      twitterHandle,
      followersCount,
      farcasterFid,
      farcasterUsername,
      lensHandle,
      web3SocialScore,
      trustScore: score,
      isVerified: score >= 60,
    });

    await this.db.createAuditLog(
      userId,
      'KOL_PROFILE_UPDATED',
      profile.id,
      `Twitter: @${twitterHandle} | FC: ${farcasterUsername || 'none'} | Lens: ${lensHandle || 'none'}`
    );
    return profile;
  }

  async getProfile(userId: string): Promise<KolProfile | null> {
    return this.db.getKolProfile(userId);
  }
}
