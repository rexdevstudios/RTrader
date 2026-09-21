import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { authenticateSession } from '@packages/auth/session';

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
    const session = await authenticateSession(req);

    if (!session) {
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

    const roles = session.user.roles;
    let userRole: SessionData['userRole'] = 'TRADER';
    if (roles.includes('SUPER_ADMIN')) {
      userRole = 'SUPER_ADMIN';
    } else if (roles.includes('SYSTEM_ADMIN')) {
      userRole = 'SYSTEM_ADMIN';
    } else if (roles.includes('CREATOR')) {
      userRole = 'CREATOR';
    }

    const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'SYSTEM_ADMIN';
    const credits = isAdmin ? 999999 : 15000;

    const response: ApiResponse<SessionData> = {
      success: true,
      data: {
        authenticated: true,
        userId: session.user.userId,
        walletAddress: session.walletAddress,
        userRole,
        credits,
        issuedAt: session.issuedAt,
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const isDbUnavailable = (err as Error).message?.includes('DATABASE_UNAVAILABLE');
    const errorResponse: ApiResponse<null> = {
      success: false,
      error: {
        code: isDbUnavailable ? 'SERVICE_UNAVAILABLE' : 'SERVER_ERROR',
        message: (err as Error).message,
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(errorResponse, { status: isDbUnavailable ? 503 : 500 });
  }
}
