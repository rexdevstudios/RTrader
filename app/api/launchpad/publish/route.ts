import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { defaultDraftDbAdapter } from '@packages/shared/db-pool';
import { authenticateSession } from '@packages/auth/session';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateSession(req);
    const body = await req.json();
    const { draftId, contractAddress, chain, txHash, currentSupply, graduationThreshold } = body;

    // 1. Validation
    if (!draftId || !isUuid(draftId)) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_DRAFT_ID', message: 'draftId harus berupa format UUID yang valid.' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_CONTRACT_ADDRESS', message: 'contractAddress harus berupa alamat Ethereum/EVM yang sah.' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    // 2. Publish Launch Draft into PostgreSQL SSOT
    if (!defaultDraftDbAdapter.publishLaunchDraft) {
      throw new Error('publishLaunchDraft adapter method not implemented.');
    }

    const result = await defaultDraftDbAdapter.publishLaunchDraft({
      draftId,
      contractAddress,
      chain: chain || 'base-mainnet',
      txHash,
      currentSupply,
      graduationThreshold: graduationThreshold ? Number(graduationThreshold) : undefined,
    });

    const response: ApiResponse<{
      launchId: string;
      contractAddress: string;
      status: 'PUBLISHED';
      publishedAt: string;
      actorId: string | null;
    }> = {
      success: true,
      data: {
        launchId: result.launchId,
        contractAddress: result.contractAddress,
        status: 'PUBLISHED',
        publishedAt: new Date().toISOString(),
        actorId: session?.user?.userId || null,
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err: any) {
    console.error('[POST /api/launchpad/publish] Error:', err);
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'PUBLISH_FAILED', message: err?.message || 'Failed to publish token launch' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
