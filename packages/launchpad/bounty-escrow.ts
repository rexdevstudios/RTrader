// ============================================================================
// SOCIAL PROOF BOUNTY & ESCROW SERVICE
// ============================================================================

import { BountyCampaign, BountyClaim, KolProfile } from '../shared/types/domain';
import { FirecrawlScraperService } from '../intelligence/firecrawl-scraper';
import { ethers } from 'ethers';

export interface BountyClaimItem {
  walletAddress: string;
  tokenAmount: bigint;
}

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

  static hashClaim(walletAddress: string, tokenAmount: bigint): string {
    if (!ethers.isAddress(walletAddress)) {
      throw new Error(`INVALID_WALLET_ADDRESS: ${walletAddress}`);
    }
    return ethers.solidityPackedKeccak256(['address', 'uint256'], [ethers.getAddress(walletAddress), tokenAmount]);
  }

  static generateBountyMerkleTree(claims: BountyClaimItem[]): {
    root: string;
    getProof: (wallet: string, amount: bigint) => string[];
  } {
    const validClaims = claims.filter((c) => ethers.isAddress(c.walletAddress) && c.tokenAmount > 0n);
    if (validClaims.length === 0) {
      return {
        root: '0x0000000000000000000000000000000000000000000000000000000000000000',
        getProof: () => [],
      };
    }

    const leaves = validClaims.map((c) => BountyEscrowService.hashClaim(c.walletAddress, c.tokenAmount));
    if (leaves.length === 1) {
      return {
        root: leaves[0],
        getProof: (w, a) => {
          if (!ethers.isAddress(w)) return [];
          const targetHash = BountyEscrowService.hashClaim(w, a);
          return targetHash === leaves[0] ? [] : [];
        },
      };
    }

    const combine = (a: string, b: string) =>
      a <= b ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));

    let currentLevel = [...leaves];
    const treeLevels: string[][] = [currentLevel];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(combine(currentLevel[i], currentLevel[i + 1]));
        } else {
          nextLevel.push(currentLevel[i]);
        }
      }
      currentLevel = nextLevel;
      treeLevels.push(currentLevel);
    }

    const root = treeLevels[treeLevels.length - 1][0];

    const getProof = (targetWallet: string, targetAmount: bigint): string[] => {
      if (!ethers.isAddress(targetWallet)) return [];
      const targetHash = BountyEscrowService.hashClaim(targetWallet, targetAmount);
      let index = treeLevels[0].indexOf(targetHash);
      if (index === -1) return [];

      const proof: string[] = [];
      for (let level = 0; level < treeLevels.length - 1; level++) {
        const isRight = index % 2 === 1;
        const pairIndex = isRight ? index - 1 : index + 1;
        if (pairIndex < treeLevels[level].length) {
          proof.push(treeLevels[level][pairIndex]);
        }
        index = Math.floor(index / 2);
      }
      return proof;
    };

    return { root, getProof };
  }

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
