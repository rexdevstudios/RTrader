import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { KolService } from '@packages/social/kol-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress, twitterHandle, signature } = body;

    if (!walletAddress || !twitterHandle) {
      const res: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'walletAddress and twitterHandle are required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(res, { status: 400 });
    }

    const cleanHandle = twitterHandle.replace('@', '').trim();

    // If signature provided, cryptographically verify it
    if (signature) {
      const isValid = KolService.verifySocialAttestation(walletAddress, cleanHandle, signature);
      if (!isValid) {
        const res: ApiResponse<null> = {
          success: false,
          error: { code: 'INVALID_SIGNATURE', message: 'Cryptographic social attestation signature is invalid' },
          timestamp: new Date().toISOString(),
        };
        return NextResponse.json(res, { status: 401 });
      }
    }

    const response: ApiResponse<{
      walletAddress: string;
      twitterHandle: string;
      isVerified: boolean;
      verifiedAt: string;
      attestationMessage: string;
    }> = {
      success: true,
      data: {
        walletAddress,
        twitterHandle: cleanHandle,
        isVerified: true,
        verifiedAt: new Date().toISOString(),
        attestationMessage: KolService.getAttestationMessage(walletAddress, cleanHandle),
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'VERIFICATION_ERROR', message: (error as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 500 });
  }
}
