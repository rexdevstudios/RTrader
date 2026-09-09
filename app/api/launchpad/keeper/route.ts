import { NextRequest, NextResponse } from 'next/server';
import { KeeperAutomationService } from '@/packages/launchpad/keeper-automation-service';
import { ethers } from 'ethers';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tokenAddress = searchParams.get('tokenAddress');

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN_ADDRESS: Valid token address required' },
        { status: 400 }
      );
    }

    // Default simulation evaluation
    const lastHarvest = searchParams.get('lastHarvest')
      ? Number(searchParams.get('lastHarvest'))
      : Math.floor(Date.now() / 1000) - 8 * 86400; // default 8 days ago (due for harvest)

    const status = KeeperAutomationService.evaluateUpkeep(tokenAddress, true, lastHarvest);
    const performData = KeeperAutomationService.encodePerformData(tokenAddress);

    return NextResponse.json({
      success: true,
      data: {
        ...status,
        performData,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'KEEPER_EVALUATION_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tokenAddress } = body;

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN_ADDRESS: Valid token address required' },
        { status: 400 }
      );
    }

    const performData = KeeperAutomationService.encodePerformData(tokenAddress);
    const decodedToken = KeeperAutomationService.decodePerformData(performData);

    return NextResponse.json({
      success: true,
      data: {
        tokenAddress: decodedToken,
        upkeepExecuted: true,
        action: 'HARVEST_AND_COMPOUND',
        timestamp: Math.floor(Date.now() / 1000),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'KEEPER_EXECUTION_FAILED' },
      { status: 500 }
    );
  }
}
