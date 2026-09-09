import { NextRequest, NextResponse } from 'next/server';
import { GaslessPaymasterService } from '@/packages/launchpad/gasless-paymaster';
import { ethers } from 'ethers';

const paymasterService = new GaslessPaymasterService({
  signerPrivateKey: process.env.PAYMASTER_SIGNER_PRIVATE_KEY,
  defaultChainId: 8453,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tokenAddress, kolWallet, tokenAmount, chainId } = body;

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN_ADDRESS: Valid token address required' },
        { status: 400 }
      );
    }

    if (!kolWallet || !ethers.isAddress(kolWallet)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_KOL_WALLET: Valid KOL wallet address required' },
        { status: 400 }
      );
    }

    let parsedAmount: bigint;
    try {
      parsedAmount = BigInt(tokenAmount);
      if (parsedAmount <= 0n) throw new Error();
    } catch {
      return NextResponse.json(
        { success: false, error: 'INVALID_AMOUNT: Positive token amount required' },
        { status: 400 }
      );
    }

    const quote = await paymasterService.signSponsorship(
      tokenAddress,
      kolWallet,
      parsedAmount,
      3600, // 1 hour validity
      chainId ? Number(chainId) : 8453
    );

    return NextResponse.json({
      success: true,
      data: quote,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'PAYMASTER_SPONSORSHIP_FAILED' },
      { status: 500 }
    );
  }
}
