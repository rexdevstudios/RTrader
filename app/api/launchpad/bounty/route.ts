import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { BountyCampaign } from '@packages/shared/types/domain';

// In-memory SSOT store for campaigns
const inMemoryCampaigns: BountyCampaign[] = [
  {
    id: 'campaign-degen-1',
    launchId: 'launch-degen-moon',
    creatorId: 'usr-creator-1',
    title: 'Degen Moon Viral TikTok & X Raid',
    requiredHashtag: '#DegenMoon',
    minFollowers: 500,
    rewardPerKol: 1000000000000000000000n, // 1,000 tokens (18 dec)
    maxParticipants: 50,
    currentParticipants: 12,
    isActive: true,
  },
  {
    id: 'campaign-cdao-2',
    launchId: 'launch-creator-dao',
    creatorId: 'usr-creator-2',
    title: 'CreatorDAO Community Bounty',
    requiredHashtag: '#CreatorDAO',
    minFollowers: 1000,
    rewardPerKol: 2500000000000000000000n, // 2,500 tokens
    maxParticipants: 20,
    currentParticipants: 8,
    isActive: true,
  },
];

export async function GET() {
  const serialized = inMemoryCampaigns.map((c) => ({
    ...c,
    rewardPerKol: c.rewardPerKol.toString(),
  }));

  const response: ApiResponse<typeof serialized> = {
    success: true,
    data: serialized,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(response);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { launchId, creatorId, title, requiredHashtag, minFollowers, rewardPerKol, maxParticipants } = body;

    if (!title || !requiredHashtag) {
      const res: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'title and requiredHashtag are required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(res, { status: 400 });
    }

    const newCampaign: BountyCampaign = {
      id: `campaign-${Date.now()}`,
      launchId: launchId || `launch-${Date.now()}`,
      creatorId: creatorId || 'usr-creator-anonymous',
      title,
      requiredHashtag: requiredHashtag.startsWith('#') ? requiredHashtag : `#${requiredHashtag}`,
      minFollowers: Number(minFollowers) || 500,
      rewardPerKol: BigInt(rewardPerKol || '1000000000000000000000'),
      maxParticipants: Number(maxParticipants) || 50,
      currentParticipants: 0,
      isActive: true,
    };

    inMemoryCampaigns.unshift(newCampaign);

    const serialized = {
      ...newCampaign,
      rewardPerKol: newCampaign.rewardPerKol.toString(),
    };

    const response: ApiResponse<typeof serialized> = {
      success: true,
      data: serialized,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'CAMPAIGN_CREATION_FAILED', message: (error as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }
}
