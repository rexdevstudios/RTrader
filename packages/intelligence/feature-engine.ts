// ============================================================================
// FEATURE ENGINE — Intelligence Signal Aggregator
// ============================================================================
//
// Mengagregasi sinyal dari tiga sumber data out-of-band:
//   1. Firecrawl → scraped_documents (web sentiment)
//   2. Arkham    → arkham_intelligence_profiles (counterparty risk)
//   3. Binance   → IntelligenceCache (orderbook / OHLCV)
//
// Output: IntelligenceSignal — computed confidence score + rationale
//   yang dapat digunakan oleh AgentProposalEngine.
//
// INVARIANT (MASTER_PROMPT.md §Core Path Protection):
//   Feature engine TIDAK pernah dipanggil di dalam synchronous risk gate path.
//   Semua input bersifat pre-fetched / cached. Tidak ada blocking I/O di sini.
//
// ============================================================================

import { ArkhamCounterpartyProfile } from '../shared/types/domain';
import { IntelligenceCache, OhlcvCandle } from './market-data-cache';
import { DefiLlamaMacroSignal } from './defillama-client';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface FirecrawlSignal {
  domain: string;
  markdownLength: number;            // Proxy untuk konten tersedia
  extractedMetadata: Record<string, unknown>;
  scrapedAt: string;
}

export interface MarketContextSignal {
  symbol: string;
  volatilityPct: number | null;
  isVolumeSpike: boolean;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadPct: number | null;
}

// ---------------------------------------------------------------------------
// Output Type
// ---------------------------------------------------------------------------

