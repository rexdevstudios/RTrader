import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { BountyCampaign } from '@packages/shared/types/domain';
import { defaultBountyDbAdapter } from '@packages/shared/db-pool';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const launchId = searchParams.get('launchId') || undefined;

  const campaigns = await defaultBountyDbAdapter.listCampaigns(launchId);
  const serialized = campaigns.map((c) => ({
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

    const savedId = await defaultBountyDbAdapter.createCampaign(newCampaign);
    newCampaign.id = savedId;

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
