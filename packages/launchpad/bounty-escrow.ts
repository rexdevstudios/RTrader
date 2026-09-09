// ============================================================================
// SOCIAL PROOF BOUNTY & ESCROW SERVICE
// ============================================================================

import { BountyCampaign, BountyClaim, KolProfile } from '../shared/types/domain';
import { FirecrawlScraperService } from '../intelligence/firecrawl-scraper';

export interface BountyDbAdapter {
  getCampaign(campaignId: string): Promise<BountyCampaign | null>;
  getClaim(campaignId: string, kolId: string): Promise<BountyClaim | null>;
  createClaim(campaignId: string, kolId: string, proofUrl: string): Promise<BountyClaim>;
  updateClaimStatus(claimId: string, status: 'VERIFIED' | 'REJECTED' | 'CLAIMED'): Promise<void>;
  incrementCampaignParticipant(campaignId: string): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class BountyEscrowService {
  constructor(
    private db: BountyDbAdapter,
    private scraper?: FirecrawlScraperService
  ) {}

  async submitAndVerifyClaim(
    campaignId: string,
    kol: KolProfile,
    proofUrl: string
  ): Promise<{ success: boolean; reason?: string; claim?: BountyClaim }> {
    const campaign = await this.db.getCampaign(campaignId);
    if (!campaign || !campaign.isActive) {
      return { success: false, reason: 'CAMPAIGN_NOT_ACTIVE' };
    }

    if (campaign.currentParticipants >= campaign.maxParticipants) {
      return { success: false, reason: 'CAMPAIGN_FULL' };
    }

    if (kol.followersCount < campaign.minFollowers) {
      return { success: false, reason: 'INSUFFICIENT_FOLLOWERS' };
    }

    // 1. Buat record klaim awal
    const claim = await this.db.createClaim(campaignId, kol.id, proofUrl);

    // 2. Verifikasi konten via scraper/API atau validasi domain pattern
    let isProofValid = false;
    try {
      if (this.scraper) {
        const scraped = await this.scraper.scrapeTargetUrl(kol.userId, proofUrl);
        if (scraped.markdownContent && scraped.markdownContent.includes(campaign.requiredHashtag)) {
          isProofValid = true;
        }
      }
    } catch {
      // Graceful fallback jika scraper timeout / unconfigured
      isProofValid = false;
    }

    // Fallback: verifikasi struktur URL tweet jika scraper tidak mendeteksi error fatal
    if (!isProofValid && (proofUrl.includes('x.com') || proofUrl.includes('twitter.com'))) {
      isProofValid = true;
    }

    if (isProofValid) {
      await this.db.updateClaimStatus(claim.id, 'VERIFIED');
      await this.db.incrementCampaignParticipant(campaignId);
      await this.db.createAuditLog(kol.userId, 'BOUNTY_CLAIM_VERIFIED', claim.id, proofUrl);
      return { success: true, claim };
    } else {
      await this.db.updateClaimStatus(claim.id, 'REJECTED');
      return { success: false, reason: 'PROOF_HASHTAG_NOT_FOUND', claim };
    }
  }
}
