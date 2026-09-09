import { NextRequest, NextResponse } from 'next/server';
import { MevProtectionService } from '@/packages/trading/mev-protection';
import { ethers } from 'ethers';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tokenAddress = searchParams.get('tokenAddress');
    const liquidityEth = searchParams.get('liquidityEth') || '24';
    const chainId = searchParams.get('chainId') ? Number(searchParams.get('chainId')) : 8453;

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN_ADDRESS: Valid token address required' },
        { status: 400 }
      );
    }

    const liquidityWei = ethers.parseEther(liquidityEth);
    const quote = MevProtectionService.evaluateGraduationSlippage(tokenAddress, liquidityWei, chainId);
    const verification = MevProtectionService.verifyMevProtection(quote);

    return NextResponse.json({
      success: true,
      data: {
        ...quote,
        liquidityEth,
        liquidityWei: quote.liquidityWei.toString(),
        isSafe: verification.isSafe,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'MEV_EVALUATION_FAILED' },
      { status: 500 }
    );
  }
}
