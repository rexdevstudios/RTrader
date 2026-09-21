import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import {
  fetchDexScreenerMetrics,
  clearDexCache,
  getDexCacheStats,
} from "../src/modules/fleet/dex-cache.ts";

describe("Fleet Health Dashboard DEX Micro-Cache (Phase 3 P2)", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clearDexCache();
    axiosGetSpy = spyOn(axios, "get");
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
    clearDexCache();
  });

  it("1. should fetch from network on initial cache miss and populate cache", async () => {
    const testCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        pairs: [
          {
            baseToken: { address: testCa },
            priceUsd: "0.001234",
            liquidity: { usd: 50000 },
            priceChange: { h24: 12.5 },
            volume: { h24: 100000 },
            fdv: 1234000,
            dexId: "uniswap",
            pairAddress: "0xpool123",
          },
        ],
      },
    });

    const statsBefore = getDexCacheStats();
    expect(statsBefore.size).toBe(0);

    const metrics = await fetchDexScreenerMetrics([testCa]);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(metrics[testCa]).toBeDefined();
    expect(metrics[testCa].priceUsd).toBe("$0.001234");
    expect(metrics[testCa].liquidityUsd).toBe(50000);

    const statsAfter = getDexCacheStats();
    expect(statsAfter.size).toBe(1);
    expect(statsAfter.misses).toBe(1);
  });

  it("2. should serve subsequent calls within TTL from cache without network request", async () => {
    const testCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        pairs: [
          {
            baseToken: { address: testCa },
            priceUsd: "0.001234",
            liquidity: { usd: 50000 },
          },
        ],
      },
    });

    // Call 1: Miss -> Network
    await fetchDexScreenerMetrics([testCa]);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);

    // Call 2: Hit -> Memory Cache (Zero Network I/O)
    const cachedMetrics = await fetchDexScreenerMetrics([testCa]);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1); // STILL 1!
    expect(cachedMetrics[testCa].priceUsd).toBe("$0.001234");

    const stats = getDexCacheStats();
    expect(stats.hits).toBe(1);
  });

  it("3. should respect bypassCache option to force network refresh", async () => {
    const testCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    axiosGetSpy
      .mockResolvedValueOnce({
        status: 200,
        data: {
          pairs: [{ baseToken: { address: testCa }, priceUsd: "0.001" }],
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          pairs: [{ baseToken: { address: testCa }, priceUsd: "0.002" }],
        },
      });

    await fetchDexScreenerMetrics([testCa]);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);

    const refreshed = await fetchDexScreenerMetrics([testCa], { bypassCache: true });
    expect(axiosGetSpy).toHaveBeenCalledTimes(2);
    expect(refreshed[testCa].priceUsd).toBe("$0.002000");
  });

  it("4. should re-fetch from network when TTL has expired", async () => {
    const testCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    axiosGetSpy
      .mockResolvedValueOnce({
        status: 200,
        data: { pairs: [{ baseToken: { address: testCa }, priceUsd: "0.001" }] },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { pairs: [{ baseToken: { address: testCa }, priceUsd: "0.003" }] },
      });

    // Fetch with very short TTL (10ms)
    await fetchDexScreenerMetrics([testCa], { ttlMs: 10 });
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 20));

    // Subsequent call after TTL must trigger network call
    const expiredResult = await fetchDexScreenerMetrics([testCa], { ttlMs: 10 });
    expect(axiosGetSpy).toHaveBeenCalledTimes(2);
    expect(expiredResult[testCa].priceUsd).toBe("$0.003000");
  });

  it("5. should fall back gracefully on network error or timeout without throwing", async () => {
    const testCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    axiosGetSpy.mockRejectedValueOnce(new Error("ETIMEDOUT: DexScreener down"));

    const result = await fetchDexScreenerMetrics([testCa]);
    expect(result).toBeDefined();
    expect(result[testCa]).toBeDefined();
    expect(result[testCa].priceUsd).toBe("Offline");
  });

  it("6. clearDexCache should completely reset cache state", async () => {
    const testCa = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: { pairs: [{ baseToken: { address: testCa }, priceUsd: "0.001" }] },
    });

    await fetchDexScreenerMetrics([testCa]);
    expect(getDexCacheStats().size).toBe(1);

    clearDexCache();
    expect(getDexCacheStats().size).toBe(0);
    expect(getDexCacheStats().hits).toBe(0);
    expect(getDexCacheStats().misses).toBe(0);
  });
});
