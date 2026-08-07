import { NextRequest, NextResponse } from 'next/server';
import { SiweAuthService } from '../../../../../../packages/auth/siwe';
import { ApiResponse, WalletVerifyRequest, UserProfileResponse } from '../../../../../../packages/shared/contracts/api-contracts';


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

    const statement = `SIWE Authentication for rtrader.io\nNonce: ${body.nonce}\nURI: https://rtrader.io/auth/login`;
    const isValid = SiweAuthService.verifySignature(statement, body.signature, body.walletAddress);

    if (!isValid) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'SIWE signature verification failed' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 401 });
    }

    const data: UserProfileResponse = {
      userId: `usr-${body.walletAddress.slice(0, 10).toLowerCase()}`,
      status: 'ACTIVE',
      kycStatus: 'NOT_REQUIRED',
      roles: ['TRADER'],
      primaryWallet: body.walletAddress,
    };

    const response: ApiResponse<UserProfileResponse> = {
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
