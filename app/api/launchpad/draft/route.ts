import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse, CreateLaunchDraftRequest } from '@packages/shared/contracts/api-contracts';
import { LaunchDraftService } from '@packages/launchpad/launch-draft-service';

// In-memory cache fallback untuk serverless session
const inMemoryDrafts: any[] = [];

const defaultDbAdapter = {
  saveDraft: async (draft: any) => {
    inMemoryDrafts.unshift(draft);
    return draft.id;
  },
  saveWhitelist: async () => {},
  createAuditLog: async () => {},
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateLaunchDraftRequest & { creatorWallet?: string };
    const creatorWallet = body.creatorWallet || '0x0000000000000000000000000000000000000000';
    const actorId = `usr-${creatorWallet.slice(0, 8).toLowerCase()}`;

    const service = new LaunchDraftService(defaultDbAdapter);
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
  const response: ApiResponse<typeof inMemoryDrafts> = {
    success: true,
    data: inMemoryDrafts,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(response);
}
