/**
 * dex-cache.ts — In-Memory Micro-Cache for DexScreener Pricing & Liquidity Metrics.
 *
 * Responsibilities:
 *  - Caches DexScreener pricing/liquidity queries with configurable TTL (default 30s).
 *  - Enforces strict network timeout (default 3000ms) to prevent CLI dashboard freezes.
 *  - Batch fetches multiple tokens in single HTTP requests (up to 30 addresses per DexScreener spec).
 *  - Gracefully falls back to stale cache or empty metrics on network errors / rate limits.
 *  - Zero unhandled exceptions: non-blocking by contract.
 */
import axios from "axios";

export interface DexMetrics {
  priceUsd?: string;
  change24h?: number;
  volume24h?: number;
  liquidityUsd?: number;
  fdv?: number;
  dexId?: string;
  pairAddress?: string;
}

interface CacheEntry {
  metrics: DexMetrics;
  cachedAt: number;
}

const DEFAULT_TTL_MS = 30_000; // 30 seconds
const DEFAULT_TIMEOUT_MS = 3_000; // 3 seconds

// In-memory cache keyed by lowercase token contract address
const memoryCache = new Map<string, CacheEntry>();

let cacheHits = 0;
let cacheMisses = 0;

/**
 * Returns cache statistics for observability and testing.
 */
export function getDexCacheStats(): {
  size: number;
  hits: number;
  misses: number;
} {
  return {
    size: memoryCache.size,
    hits: cacheHits,
    misses: cacheMisses,
  };
}

/**
 * Clears the in-memory cache and resets counters.
 */
export function clearDexCache(): void {
  memoryCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Fetches DexScreener metrics for an array of token addresses with in-memory caching.
 * - Checks cache first: addresses with unexpired TTL (<30s) are returned immediately.
 * - Addresses missing or expired are batched into an HTTP request with strict 3000ms timeout.
 * - On failure/timeout, stale cache entries or safe fallbacks are returned.
 */
export async function fetchDexScreenerMetrics(
  tokenAddresses: string[],
  options?: {
    ttlMs?: number;
    timeoutMs?: number;
    bypassCache?: boolean;
  }
): Promise<Record<string, DexMetrics>> {
  const result: Record<string, DexMetrics> = {};
  if (!tokenAddresses || tokenAddresses.length === 0) return result;

  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bypass = options?.bypassCache ?? false;
  const now = Date.now();

  const missingOrExpired: string[] = [];

  for (const rawAddr of tokenAddresses) {
    if (!rawAddr || rawAddr.length < 20) continue;
    const addr = rawAddr.trim().toLowerCase();

    if (!bypass) {
      const entry = memoryCache.get(addr);
      if (entry && now - entry.cachedAt < ttl) {
        result[addr] = entry.metrics;
        cacheHits++;
        continue;
      }
    }

    cacheMisses++;
    missingOrExpired.push(addr);
  }

  // If all addresses were fulfilled from cache, return immediately
  if (missingOrExpired.length === 0) {
    return result;
  }

  // Fetch missing or expired in batches of up to 30
  const batches: string[][] = [];
  for (let i = 0; i < missingOrExpired.length; i += 30) {
    batches.push(missingOrExpired.slice(i, i + 30));
  }

  for (const batch of batches) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`;
      const res = await axios.get(url, {
        timeout,
        headers: { Accept: "application/json" },
        validateStatus: (s) => s === 200,
      });

      if (res.data && Array.isArray(res.data.pairs)) {
        for (const pair of res.data.pairs) {
          const baseAddr = pair.baseToken?.address?.toLowerCase();
          if (baseAddr && !result[baseAddr]) {
            const metrics: DexMetrics = {
              priceUsd: pair.priceUsd ? `$${Number(pair.priceUsd).toFixed(6)}` : "Pending",
              change24h: pair.priceChange?.h24 != null ? Number(pair.priceChange.h24) : undefined,
              volume24h: pair.volume?.h24 != null ? Number(pair.volume.h24) : undefined,
              liquidityUsd: pair.liquidity?.usd != null ? Number(pair.liquidity.usd) : undefined,
              fdv: pair.fdv != null ? Number(pair.fdv) : undefined,
              dexId: pair.dexId,
              pairAddress: pair.pairAddress,
            };

            result[baseAddr] = metrics;
            memoryCache.set(baseAddr, { metrics, cachedAt: Date.now() });
          }
        }
      }

      // Any batch address not found in DexScreener pairs: store empty entry to avoid spamming
      for (const addr of batch) {
        if (!result[addr]) {
          const emptyMetrics: DexMetrics = { priceUsd: "N/A" };
          result[addr] = emptyMetrics;
          memoryCache.set(addr, { metrics: emptyMetrics, cachedAt: Date.now() });
        }
      }
    } catch {
      // Graceful degradation: if network call fails, use stale cache if available
      for (const addr of batch) {
        const stale = memoryCache.get(addr);
        if (stale) {
          result[addr] = stale.metrics;
        } else if (!result[addr]) {
          result[addr] = { priceUsd: "Offline" };
        }
      }
    }
  }

  return result;
}
