import { NextRequest, NextResponse } from 'next/server';
import { TradingRiskGate } from '@packages/trading/risk-gate';
import { rateLimiter } from '@packages/auth/rate-limiter';
import { ApiResponse, CreateTradeIntentRequest } from '@packages/shared/contracts/api-contracts';
import { TradeIntentInput, UserRiskLimits } from '@packages/shared/types/domain';
import { requireCapability } from '@packages/auth/session';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';

    // Rate Limiting (Non-blocking fallback)
    const rateCheck = await rateLimiter.checkRateLimit(`ratelimit:trade:${ip}`, 30, 60);
    if (!rateCheck.allowed) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: 'TOO_MANY_REQUESTS', message: 'Trade intent creation rate limit exceeded.' },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(response, { status: 429 });
    }

    // Require TRADE_MANUALLY capability
    const auth = await requireCapability(req, 'TRADE_MANUALLY');

    const body = (await req.json()) as CreateTradeIntentRequest;
    
    const intent: TradeIntentInput = {
      userId: auth.user.userId,
      stage: body.stage || 'PAPER',
      symbol: body.symbol || 'DEGEN/USDT',
      side: body.side || 'BUY',
      type: body.type || 'MARKET',
      quantity: body.quantity || 1.0,
      price: body.price,
      maxSlippagePct: body.maxSlippagePct || 1.0,
      idempotencyKey: `intent-${Date.now()}`,
    };

    const userLimits: UserRiskLimits = {
      maxOrderValueUsd: 10000,
      maxDailyLossUsd: 1000,
      currentDailyLossUsd: 0,
      maxOpenPositions: 5,
      currentOpenPositions: 0,
    };

    const { status, decision } = TradingRiskGate.evaluateIntent(
      intent,
      userLimits,
      { planId: 'TRADER', hasLiveTrading: true },
      []
    );

    const data = {
      tradeIntentId: intent.idempotencyKey,
      status,
      decision,
    };

    const response: ApiResponse<typeof data> = {
      success: decision.isApproved,
      data,
      error: decision.isApproved ? undefined : { code: 'RISK_REJECTED', message: decision.reason || 'Risk check failed' },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: decision.isApproved ? 200 : 400 });
  } catch (err: any) {
    const message = err?.message || 'Trade intent creation failed';
    if (message.includes('DATABASE_UNAVAILABLE')) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message }, timestamp: new Date().toISOString() },
        { status: 503 }
      );
    }
    if (message.startsWith('RBAC_FORBIDDEN') || message.startsWith('AUTH_ACCOUNT_')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message }, timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }
    if (message.startsWith('UNAUTHORIZED')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message }, timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'SERVER_ERROR', message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
