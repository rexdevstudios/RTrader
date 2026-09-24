import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { defaultDraftDbAdapter } from '@packages/shared/db-pool';
import { DexPairFactoryService } from '@packages/launchpad/dex-pair-factory';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

function isUuid(id?: string): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { launchId, contractAddress, dexPairAddress, raisedAmount } = body;

    if (!launchId && !contractAddress) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'Harap sediakan launchId (UUID) atau contractAddress (0x...) yang valid.',
        },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    if (contractAddress && !ethers.isAddress(contractAddress)) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'INVALID_CONTRACT_ADDRESS',
          message: 'contractAddress harus berupa alamat Ethereum/EVM 20-byte yang sah.',
        },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    if (launchId && !isUuid(launchId)) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'INVALID_LAUNCH_ID',
          message: 'launchId harus berformat UUID v4.',
        },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    if (!defaultDraftDbAdapter.graduateTokenLaunch) {
      throw new Error('graduateTokenLaunch adapter method not implemented.');
    }

    const result = await defaultDraftDbAdapter.graduateTokenLaunch({
      launchId,
      contractAddress,
      dexPairAddress,
      raisedAmount: raisedAmount ? Number(raisedAmount) : undefined,
    });

    const pairDetails = DexPairFactoryService.getDexPairDetails(
      'base-mainnet',
      result.contractAddress,
      result.dexPairAddress
    );

    const response: ApiResponse<{
      launchId: string;
      contractAddress: string;
      dexPairAddress: string;
      isGraduated: boolean;
      graduatedAt: string;
      dexDetails: typeof pairDetails;
    }> = {
      success: true,
      data: {
        launchId: result.launchId,
        contractAddress: result.contractAddress,
        dexPairAddress: result.dexPairAddress,
        isGraduated: result.isGraduated,
        graduatedAt: result.graduatedAt.toISOString(),
        dexDetails: pairDetails,
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[POST /api/launchpad/graduate] Error:', err);
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'GRADUATION_FAILED', message: err?.message || 'Graduation trigger failed' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractAddress = searchParams.get('contractAddress') || searchParams.get('address');
    const chain = searchParams.get('chain') || 'base';

    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_QUERY', message: 'Parameter query ?contractAddress= valid diperlukan.' },
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const tokenLaunch = await defaultDraftDbAdapter.getTokenLaunchByAddress?.(chain, contractAddress);

    if (!tokenLaunch) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Token launch tidak ditemukan di database.' },
          timestamp: new Date().toISOString(),
        },
        { status: 404 }
      );
    }

    const raised = Number(tokenLaunch.raisedAmount || 0);
    const threshold = Number(tokenLaunch.graduationThreshold || 69000);
    const isReadyForGraduation = raised >= threshold;
    const progressPct = Math.min(100, Math.round((raised / threshold) * 100));

    const dexDetails = DexPairFactoryService.getDexPairDetails(
      tokenLaunch.chain || chain,
      contractAddress,
      tokenLaunch.dexPairAddress
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          contractAddress: tokenLaunch.contractAddress,
          chain: tokenLaunch.chain,
          name: tokenLaunch.name,
          ticker: tokenLaunch.ticker,
          raisedAmount: raised,
          graduationThreshold: threshold,
          progressPct,
          isGraduated: Boolean(tokenLaunch.isGraduated),
          isReadyForGraduation,
          dexPairAddress: tokenLaunch.dexPairAddress || dexDetails.dexPairAddress,
          dexDetails,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'LOOKUP_FAILED', message: err?.message || 'Failed to inspect graduation status' },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
