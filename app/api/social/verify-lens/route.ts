import { NextRequest, NextResponse } from 'next/server';
import { FarcasterLensService } from '@/packages/social/farcaster-lens-service';
import { ethers } from 'ethers';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, handle, profileId, followersCount } = body;

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_WALLET_ADDRESS: Valid wallet address required' },
        { status: 400 }
      );
    }

    if (!handle) {
      return NextResponse.json(
        { success: false, error: 'INVALID_HANDLE: Lens handle required' },
        { status: 400 }
      );
    }

    const verification = FarcasterLensService.verifyLensProfile({
      walletAddress,
      handle,
      profileId,
      followersCount: followersCount ? Number(followersCount) : undefined,
    });

    if (!verification.isValid) {
      return NextResponse.json(
        { success: false, error: verification.reason || 'LENS_VERIFICATION_FAILED' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: verification.profile,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
