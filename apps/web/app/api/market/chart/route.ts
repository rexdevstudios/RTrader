import { NextRequest, NextResponse } from 'next/server';
import { StrategyBacktester, BinanceKlineInterval } from '../../../../../../packages/agent/backtester';
import { intelligenceCache, OrderbookSnapshot } from '../../../../../../packages/intelligence/market-data-cache';
import { FeatureEngine } from '../../../../../../packages/intelligence/feature-engine';
import { ApiResponse } from '../../../../../../packages/shared/contracts/api-contracts';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const interval = (searchParams.get('interval') || '1h') as BinanceKlineInterval;

    // 1. Fetch Historical OHLCV (Fallback gracefully to empty if offline)
    let candles = await StrategyBacktester.fetchHistoricalCandles(symbol, interval, 30);
    
    // Fallback mock candles if Binance REST is unreachable
    if (candles.length === 0) {
      const now = Date.now();
      const basePrice = symbol.includes('BTC') ? 64000 : symbol.includes('ETH') ? 3400 : 1.25;
      candles = Array.from({ length: 30 }, (_, i) => {
        const time = now - (30 - i) * 3600 * 1000;
        const variation = (Math.sin(i) * 0.02 + Math.cos(i * 0.5) * 0.01) * basePrice;
        const open = basePrice + variation;
        const close = open + (i % 2 === 0 ? 0.008 : -0.006) * basePrice;
        const high = Math.max(open, close) + 0.005 * basePrice;
        const low = Math.min(open, close) - 0.005 * basePrice;
        const volume = Math.round(1000 + Math.sin(i * 3) * 400);
        return { timestamp: time, open, high, low, close, volume };
      });
    }

    // 2. Read Orderbook Snapshot from Cache (Fallback default if cold)
    let orderbook = intelligenceCache.getOrderbook(symbol);
    if (!orderbook) {
      const lastClose = candles[candles.length - 1].close;
      const bestBid = Math.round((lastClose * 0.9995) * 100) / 100;
      const bestAsk = Math.round((lastClose * 1.0005) * 100) / 100;
      orderbook = {
        symbol,
        timestamp: Date.now(),
        bids: [
          [bestBid, 1.5],
          [bestBid * 0.998, 4.2],
          [bestBid * 0.995, 12.8], // Whale wall bid
        ],
        asks: [
          [bestAsk, 1.2],
          [bestAsk * 1.002, 3.8],
          [bestAsk * 1.005, 15.0], // Whale wall ask
        ],
        bestBid,
        bestAsk,
        spread: Math.round((bestAsk - bestBid) * 100) / 100,
        spreadPct: Math.round(((bestAsk - bestBid) / bestBid) * 10000) / 100,
      };
    }

    // 3. Compute Intelligence Signal
    const signal = FeatureEngine.computeSignal(symbol, intelligenceCache, null, null);

    const data = {
      symbol,
      interval,
      candles,
      orderbook,
      signal,
    };

    const response: ApiResponse<typeof data> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'CHART_DATA_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
