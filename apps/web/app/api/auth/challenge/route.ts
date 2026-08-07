import { NextRequest, NextResponse } from 'next/server';
import { SiweAuthService } from '../../../../../../packages/auth/siwe';
import { rateLimiter } from '../../../../../../packages/auth/rate-limiter';
import { ApiResponse, WalletChallengeRequest, WalletChallengeResponse } from '../../../../../../packages/shared/contracts/api-contracts';


export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';
    
    // Rate Limiting (Non-blocking, fail-open fallback)
    const rateCheck = await rateLimiter.checkRateLimit(`ratelimit:auth:challenge:${ip}`, 10, 60);
    if (!rateCheck.allowed) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded for challenge requests. Please try again later.' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 429 });
    }

    const body = (await req.json()) as WalletChallengeRequest;
    if (!body.walletAddress) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'walletAddress is required' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const challengeResult = SiweAuthService.generateChallenge(
      'rtrader.io',
      body.walletAddress,
      'https://rtrader.io/auth/login',
      8453 // Base Chain ID
    );

    const data: WalletChallengeResponse = {
      nonce: challengeResult.challenge.nonce,
      messageToSign: challengeResult.messageText,
      expiresAt: challengeResult.challenge.expirationTime,
    };


    const response: ApiResponse<WalletChallengeResponse> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'SERVER_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
