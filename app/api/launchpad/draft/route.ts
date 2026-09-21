import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse, CreateLaunchDraftRequest } from '@packages/shared/contracts/api-contracts';
import { LaunchDraftService } from '@packages/launchpad/launch-draft-service';
import { defaultDraftDbAdapter } from '@packages/shared/db-pool';
import { requireCapability } from '@packages/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireCapability(req, 'CREATE_LAUNCH_DRAFT');
    const body = (await req.json()) as CreateLaunchDraftRequest & { creatorWallet?: string };
    
    const isAdmin = auth.user.roles.includes('SUPER_ADMIN') || auth.user.roles.includes('LAUNCH_ADMIN');
    const creatorWallet = (isAdmin && body.creatorWallet) ? body.creatorWallet : auth.walletAddress;
    const actorId = auth.user.userId;

    const service = new LaunchDraftService(defaultDraftDbAdapter);
    const draft = await service.createDraft(actorId, creatorWallet, body);

    const response: ApiResponse<typeof draft> = {
      success: true,
      data: draft,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Draft creation failed';
    if (message.includes('DATABASE_UNAVAILABLE')) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message }, timestamp: new Date().toISOString() },
        { status: 503 }
      );
    }
    if (message.startsWith('RBAC_FORBIDDEN') || message.startsWith('AUTH_ACCOUNT_')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message }, timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }
    if (message.startsWith('UNAUTHORIZED')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message }, timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'DRAFT_CREATION_FAILED', message },
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
