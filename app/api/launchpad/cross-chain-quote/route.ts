import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { CrossChainClaimAdapter, LAYERZERO_ENDPOINT_IDS } from '@packages/launchpad/cross-chain-claim-adapter';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dstEidParam = searchParams.get('dstEid');
  const tokenAmountParam = searchParams.get('tokenAmount') || '1000000000000000000000';

  const dstEid = dstEidParam ? Number(dstEidParam) : LAYERZERO_ENDPOINT_IDS.ARBITRUM_ONE;
  const tokenAmount = BigInt(tokenAmountParam);

  const quote = CrossChainClaimAdapter.estimateCrossChainFee(dstEid, tokenAmount);

  const response: ApiResponse<typeof quote> = {
    success: true,
    data: quote,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
