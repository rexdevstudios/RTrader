import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { BountyEscrowService, BountyClaimItem } from '@packages/launchpad/bounty-escrow';
import { FirecrawlScraperService } from '@packages/intelligence/firecrawl-scraper';
import { BountyCampaign, BountyClaim, KolProfile } from '@packages/shared/types/domain';
import { defaultBountyDbAdapter, defaultKolDbAdapter, getDbPool } from '@packages/shared/db-pool';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const walletAddress = searchParams.get('walletAddress');
  const campaignId = searchParams.get('campaignId') || undefined;
  const tokenAddress = searchParams.get('tokenAddress') || '0x0000000000000000000000000000000000000000';

  if (!walletAddress) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'MISSING_WALLET', message: 'walletAddress query parameter is required' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }

  // Fetch verified claims directly from PostgreSQL SSOT
  const verifiedClaims = defaultBountyDbAdapter.getVerifiedClaims
    ? await defaultBountyDbAdapter.getVerifiedClaims(campaignId)
    : [];

  // Generate Merkle Tree for verified claims
  const tree = BountyEscrowService.generateBountyMerkleTree(verifiedClaims);
  const targetItem = verifiedClaims.find(
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
    const {
      campaignId,
      proofUrl,
      walletAddress,
      twitterHandle,
      followersCount,
      claimType,
      tokenAddress,
      chain,
    } = body;

    const finalProofUrl =
      proofUrl ||
      (claimType === 'HOLD'
        ? `hodl://${walletAddress}`
        : claimType === 'STAKE'
        ? `vault-staking://${walletAddress}`
        : '');

    if (!campaignId || !finalProofUrl || !walletAddress) {
      const res: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'campaignId, proofUrl, and walletAddress are required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(res, { status: 400 });
    }

    // Resolve official KOL profile from SSOT (or register if new)
    let kol = await defaultKolDbAdapter.getKolProfile(walletAddress);
    if (!kol) {
      kol = await defaultKolDbAdapter.upsertKolProfile({
        userId: walletAddress,
        twitterHandle: twitterHandle ? twitterHandle.replace('@', '') : undefined,
        followersCount: Number(followersCount) || 1200,
        trustScore: 85,
        isVerified: true,
      });
    }

    // Resolve token contract address & chain from campaign launch if not supplied
    let resolvedTokenAddress = tokenAddress;
    let resolvedChain = chain;

    if (!resolvedTokenAddress) {
      const pool = getDbPool();
      if (pool) {
        try {
          const cRes = await pool.query(
            `SELECT tl.contract_address, tl.chain 
             FROM bounty_campaigns bc 
             JOIN token_launches tl ON tl.id = bc.launch_id 
             WHERE bc.id = $1 LIMIT 1`,
            [campaignId]
          );
          if (cRes.rows.length > 0) {
            resolvedTokenAddress = cRes.rows[0].contract_address;
            resolvedChain = cRes.rows[0].chain;
          }
        } catch {
          // Graceful fallback
        }
      }
    }

    const service = new BountyEscrowService(defaultBountyDbAdapter);

    const result = await service.submitAndVerifyClaim(campaignId, kol, finalProofUrl, {
      claimType,
      tokenAddress: resolvedTokenAddress,
      chain: resolvedChain,
    });

    if (result.success && result.claim) {
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
