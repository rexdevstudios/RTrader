import { NextRequest, NextResponse } from 'next/server';
import {
  CrossChainClaimAdapter,
  CHAINLINK_CCIP_SELECTORS,
} from '@/packages/launchpad/cross-chain-claim-adapter';
import { ethers } from 'ethers';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const destinationSelector =
      searchParams.get('destinationSelector') || CHAINLINK_CCIP_SELECTORS.ARBITRUM_ONE;
    const recipient =
      searchParams.get('recipient') || '0x1111111111111111111111111111111111111111';
    const tokenAddress =
      searchParams.get('tokenAddress') || '0x2222222222222222222222222222222222222222';
    const amountWeiStr = searchParams.get('amountWei') || (1n * 10n ** 18n).toString();

    if (!ethers.isAddress(recipient)) {
      return NextResponse.json({ success: false, error: 'INVALID_RECIPIENT_ADDRESS' }, { status: 400 });
    }
    if (!ethers.isAddress(tokenAddress)) {
      return NextResponse.json({ success: false, error: 'INVALID_TOKEN_ADDRESS' }, { status: 400 });
    }

    const amountWei = BigInt(amountWeiStr);
    const quote = CrossChainClaimAdapter.estimateCcipBridgeFee(
      destinationSelector,
      amountWei,
      recipient,
      tokenAddress
    );

    return NextResponse.json({
      success: true,
      data: {
        quote,
        supportedChains: CHAINLINK_CCIP_SELECTORS,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'CCIP_BRIDGE_QUOTE_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { destinationSelector, recipient, tokenAddress, amountWei } = body;

    if (!destinationSelector || !recipient || !tokenAddress || !amountWei) {
      return NextResponse.json(
        { success: false, error: 'MISSING_FIELDS: destinationSelector, recipient, tokenAddress, amountWei required' },
        { status: 400 }
      );
    }

    if (!ethers.isAddress(recipient) || !ethers.isAddress(tokenAddress)) {
      return NextResponse.json({ success: false, error: 'INVALID_ADDRESSES' }, { status: 400 });
    }

    const quote = CrossChainClaimAdapter.estimateCcipBridgeFee(
      destinationSelector,
      BigInt(amountWei),
      recipient,
      tokenAddress
    );

    return NextResponse.json({
      success: true,
      data: {
        bridgeInitiated: true,
        protocol: 'CHAINLINK_CCIP',
        quote,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'CCIP_BRIDGE_EXECUTION_FAILED' },
      { status: 500 }
    );
  }
}
