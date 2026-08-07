import { NextRequest, NextResponse } from 'next/server';
import { TradingRiskGate } from '@packages/trading/risk-gate';
import { rateLimiter } from '@packages/auth/rate-limiter';
import { ApiResponse, CreateTradeIntentRequest } from '@packages/shared/contracts/api-contracts';
import { TradeIntentInput, UserRiskLimits } from '@packages/shared/types/domain';



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

    const body = (await req.json()) as CreateTradeIntentRequest & { userId?: string };
    
    const intent: TradeIntentInput = {
      userId: body.userId || 'usr-anonymous',
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
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'SERVER_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
