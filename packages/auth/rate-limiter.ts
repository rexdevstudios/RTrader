// ============================================================================
// RATE LIMITER — Ephemeral Sliding-Window Rate Limiting Helper
// ============================================================================
//
// INVARIANT (MASTER_PROMPT.md & SSOT.md):
//   - Rate-limiting disimpannya di Ephemeral Redis Tier (bukan PostgreSQL SSOT).
//   - 100% FAULT-ISOLATED & NON-BLOCKING:
//     Jika Redis unconfigured, network timeout, atau error:
//     Fungsi SELALU mengembalikan `allowed: true` agar user request TIDAK terblokir
//     hanya karena masalah cache/sidecar.
// ============================================================================

import { UpstashRedisClient, upstashRedis } from '../shared/redis-client';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export class SlidingWindowRateLimiter {
  constructor(private client: UpstashRedisClient = upstashRedis) {}

  /**
   * Pengecekan Rate Limit untuk API endpoint (e.g. SIWE login, trade intent creation).
   *
   * @param key            Identitas unik request (e.g. `ratelimit:siwe:${ip}`)
   * @param maxRequests    Batas kuota request (e.g. 5)
   * @param windowSeconds  Durasi window dalam detik (e.g. 60)
   */
  async checkRateLimit(
    key: string,
    maxRequests: number = 10,
    windowSeconds: number = 60
  ): Promise<RateLimitResult> {
    if (!this.client.isConfigured()) {
      // Redis unconfigured: pass-through gracefully
      return { allowed: true, remaining: maxRequests, resetMs: 0 };
    }

    try {
      const current = await this.client.incr(key);

      if (current === null) {
        // Fallback jika fetch error
        return { allowed: true, remaining: maxRequests, resetMs: 0 };
      }

      // Key baru dibuat -> pasang TTL window
      if (current === 1) {
        await this.client.set(key, 1, windowSeconds);
      }

      const remaining = Math.max(0, maxRequests - current);
      const allowed = current <= maxRequests;

      if (!allowed) {
        console.warn(`[RateLimiter] Rate limit exceeded for key "${key}" (${current}/${maxRequests})`);
      }

      return {
        allowed,
        remaining,
        resetMs: windowSeconds * 1000,
      };
    } catch (err) {
      console.warn(`[RateLimiter] Safe fallback on checkRateLimit for key "${key}":`, (err as Error).message);
      return { allowed: true, remaining: maxRequests, resetMs: 0 };
    }
  }
}

// Export singleton instance
export const rateLimiter = new SlidingWindowRateLimiter();
