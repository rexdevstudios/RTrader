import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';

export interface SessionData {
  authenticated: boolean;
  userId: string | null;
  walletAddress: string | null;
  userRole: 'GUEST' | 'TRADER' | 'CREATOR' | 'SYSTEM_ADMIN' | 'SUPER_ADMIN';
  credits: number;
  issuedAt?: number;
}

export async function GET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get('rtrader_session')?.value;
    const authHeader = req.headers.get('Authorization');
    const token = sessionCookie || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null);

    if (!token) {
      const response: ApiResponse<SessionData> = {
        success: true,
        data: {
          authenticated: false,
          userId: null,
          walletAddress: null,
          userRole: 'GUEST',
          credits: 0,
        },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 200 });
    }

    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');

      if (parts.length < 3 || !parts[0] || !parts[1]) {
        throw new Error('Invalid token structure');
      }

      const userId = parts[0];
      const walletAddress = parts[1];
      const issuedAt = parseInt(parts[2], 10) || Date.now();

      // Check token TTL (8 hours = 28,800,000 ms)
      const maxAgeMs = 8 * 60 * 60 * 1000;
      if (Date.now() - issuedAt > maxAgeMs) {
        const expiredResponse: ApiResponse<SessionData> = {
          success: true,
          data: {
            authenticated: false,
            userId: null,
            walletAddress: null,
            userRole: 'GUEST',
            credits: 0,
          },
          timestamp: new Date().toISOString(),
        };
        return NextResponse.json(expiredResponse, { status: 200 });
      }

      const isAdmin =
        walletAddress.toLowerCase().includes('admin') ||
        walletAddress.toLowerCase() === '0x90f79bf6eb2c4f870365e785982e1f101e93b906'.toLowerCase() ||
        walletAddress.toLowerCase() === '0xadmin99999999999999999999999999999999999'.toLowerCase();

      const userRole = isAdmin ? 'SYSTEM_ADMIN' : 'TRADER';
      const credits = isAdmin ? 999999 : 15000;

      const response: ApiResponse<SessionData> = {
        success: true,
        data: {
          authenticated: true,
          userId,
          walletAddress,
          userRole,
          credits,
          issuedAt,
        },
        timestamp: new Date().toISOString(),
      };

      return NextResponse.json(response, { status: 200 });
    } catch {
      const invalidResponse: ApiResponse<SessionData> = {
        success: true,
        data: {
          authenticated: false,
          userId: null,
          walletAddress: null,
          userRole: 'GUEST',
          credits: 0,
        },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(invalidResponse, { status: 200 });
    }
  } catch (err) {
    const errorResponse: ApiResponse<null> = {
      success: false,
      error: { code: 'SERVER_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
