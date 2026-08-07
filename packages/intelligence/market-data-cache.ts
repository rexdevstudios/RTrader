// ============================================================================
// INTELLIGENCE CACHE — In-Memory TTL Store for Orderbook & OHLCV Data
// ============================================================================
//
// INVARIANT (MASTER_PROMPT.md §Core Path Protection):
//   - Modul ini adalah OUT-OF-BAND async store. Tidak pernah diimport langsung
//     di critical live execution path (RBAC → Risk Gate → Order Worker).
//   - Kegagalan pengisian cache tidak boleh memblok order execution.
//   - Cache diisi oleh BinanceStreamListener extension (P2 worker).
//
// ============================================================================

export interface OhlcvCandle {
  symbol: string;
  openTime: number;     // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
}

export interface OrderbookSnapshot {
  symbol: string;
  timestamp: number;    // Unix ms
  bids: [number, number][]; // [price, qty][]
  asks: [number, number][]; // [price, qty][]
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
}

export interface IntelligenceCacheEntry<T> {
  data: T;
  cachedAt: number;   // Unix ms
  ttlMs: number;
}

export class IntelligenceCache {
  private ohlcv: Map<string, IntelligenceCacheEntry<OhlcvCandle[]>> = new Map();
  private orderbook: Map<string, IntelligenceCacheEntry<OrderbookSnapshot>> = new Map();

  private static readonly OHLCV_TTL_MS   = 60_000;       // 1 minute
  private static readonly ORDERBOOK_TTL_MS = 10_000;     // 10 seconds

  // -------------------------------------------------------------------------
  // OHLCV Candle Cache
  // -------------------------------------------------------------------------

  /**
   * Update candle cache untuk sebuah symbol + interval.
   * Dipanggil oleh BinanceStreamListener ketika menerima kline WS event.
   */
  setOhlcv(symbol: string, interval: OhlcvCandle['interval'], candles: OhlcvCandle[]): void {
    const key = `${symbol}:${interval}`;
    this.ohlcv.set(key, {
      data: candles,
      cachedAt: Date.now(),
      ttlMs: IntelligenceCache.OHLCV_TTL_MS,
    });
  }

  /**
   * Ambil candle terbaru. Returns null jika expired atau tidak ada data.
   */
  getOhlcv(symbol: string, interval: OhlcvCandle['interval']): OhlcvCandle[] | null {
    const key = `${symbol}:${interval}`;
    const entry = this.ohlcv.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.ohlcv.delete(key);
      return null;
    }
    return entry.data;
  }

  // -------------------------------------------------------------------------
  // Orderbook Snapshot Cache
  // -------------------------------------------------------------------------

  /**
   * Update orderbook snapshot untuk sebuah symbol.
   * Dipanggil oleh BinanceStreamListener ketika menerima bookTicker WS event.
   */
  setOrderbook(symbol: string, snapshot: OrderbookSnapshot): void {
    this.orderbook.set(symbol, {
      data: snapshot,
      cachedAt: Date.now(),
      ttlMs: IntelligenceCache.ORDERBOOK_TTL_MS,
    });
  }

  /**
   * Ambil orderbook snapshot terbaru. Returns null jika expired.
   */
  getOrderbook(symbol: string): OrderbookSnapshot | null {
    const entry = this.orderbook.get(symbol);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.orderbook.delete(symbol);
      return null;
    }
    return entry.data;
  }

  // -------------------------------------------------------------------------
  // Derived Metrics
  // -------------------------------------------------------------------------

  /**
   * Hitung volatility sederhana (High-Low range % dari Close) untuk symbol.
   * Returns null jika tidak ada candle tersedia.
   */
  computeVolatilityPct(symbol: string, interval: OhlcvCandle['interval'] = '1m'): number | null {
    const candles = this.getOhlcv(symbol, interval);
    if (!candles || candles.length < 2) return null;
    const recent = candles.slice(-10); // last 10 candles
    const avgRange = recent.reduce((sum, c) => sum + (c.high - c.low) / c.close, 0) / recent.length;
    return Math.round(avgRange * 10000) / 100; // as percentage, 2dp
  }

  /**
   * Cek apakah volume candle terbaru secara signifikan lebih tinggi dari rata-rata.
   * Returns true jika volume spike > 2x average.
   */
  isVolumeSpike(symbol: string, interval: OhlcvCandle['interval'] = '1m'): boolean {
    const candles = this.getOhlcv(symbol, interval);
    if (!candles || candles.length < 5) return false;
    const lastCandle = candles[candles.length - 1];
    const prevCandles = candles.slice(-6, -1);
    const avgVolume = prevCandles.reduce((sum, c) => sum + c.volume, 0) / prevCandles.length;
    return lastCandle.volume > avgVolume * 2;
  }

  /**
   * Cache size stats untuk observability.
   */
  getStats(): { ohlcvEntries: number; orderbookEntries: number } {
    return {
      ohlcvEntries: this.ohlcv.size,
      orderbookEntries: this.orderbook.size,
    };
  }

  /**
   * Bersihkan seluruh cache expired. Dipanggil secara periodik oleh worker.
   */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.ohlcv) {
      if (now - entry.cachedAt > entry.ttlMs) this.ohlcv.delete(key);
    }
    for (const [key, entry] of this.orderbook) {
      if (now - entry.cachedAt > entry.ttlMs) this.orderbook.delete(key);
    }
  }
}

// Singleton instance — shared across workers in same process
export const intelligenceCache = new IntelligenceCache();
