import { NextResponse } from 'next/server';
import { defaultDraftDbAdapter } from '@packages/shared/db-pool';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const launches = await defaultDraftDbAdapter.getActiveTokenLaunches();
    const response: ApiResponse<typeof launches> = {
      success: true,
      data: launches,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'FETCH_TOKENS_FAILED', message: err?.message || 'Failed to fetch active tokens' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
