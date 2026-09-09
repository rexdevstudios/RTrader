import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { KolService } from '@packages/social/kol-service';
import { ArkhamIntelligenceService } from '@packages/intelligence/arkham-enrichment';
import { KolProfile } from '@packages/shared/types/domain';
import { defaultKolDbAdapter } from '@packages/shared/db-pool';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || searchParams.get('walletAddress');

  if (!userId) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'MISSING_USER_ID', message: 'userId or walletAddress parameter is required' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }

  const profile = await defaultKolDbAdapter.getKolProfile(userId);
  const response: ApiResponse<KolProfile | null> = {
    success: true,
    data: profile,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(response);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, walletAddress, twitterHandle, followersCount } = body;

    if (!userId || !walletAddress || !twitterHandle) {
      const res: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'userId, walletAddress, and twitterHandle are required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(res, { status: 400 });
    }

    const arkham = new ArkhamIntelligenceService();
    const service = new KolService(defaultKolDbAdapter, arkham);

    const profile = await service.registerOrUpdateKol(
      userId,
      walletAddress,
      twitterHandle.replace('@', ''),
      Number(followersCount) || 1000
    );

    const response: ApiResponse<KolProfile> = {
      success: true,
      data: profile,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'REGISTRATION_FAILED', message: (error as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }
}
