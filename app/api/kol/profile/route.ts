import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { KolService } from '@packages/social/kol-service';
import { ArkhamIntelligenceService } from '@packages/intelligence/arkham-enrichment';
import { KolProfile } from '@packages/shared/types/domain';

// In-memory SSOT store fallback for serverless session
const inMemoryProfiles: Map<string, KolProfile> = new Map();

const mockKolDb = {
  upsertKolProfile: async (p: Partial<KolProfile> & { userId: string }): Promise<KolProfile> => {
    const existing = inMemoryProfiles.get(p.userId) || {
      id: `kol-${Date.now()}`,
      userId: p.userId,
      twitterHandle: p.twitterHandle,
      followersCount: p.followersCount || 0,
      trustScore: p.trustScore || 50,
      completedBounties: 0,
      totalEarnedUsd: 0,
      isVerified: p.isVerified || false,
    };
    const updated: KolProfile = {
      ...existing,
      ...p,
      id: existing.id,
      userId: p.userId,
      followersCount: p.followersCount ?? existing.followersCount,
      trustScore: p.trustScore ?? existing.trustScore,
      isVerified: p.isVerified ?? existing.isVerified,
    };
    inMemoryProfiles.set(p.userId, updated);
    return updated;
  },
  getKolProfile: async (userId: string): Promise<KolProfile | null> => {
    return inMemoryProfiles.get(userId) || null;
  },
  createAuditLog: async () => {},
};

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

  const profile = await mockKolDb.getKolProfile(userId);
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
    const service = new KolService(mockKolDb, arkham);

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
