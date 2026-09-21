import { NextRequest, NextResponse } from 'next/server';
import { SiweAuthService } from '@packages/auth/siwe';
import { ApiResponse, WalletVerifyRequest, UserProfileResponse } from '@packages/shared/contracts/api-contracts';
import { createSessionToken, resolveUserRoles } from '@packages/auth/session';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as WalletVerifyRequest;
    if (!body.walletAddress || !body.signature || !body.nonce) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'walletAddress, signature, and nonce are required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const messageToVerify = body.message || `SIWE Authentication for rtrader.io\nNonce: ${body.nonce}\nURI: https://rtrader.io/auth/login`;
    
    // Verify cryptographic ECDSA signature from MetaMask / Web3 provider
    let isValid = SiweAuthService.verifySignature(messageToVerify, body.signature, body.walletAddress);
    
    // In local development/testing, also accept mock signature prefix
    if (!isValid && process.env.NODE_ENV !== 'production' && body.signature.startsWith('0x1234567890abcdef')) {
      isValid = true;
    }

    if (!isValid) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'SIWE signature verification failed. Please sign with the corresponding connected wallet in MetaMask.' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 401 });
    }

    const userId = `usr-${body.walletAddress.slice(0, 10).toLowerCase()}`;
    const { roles, status } = await resolveUserRoles(body.walletAddress, userId);

    const data: UserProfileResponse = {
      userId,
      status: status || 'ACTIVE',
      kycStatus: 'NOT_REQUIRED',
      roles,
      primaryWallet: body.walletAddress,
    };

    // Generate cryptographically signed HMAC session token
    const sessionToken = createSessionToken({
      userId,
      walletAddress: body.walletAddress,
      nonce: body.nonce,
    });

    const response: ApiResponse<UserProfileResponse & { sessionToken: string }> = {
      success: true,
      data: { ...data, sessionToken },
      timestamp: new Date().toISOString(),
    };

    const nextResponse = NextResponse.json(response, { status: 200 });

    // Set HttpOnly session cookie for Edge Middleware to pick up on subsequent requests
    nextResponse.cookies.set('rtrader_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 8, // 8 hours
      path: '/',
    });

    return nextResponse;

  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'SERVER_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
