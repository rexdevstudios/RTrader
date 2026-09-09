import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse, CreateLaunchDraftRequest } from '@packages/shared/contracts/api-contracts';
import { LaunchDraftService } from '@packages/launchpad/launch-draft-service';
import { defaultDraftDbAdapter } from '@packages/shared/db-pool';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateLaunchDraftRequest & { creatorWallet?: string };
    const creatorWallet = body.creatorWallet || '0x0000000000000000000000000000000000000000';
    const actorId = `usr-${creatorWallet.slice(0, 8).toLowerCase()}`;

    const service = new LaunchDraftService(defaultDraftDbAdapter);
    const draft = await service.createDraft(actorId, creatorWallet, body);

    const response: ApiResponse<typeof draft> = {
      success: true,
      data: draft,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'DRAFT_CREATION_FAILED', message: (error as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 400 });
  }
}

export async function GET() {
  const drafts = await defaultDraftDbAdapter.getDrafts();
  const response: ApiResponse<typeof drafts> = {
    success: true,
    data: drafts,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(response);
}
