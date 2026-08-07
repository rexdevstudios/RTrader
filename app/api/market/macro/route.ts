import { NextResponse } from 'next/server';
import { fetchDefiLlamaMacroSignal } from '@packages/intelligence/defillama-client';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';


// ============================================================================
// GET /api/market/macro — DefiLlama Macro TVL & Chain Sentiment
// ============================================================================
//
// PUBLIC endpoint (no auth required — read-only macro data).
// Out-of-band: DefiLlama API called with 5s timeout + graceful null fallback.
// Never blocks critical execution path.
// ============================================================================

export async function GET() {
  try {
    const macroSignal = await fetchDefiLlamaMacroSignal();

    const response: ApiResponse<typeof macroSignal> = {
      success: true,
      data: macroSignal,
      timestamp: new Date().toISOString(),
    };

    // Cache-Control: allow CDN edge caching for 60s to reduce DefiLlama hammering
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'MACRO_DATA_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