export interface IntelligenceSignal {
  symbol: string;
  computedConfidenceScore: number;   // 0.0 – 1.0
  rationale: string;
  riskFlags: string[];
  inputs: {
    webSentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNAVAILABLE';
    counterpartyRisk: 'CLEAR' | 'CAUTION' | 'BLOCKED' | 'UNKNOWN';
    marketVolatility: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
    volumeAnomaly: boolean;
    macroSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNAVAILABLE'; // DefiLlama TVL signal
  };
  macroContext?: {
    totalDefiTvlUsd: number;
    topChain: string;
    topChainTvlUsd: number;
  };
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Feature Engine
// ---------------------------------------------------------------------------

export class FeatureEngine {
  /**
   * Kompute IntelligenceSignal dari semua sumber data yang tersedia.
   *
   * Semua parameter bersifat optional — engine degrads gracefully jika
   * sumber data tertentu tidak tersedia (fault-tolerant by design).
   */
  static computeSignal(
    symbol: string,
    cache: IntelligenceCache,
    counterpartyProfile?: ArkhamCounterpartyProfile | null,
    firecrawlSignal?: FirecrawlSignal | null,
    macroSignal?: DefiLlamaMacroSignal | null,
  ): IntelligenceSignal {
    const riskFlags: string[] = [];
    const rationaleParts: string[] = [];
    let confidenceScore = 0.5; // neutral baseline

    // -----------------------------------------------------------------------
    // 1. Counterparty Risk (Arkham)
    // -----------------------------------------------------------------------
    let counterpartyRisk: IntelligenceSignal['inputs']['counterpartyRisk'] = 'UNKNOWN';

    if (counterpartyProfile) {
      if (counterpartyProfile.isCounterpartyBlocked) {
        counterpartyRisk = 'BLOCKED';
        riskFlags.push('COUNTERPARTY_BLOCKED');
        confidenceScore -= 0.4;
        rationaleParts.push(
          `Counterparty flagged BLOCKED by Arkham (${counterpartyProfile.arkhamEntityType}, score: ${counterpartyProfile.riskPassportScore}/100)`
        );
      } else if (counterpartyProfile.riskPassportScore < 50) {
        counterpartyRisk = 'CAUTION';
        riskFlags.push('LOW_ARKHAM_SCORE');
        confidenceScore -= 0.1;
        rationaleParts.push(`Counterparty Arkham score is low (${counterpartyProfile.riskPassportScore}/100 — caution)`);
      } else {
        counterpartyRisk = 'CLEAR';
        confidenceScore += 0.05;
        rationaleParts.push(`Counterparty cleared by Arkham (${counterpartyProfile.arkhamEntityType}, score: ${counterpartyProfile.riskPassportScore}/100)`);
      }
    } else {
      rationaleParts.push('Counterparty profile unavailable (Arkham enrichment pending)');
    }

    // -----------------------------------------------------------------------
    // 2. Market Context (IntelligenceCache — OHLCV + Orderbook)
    // -----------------------------------------------------------------------
    const volatilityPct = cache.computeVolatilityPct(symbol, '1m');
    const isVolumeSpike = cache.isVolumeSpike(symbol, '1m');
    const orderbookSnapshot = cache.getOrderbook(symbol);

    let marketVolatility: IntelligenceSignal['inputs']['marketVolatility'] = 'UNKNOWN';

    if (volatilityPct !== null) {
      if (volatilityPct > 5) {
        marketVolatility = 'HIGH';
        riskFlags.push('HIGH_VOLATILITY');
        confidenceScore -= 0.15;
        rationaleParts.push(`Market volatility HIGH (${volatilityPct}% avg range/close)`);
      } else if (volatilityPct > 2) {
        marketVolatility = 'MEDIUM';
        confidenceScore -= 0.05;
        rationaleParts.push(`Market volatility MEDIUM (${volatilityPct}%)`);
      } else {
        marketVolatility = 'LOW';
        confidenceScore += 0.05;
        rationaleParts.push(`Market volatility LOW (${volatilityPct}%) — favorable`);
      }
    } else {
      rationaleParts.push('Market volatility unknown (orderbook/OHLCV cache cold)');
    }

    if (isVolumeSpike) {
      riskFlags.push('VOLUME_SPIKE');
      confidenceScore -= 0.1;
      rationaleParts.push('Unusual volume spike detected (>2× average) — elevated risk');
    }

    if (orderbookSnapshot) {
      if (orderbookSnapshot.spreadPct > 1.0) {
        riskFlags.push('WIDE_SPREAD');
        confidenceScore -= 0.05;
        rationaleParts.push(`Spread wide (${orderbookSnapshot.spreadPct.toFixed(2)}%) — potential low liquidity`);
      } else {
        rationaleParts.push(`Spread normal (${orderbookSnapshot.spreadPct.toFixed(2)}%)`);
      }
    }

    // -----------------------------------------------------------------------
    // 3. Web Sentiment (Firecrawl)
    // -----------------------------------------------------------------------
    let webSentiment: IntelligenceSignal['inputs']['webSentiment'] = 'UNAVAILABLE';

    if (firecrawlSignal) {
      const meta = firecrawlSignal.extractedMetadata as { sentimentScore?: number };
      if (typeof meta.sentimentScore === 'number') {
        if (meta.sentimentScore >= 0.65) {
          webSentiment = 'POSITIVE';
          confidenceScore += 0.05;
          rationaleParts.push(`Web sentiment POSITIVE (score: ${meta.sentimentScore.toFixed(2)})`);
        } else if (meta.sentimentScore >= 0.4) {
          webSentiment = 'NEUTRAL';
          rationaleParts.push(`Web sentiment NEUTRAL (score: ${meta.sentimentScore.toFixed(2)})`);
        } else {
          webSentiment = 'NEGATIVE';
          riskFlags.push('NEGATIVE_WEB_SENTIMENT');
          confidenceScore -= 0.05;
          rationaleParts.push(`Web sentiment NEGATIVE (score: ${meta.sentimentScore.toFixed(2)})`);
        }
      } else if (firecrawlSignal.markdownLength > 200) {
        webSentiment = 'NEUTRAL';
        rationaleParts.push(`Web content available (${firecrawlSignal.markdownLength} chars markdown) — sentiment unscored`);
      } else {
        rationaleParts.push('Web content sparse or not yet scraped');
      }
    } else {
      rationaleParts.push('Web intelligence unavailable (Firecrawl not yet run for this target)');
    }

    // -----------------------------------------------------------------------
    // 4. Macro Context (DefiLlama — optional TVL & chain sentiment)
    // -----------------------------------------------------------------------
    let macroSentiment: IntelligenceSignal['inputs']['macroSentiment'] = 'UNAVAILABLE';
    let macroContext: IntelligenceSignal['macroContext'] | undefined;

    if (macroSignal && macroSignal.macroSentiment !== 'UNAVAILABLE') {
      macroSentiment = macroSignal.macroSentiment;
      if (macroSignal.macroSentiment === 'BULLISH') {
        confidenceScore += 0.05;
        rationaleParts.push(`Macro DeFi TVL sentiment BULLISH (Total TVL: $${(macroSignal.totalDefiTvlUsd / 1e9).toFixed(1)}B)`);
      } else if (macroSignal.macroSentiment === 'BEARISH') {
        confidenceScore -= 0.05;
        riskFlags.push('BEARISH_MACRO_TVL');
        rationaleParts.push(`Macro DeFi TVL sentiment BEARISH (Total TVL: $${(macroSignal.totalDefiTvlUsd / 1e9).toFixed(1)}B)`);
      } else {
        rationaleParts.push(`Macro DeFi TVL sentiment NEUTRAL (Total TVL: $${(macroSignal.totalDefiTvlUsd / 1e9).toFixed(1)}B)`);
      }

      if (macroSignal.topChains.length > 0) {
        const top = macroSignal.topChains[0];
        macroContext = {
          totalDefiTvlUsd: macroSignal.totalDefiTvlUsd,
          topChain: top.chainName,
          topChainTvlUsd: top.tvlUsd,
        };
      }
    } else {
      rationaleParts.push('Macro TVL context unavailable (DefiLlama offline or not fetched)');
    }

    // -----------------------------------------------------------------------
    // 5. Clamp confidence score to [0.0, 1.0]
    // -----------------------------------------------------------------------
    const finalScore = Math.max(0.0, Math.min(1.0, Math.round(confidenceScore * 100) / 100));

    return {
      symbol,
      computedConfidenceScore: finalScore,
      rationale: rationaleParts.join(' | '),
      riskFlags,
      inputs: {
        webSentiment,
        counterpartyRisk,
        marketVolatility,
        volumeAnomaly: isVolumeSpike,
        macroSentiment,
      },
      macroContext,
      computedAt: new Date().toISOString(),
    };
  }
}
