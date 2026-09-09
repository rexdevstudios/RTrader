import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { BountyEscrowService, BountyClaimItem } from '@packages/launchpad/bounty-escrow';
import { FirecrawlScraperService } from '@packages/intelligence/firecrawl-scraper';
import { BountyCampaign, BountyClaim, KolProfile } from '@packages/shared/types/domain';

// In-memory SSOT store for claims
const inMemoryClaims: Map<string, BountyClaim> = new Map();
const verifiedClaimWallets: BountyClaimItem[] = [
  {
    walletAddress: '0x1111111111111111111111111111111111111111',
    tokenAmount: 1000000000000000000000n, // 1,000 tokens
  },
  {
    walletAddress: '0x2222222222222222222222222222222222222222',
    tokenAmount: 1000000000000000000000n,
  },
];

const mockBountyDb = {
  getCampaign: async (id: string): Promise<BountyCampaign | null> => {
    return {
      id,
      launchId: 'launch-demo',
      creatorId: 'usr-creator',
      title: 'Demo Marketing Campaign',
      requiredHashtag: '#DegenMoon',
      minFollowers: 500,
      rewardPerKol: 1000000000000000000000n,
      maxParticipants: 50,
      currentParticipants: verifiedClaimWallets.length,
      isActive: true,
    };
  },
  getClaim: async (campaignId: string, kolId: string): Promise<BountyClaim | null> => {
    return inMemoryClaims.get(`${campaignId}:${kolId}`) || null;
  },
  createClaim: async (campaignId: string, kolId: string, proofUrl: string): Promise<BountyClaim> => {
    const claim: BountyClaim = {
      id: `claim-${Date.now()}`,
      campaignId,
      kolId,
      proofUrl,
      verificationStatus: 'PENDING',
      createdAt: new Date(),
    };
    inMemoryClaims.set(`${campaignId}:${kolId}`, claim);
    return claim;
  },
  updateClaimStatus: async (claimId: string, status: 'VERIFIED' | 'REJECTED' | 'CLAIMED') => {
    for (const [key, val] of inMemoryClaims.entries()) {
      if (val.id === claimId) {
        val.verificationStatus = status;
        if (status === 'CLAIMED') val.claimedAt = new Date();
        break;
      }
    }
  },
  incrementCampaignParticipant: async () => {},
  createAuditLog: async () => {},
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('walletAddress');
  const tokenAddress = searchParams.get('tokenAddress') || '0x0000000000000000000000000000000000000000';

  if (!walletAddress) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'MISSING_WALLET', message: 'walletAddress query parameter is required' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }

  // Generate Merkle Tree for verified claims
  const tree = BountyEscrowService.generateBountyMerkleTree(verifiedClaimWallets);
  const targetItem = verifiedClaimWallets.find(
    (c) => c.walletAddress.toLowerCase() === walletAddress.toLowerCase()
  );

  const proof = targetItem ? tree.getProof(targetItem.walletAddress, targetItem.tokenAmount) : [];
  const tokenAmount = targetItem ? targetItem.tokenAmount.toString() : '0';

  const response: ApiResponse<{
    tokenAddress: string;
    walletAddress: string;
    tokenAmount: string;
    isEligible: boolean;
    merkleRoot: string;
    merkleProof: string[];
  }> = {
    success: true,
    data: {
      tokenAddress,
      walletAddress,
      tokenAmount,
      isEligible: !!targetItem,
      merkleRoot: tree.root,
      merkleProof: proof,
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { campaignId, proofUrl, walletAddress, twitterHandle, followersCount } = body;

    if (!campaignId || !proofUrl || !walletAddress) {
      const res: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'campaignId, proofUrl, and walletAddress are required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(res, { status: 400 });
    }

    const kolMock: KolProfile = {
      id: `kol-${walletAddress.slice(0, 8).toLowerCase()}`,
      userId: `usr-${walletAddress.slice(0, 8).toLowerCase()}`,
      twitterHandle: twitterHandle || 'cryptorider',
      followersCount: Number(followersCount) || 1200,
      trustScore: 85,
      completedBounties: 1,
      totalEarnedUsd: 250,
      isVerified: true,
    };

    const scraper = new FirecrawlScraperService();
    const service = new BountyEscrowService(mockBountyDb, scraper);

    const result = await service.submitAndVerifyClaim(campaignId, kolMock, proofUrl);

    if (result.success && result.claim) {
      // Add wallet to verified list for Merkle aggregation
      if (!verifiedClaimWallets.some((c) => c.walletAddress.toLowerCase() === walletAddress.toLowerCase())) {
        verifiedClaimWallets.push({
          walletAddress,
          tokenAmount: 1000000000000000000000n,
        });
      }

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      const response: ApiResponse<typeof result> = {
        success: false,
        error: { code: 'VERIFICATION_REJECTED', message: result.reason || 'Verification rejected' },
        data: result,
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 422 });
    }
  } catch (error) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'CLAIM_SUBMISSION_FAILED', message: (error as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }
}
