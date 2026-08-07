// ============================================================================
// STRATEGY BACKTESTER — RSI + Price Action Strategy with Real Sharpe Ratio
// ============================================================================
// Phase E: Real RSI computation (replaces mock price-action-only signal)
// Phase F: fetchHistoricalCandles() via Binance REST API (no new dependency)
// ============================================================================

export interface PriceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestConfig {
  symbol: string;
  initialCapitalUsd: number;
  candles: PriceCandle[];
  strategyParams: {
    rsiPeriod?: number;
    buyRsiThreshold?: number;    // Default 30 (oversold)
    sellRsiThreshold?: number;   // Default 70 (overbought)
    stopLossPct?: number;
    takeProfitPct?: number;
  };
}

export interface BacktestResult {
  symbol: string;
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  winRatePct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  executedAt: string;
}

// ---------------------------------------------------------------------------
// Binance Kline interval type for REST API
// ---------------------------------------------------------------------------
export type BinanceKlineInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

// ---------------------------------------------------------------------------
// Internal: Binance Klines API response row
// [openTime, open, high, low, close, volume, closeTime, ...]
// ---------------------------------------------------------------------------
type BinanceKlineRow = [number, string, string, string, string, string, ...unknown[]];

export class StrategyBacktester {

  // -------------------------------------------------------------------------
  // Phase F: Historical OHLCV Ingestion from Binance REST API
  // -------------------------------------------------------------------------

