// ============================================================================
// DEFILLAMA MACRO CLIENT — Free Out-of-Band Protocol TVL & Volume Data
// ============================================================================
//
// INVARIANT (MASTER_PROMPT.md & SSOT.md):
//   - DefiLlama data is OUT-OF-BAND & NON-BLOCKING enrichment ONLY.
//   - Zero API key required. Public free REST endpoints.
//   - All HTTP calls wrapped in try/catch — failure returns safe null fallback.
//   - NEVER called inside critical execution path (Risk Gate, Order Worker).
//   - Returned data is informational/macro context ONLY — not source of truth.
//
// Endpoints used:
//   GET https://api.llama.fi/v2/chains           → per-chain TVL
//   GET https://api.llama.fi/coins/prices/current → token prices (fallback)
// ============================================================================

export interface ChainTvlSnapshot {
  chainName: string;
  tvlUsd: number;
  change24hPct: number | null;
  fetchedAt: string;
}

export interface DefiLlamaMacroSignal {
  topChains: ChainTvlSnapshot[];
  totalDefiTvlUsd: number;
  macroSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNAVAILABLE';
  fetchedAt: string;
}

const DEFILLAMA_BASE = 'https://api.llama.fi';
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch per-chain TVL snapshot from DefiLlama.
 * Returns null on any network error — caller should treat null as UNAVAILABLE.
 */
async function fetchChainsTvl(): Promise<ChainTvlSnapshot[] | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${DEFILLAMA_BASE}/v2/chains`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[DefiLlama] /v2/chains returned HTTP ${res.status}`);
      return null;
    }

    const data = await res.json() as Array<{
      name: string;
      tvl: number;
      change_1d: number | null;
    }>;

    if (!Array.isArray(data)) return null;

    // Sort by TVL descending, take top 10 chains
    const sorted = data
      .filter((c) => c && typeof c.tvl === 'number' && c.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 10);

    return sorted.map((chain) => ({
      chainName: chain.name,
      tvlUsd: Math.round(chain.tvl),
      change24hPct: chain.change_1d !== null ? Math.round(chain.change_1d * 100) / 100 : null,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (err) {
    const message = (err as Error).message || 'unknown';
    if (message.includes('abort') || message.includes('timeout')) {
      console.warn('[DefiLlama] Request timed out after 5s — safe fallback activated');
    } else {
      console.warn('[DefiLlama] fetchChainsTvl error — safe fallback activated:', message);
    }
    return null;
  }
}

/**
 * Compute macro sentiment from TVL change data.
 * Simple heuristic: if majority of top chains are green (24h > 0), BULLISH.
 */
function computeMacroSentiment(chains: ChainTvlSnapshot[]): DefiLlamaMacroSignal['macroSentiment'] {
  const chainsWithChange = chains.filter((c) => c.change24hPct !== null);
  if (chainsWithChange.length === 0) return 'NEUTRAL';

  const bullishCount = chainsWithChange.filter((c) => (c.change24hPct ?? 0) > 0.5).length;
  const bearishCount = chainsWithChange.filter((c) => (c.change24hPct ?? 0) < -0.5).length;

  const bullishRatio = bullishCount / chainsWithChange.length;
  const bearishRatio = bearishCount / chainsWithChange.length;

  if (bullishRatio > 0.6) return 'BULLISH';
  if (bearishRatio > 0.6) return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Primary export: fetch and compute DefiLlama macro signal.
 * Always returns a DefiLlamaMacroSignal — never throws.
 * Returns 'UNAVAILABLE' sentiment on any failure.
 */
export async function fetchDefiLlamaMacroSignal(): Promise<DefiLlamaMacroSignal> {
  const chains = await fetchChainsTvl();

  if (!chains || chains.length === 0) {
    return {
      topChains: [],
      totalDefiTvlUsd: 0,
      macroSentiment: 'UNAVAILABLE',
      fetchedAt: new Date().toISOString(),
    };
  }

  const totalDefiTvlUsd = chains.reduce((sum, c) => sum + c.tvlUsd, 0);
  const macroSentiment = computeMacroSentiment(chains);

  return {
    topChains: chains,
    totalDefiTvlUsd,
    macroSentiment,
    fetchedAt: new Date().toISOString(),
  };
}