  /**
   * Fetch historical OHLCV candles dari Binance REST API.
   * Tidak ada dependency baru — menggunakan native global fetch (Node 18+).
   *
   * @param symbol    e.g. 'BTCUSDT'
   * @param interval  e.g. '1h', '4h', '1d'
   * @param limit     Max 1000 candles (Binance REST limit)
   */
  static async fetchHistoricalCandles(
    symbol: string,
    interval: BinanceKlineInterval = '1h',
    limit: number = 200,
    isTestnet: boolean = false
  ): Promise<PriceCandle[]> {
    const baseUrl = isTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';

    const url = `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[Backtester] Binance klines API returned ${res.status} for ${symbol} — returning empty array`);
        return [];
      }

      const rows = (await res.json()) as BinanceKlineRow[];

      return rows.map((row): PriceCandle => ({
        timestamp: row[0],
        open: parseFloat(row[1] as string),
        high: parseFloat(row[2] as string),
        low: parseFloat(row[3] as string),
        close: parseFloat(row[4] as string),
        volume: parseFloat(row[5] as string),
      }));
    } catch (err) {
      console.warn(`[Backtester] Failed to fetch historical candles for ${symbol}:`, (err as Error).message);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Phase E: Real RSI Calculation
  // -------------------------------------------------------------------------

  /**
   * Menghitung RSI (Relative Strength Index) Wilder's Smoothed Method.
   * Returns array RSI values — index i corresponds to candles[i].
   * Nilai RSI tersedia mulai dari index = rsiPeriod.
   * Sebelum itu array diisi NaN.
   */
  static computeRsi(closes: number[], period: number = 14): number[] {
    if (closes.length < period + 1) {
      return new Array(closes.length).fill(NaN);
    }

    const rsi: number[] = new Array(closes.length).fill(NaN);

    // 1. First window: simple average of gains and losses
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    const firstRs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs);

    // 2. Wilder's Smoothed Moving Average for the rest
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    }

    return rsi;
  }

  // -------------------------------------------------------------------------
  // Real Sharpe Ratio from returns distribution
  // -------------------------------------------------------------------------

  /**
   * Hitung Sharpe Ratio dari array ekuitas harian/periodik.
   * riskFreeRate: annualized rate (default 0.05 = 5% p.a.)
   * periodsPerYear: 252 untuk daily, 8760 untuk hourly, 365 untuk daily crypto
   */
  static computeSharpe(
    equityHistory: number[],
    riskFreeRate: number = 0.05,
    periodsPerYear: number = 365
  ): number {
    if (equityHistory.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < equityHistory.length; i++) {
      returns.push((equityHistory[i] - equityHistory[i - 1]) / equityHistory[i - 1]);
    }

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    const periodicRiskFree = riskFreeRate / periodsPerYear;
    const sharpe = ((meanReturn - periodicRiskFree) / stdDev) * Math.sqrt(periodsPerYear);
    return Math.round(sharpe * 100) / 100;
  }

  // -------------------------------------------------------------------------
  // Phase E: Full RSI-Driven Backtest Engine
  // -------------------------------------------------------------------------

  /**
   * Pipeline Simulasi Backtest Historis — RSI Strategy + Real Sharpe Ratio.
   *
   * Strategy Logic:
   *   BUY  when RSI crosses below buyRsiThreshold (default 30 — oversold)
   *   SELL when RSI crosses above sellRsiThreshold (default 70 — overbought)
   *        OR when Stop Loss / Take Profit is triggered
   *
   * Backward-compatible: signature identical to original runBacktest().
   */
  static runBacktest(config: BacktestConfig): BacktestResult {
    const rsiPeriod        = config.strategyParams.rsiPeriod        ?? 14;
    const buyRsiThreshold  = config.strategyParams.buyRsiThreshold  ?? 30;
    const sellRsiThreshold = config.strategyParams.sellRsiThreshold ?? 70;
    const stopLossPct      = config.strategyParams.stopLossPct      ?? 0.03;
    const takeProfitPct    = config.strategyParams.takeProfitPct    ?? 0.06;

    const candles = config.candles;
    if (candles.length < rsiPeriod + 2) {
      // Not enough candles to compute RSI — return zero-trade result
      return {
        symbol: config.symbol,
        initialCapital: config.initialCapitalUsd,
        finalEquity: config.initialCapitalUsd,
        totalReturnPct: 0,
        totalTrades: 0,
        winningTrades: 0,
        winRatePct: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        executedAt: new Date().toISOString(),
      };
    }

    // Pre-compute RSI for all candles
    const closes = candles.map(c => c.close);
    const rsiValues = StrategyBacktester.computeRsi(closes, rsiPeriod);

    let equity = config.initialCapitalUsd;
    let peakEquity = equity;
    let maxDrawdown = 0;
    let totalTrades = 0;
    let winningTrades = 0;
    let inPosition = false;
    let entryPrice = 0;
    const equityHistory: number[] = [equity];

    for (let i = rsiPeriod + 1; i < candles.length; i++) {
      const candle  = candles[i];
      const prevRsi = rsiValues[i - 1];
      const currRsi = rsiValues[i];

      // Update Drawdown tracking
      if (equity > peakEquity) peakEquity = equity;
      const drawdown = (peakEquity - equity) / peakEquity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      if (!inPosition) {
        // BUY SIGNAL: RSI crosses below buyRsiThreshold (oversold bounce entry)
        if (!isNaN(prevRsi) && !isNaN(currRsi) && prevRsi >= buyRsiThreshold && currRsi < buyRsiThreshold) {
          inPosition = true;
          entryPrice = candle.close;
          totalTrades++;
        }
      } else {
        const pnlPct = (candle.close - entryPrice) / entryPrice;

        // EXIT CONDITIONS (priority order):
        // 1. Stop Loss
        // 2. Take Profit
        // 3. RSI crosses above sellRsiThreshold (overbought — take profit signal)
        const rsiSellSignal = !isNaN(prevRsi) && !isNaN(currRsi) && prevRsi <= sellRsiThreshold && currRsi > sellRsiThreshold;

        if (pnlPct <= -stopLossPct || pnlPct >= takeProfitPct || rsiSellSignal) {
          inPosition = false;
          const tradePnL = equity * pnlPct;
          equity += tradePnL;
          equityHistory.push(equity);

          if (pnlPct > 0) winningTrades++;
        }
      }
    }

    // Close any open position at last candle
    if (inPosition && candles.length > 0) {
      const lastClose = candles[candles.length - 1].close;
      const pnlPct = (lastClose - entryPrice) / entryPrice;
      equity += equity * pnlPct;
      equityHistory.push(equity);
      if (pnlPct > 0) winningTrades++;
    }

    const totalReturnPct = ((equity - config.initialCapitalUsd) / config.initialCapitalUsd) * 100;
    const winRatePct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // Real Sharpe Ratio from equity curve
    const sharpeRatio = StrategyBacktester.computeSharpe(equityHistory, 0.05, 365);

    return {
      symbol: config.symbol,
      initialCapital: config.initialCapitalUsd,
      finalEquity: Math.round(equity * 100) / 100,
      totalReturnPct: Math.round(totalReturnPct * 100) / 100,
      totalTrades,
      winningTrades,
      winRatePct: Math.round(winRatePct * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdown * 10000) / 100,
      sharpeRatio,
      executedAt: new Date().toISOString(),
    };
  }
}

