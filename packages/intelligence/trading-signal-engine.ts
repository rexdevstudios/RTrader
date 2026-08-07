// ============================================================================
// TRADING SIGNAL & ALERT ENGINE — Multi-Factor Market Intelligence Aggregator
// ============================================================================
//
// INVARIANT (MASTER_PROMPT.md §Core Path Protection):
//   - Modul ini adalah PRESENTATION LAYER untuk analisis dan alert saja.
//   - Tidak pernah digunakan dalam critical execution path (Risk Gate, Order Worker).
//   - Semua output adalah advisory/informational — bukan keputusan eksekusi.
//   - AI tetap PROPOSAL-ONLY. Risk Gate tetap final decision path.
//   - Seluruh sinyal bersifat computed dari data yang sudah tersedia (OHLCV, orderbook,
//     RSI, IntelligenceSignal, DefiLlama macro) — tidak ada I/O baru.
//
// Output utama:
//   - MarketRegime     : Deteksi kondisi pasar saat ini
//   - TradingAlert[]   : Daftar alert prioritas untuk ditampilkan ke trader
//   - StrategySignal[] : Proposal strategi berbasis kondisi pasar
//   - AlertSeverity    : LOW | MEDIUM | HIGH | CRITICAL
//
// ============================================================================

import { PriceCandle, StrategyBacktester } from '../agent/backtester';
import { IntelligenceSignal } from './feature-engine';
import { OrderbookSnapshot } from './market-data-cache';

// ---------------------------------------------------------------------------
// Market Regime — Deteksi kondisi pasar saat ini
// ---------------------------------------------------------------------------

export type MarketRegimeType =
  | 'TRENDING_UP'       // Price breakout + volume surge + bullish macro
  | 'TRENDING_DOWN'     // Consistent lower-lows + bearish macro
  | 'RANGE_BOUND'       // Price oscillating in defined support/resistance band
  | 'HIGH_VOLATILITY'   // Wide candle ranges + >3% daily swings
  | 'LOW_LIQUIDITY'     // Wide spread + thin orderbook depth
  | 'ACCUMULATION'      // Low volume drift + large buy walls building
  | 'DISTRIBUTION'      // Declining volume + large sell walls building
  | 'UNKNOWN';          // Insufficient data

export interface MarketRegime {
  regime: MarketRegimeType;
  confidence: number;      // 0.0 – 1.0
  description: string;
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Alert Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'INFO' | 'CAUTION' | 'WARNING' | 'CRITICAL';
export type AlertCategory =
  | 'RSI_SIGNAL'
  | 'ORDERBOOK_WALL'
  | 'VOLUME_SPIKE'
  | 'SPREAD_ANOMALY'
  | 'MACRO_SHIFT'
  | 'VOLATILITY'
  | 'COUNTERPARTY_RISK'
  | 'REGIME_CHANGE'
  | 'MEAN_REVERSION'
  | 'BREAKOUT';

export interface TradingAlert {
  alertId: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  actionableHint: string;     // What a trader should consider doing
  shouldPauseTrading: boolean;
  shouldRejectProposal: boolean;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Strategy Signal — AI-proposal-ready trading signal output
// ---------------------------------------------------------------------------

export type StrategySignalType =
  | 'RSI_OVERSOLD_BUY'       // RSI < 30 — potential mean-reversion long
  | 'RSI_OVERBOUGHT_SELL'    // RSI > 70 — potential mean-reversion short
  | 'BREAKOUT_LONG'          // Price breaks above resistance with volume
  | 'BREAKDOWN_SHORT'        // Price breaks below support with volume
  | 'WHALE_WALL_SUPPORT'     // Large bid wall detected — potential bounce zone
  | 'WHALE_WALL_RESISTANCE'  // Large ask wall detected — potential rejection zone
  | 'VOLUME_SURGE_FOLLOW'    // Volume spike + price direction continuation
  | 'MACRO_BULLISH_ENTRY'    // Bullish macro TVL + low volatility = favorable setup
  | 'MACRO_BEARISH_CAUTION'  // Bearish macro TVL = reduce position sizing
  | 'MEAN_REVERSION_LONG'    // Oversold + low volatility + tight spread
  | 'MEAN_REVERSION_SHORT'   // Overbought + low volatility + tight spread
  | 'HOLD_CASH'              // High volatility + bearish macro + COUNTERPARTY_BLOCKED
  | 'NO_CLEAR_SIGNAL';       // Insufficient data or conflicting signals

export interface StrategySignal {
  signalType: StrategySignalType;
  symbol: string;
  confidence: number;          // 0.0 – 1.0, maps to proposal confidenceScore
  rationale: string;
  suggestedAction: 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'WAIT';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedPositionSizePct: number;  // % of available capital (0-100)
  isProposalReady: boolean;    // Whether this can be immediately turned into AI proposal
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Full Analysis Output
// ---------------------------------------------------------------------------

export interface TradingAnalysis {
  symbol: string;
  regime: MarketRegime;
  alerts: TradingAlert[];
  strategySignals: StrategySignal[];
  rsiCurrent: number | null;
  rsiZone: 'OVERSOLD' | 'NEUTRAL' | 'OVERBOUGHT' | 'UNKNOWN';
  whaleWallBid: { price: number; qty: number } | null;
  whaleWallAsk: { price: number; qty: number } | null;
  spreadStatus: 'TIGHT' | 'NORMAL' | 'WIDE' | 'EXTREME';
  overallRiskScore: number;  // 0 (safe) – 100 (very risky)
  tradingPaused: boolean;
  analysedAt: string;
}

// ---------------------------------------------------------------------------
// Trading Signal Engine
// ---------------------------------------------------------------------------

const WHALE_WALL_THRESHOLD_BTC = 10.0;   // qty > 10 BTC at single price level = whale wall
const WHALE_WALL_THRESHOLD_ETH = 100.0;  // qty > 100 ETH
const WHALE_WALL_THRESHOLD_DEFAULT = 50000; // USD-equivalent notional fallback
const SPREAD_WIDE_PCT = 0.5;    // > 0.5% spread = wide
const SPREAD_EXTREME_PCT = 1.5; // > 1.5% spread = extreme / low liquidity

export class TradingSignalEngine {

  /**
   * Primary analysis entry point.
   * Aggregates all available signals into a TradingAnalysis report.
   * All inputs are optional — engine degrades gracefully on missing data.
   */
  static analyze(
    symbol: string,
    candles: PriceCandle[],
    orderbook: OrderbookSnapshot | null,
    signal: IntelligenceSignal | null,
  ): TradingAnalysis {
    const alerts: TradingAlert[] = [];
    const strategySignals: StrategySignal[] = [];
    const now = new Date().toISOString();

    // -----------------------------------------------------------------------
    // 1. RSI Analysis
    // -----------------------------------------------------------------------
    const closes = candles.map((c) => c.close);
    const rsiValues = closes.length >= 15 ? StrategyBacktester.computeRsi(closes, 14) : [];
    const rsiCurrent = rsiValues.length > 0
      ? (isNaN(rsiValues[rsiValues.length - 1]) ? null : Math.round(rsiValues[rsiValues.length - 1] * 10) / 10)
      : null;

    let rsiZone: TradingAnalysis['rsiZone'] = 'UNKNOWN';
    if (rsiCurrent !== null) {
      if (rsiCurrent < 30) {
        rsiZone = 'OVERSOLD';
        alerts.push({
          alertId: `rsi-oversold-${Date.now()}`,
          category: 'RSI_SIGNAL',
          severity: 'CAUTION',
          title: `RSI Oversold — ${symbol} @ ${rsiCurrent}`,
          description: `RSI is at ${rsiCurrent} (below 30). Asset may be oversold. Watch for mean-reversion bounce.`,
          actionableHint: 'Consider a small long entry on confirmation of price stabilization. Use tight stop-loss.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'RSI_OVERSOLD_BUY',
          symbol,
          confidence: 0.55,
          rationale: `RSI ${rsiCurrent} < 30 — oversold zone. Mean-reversion long setup.`,
          suggestedAction: 'BUY',
          riskLevel: 'MEDIUM',
          suggestedPositionSizePct: 20,
          isProposalReady: true,
          generatedAt: now,
        });
      } else if (rsiCurrent > 70) {
        rsiZone = 'OVERBOUGHT';
        alerts.push({
          alertId: `rsi-overbought-${Date.now()}`,
          category: 'RSI_SIGNAL',
          severity: 'CAUTION',
          title: `RSI Overbought — ${symbol} @ ${rsiCurrent}`,
          description: `RSI is at ${rsiCurrent} (above 70). Asset may be overbought. Caution on new longs.`,
          actionableHint: 'Reduce or avoid new long entries. Consider partial profit-taking.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'RSI_OVERBOUGHT_SELL',
          symbol,
          confidence: 0.5,
          rationale: `RSI ${rsiCurrent} > 70 — overbought zone. Mean-reversion short setup.`,
          suggestedAction: 'REDUCE',
          riskLevel: 'MEDIUM',
          suggestedPositionSizePct: 10,
          isProposalReady: true,
          generatedAt: now,
        });
      } else {
        rsiZone = 'NEUTRAL';
      }
    }

    // -----------------------------------------------------------------------
    // 2. Orderbook Wall & Spread Analysis
    // -----------------------------------------------------------------------
    let whaleWallBid: TradingAnalysis['whaleWallBid'] = null;
    let whaleWallAsk: TradingAnalysis['whaleWallAsk'] = null;
    let spreadStatus: TradingAnalysis['spreadStatus'] = 'NORMAL';

    if (orderbook) {
      // Detect whale walls (large single-level depth)
      const whaleBidThreshold = symbol.includes('BTC') ? WHALE_WALL_THRESHOLD_BTC
        : symbol.includes('ETH') ? WHALE_WALL_THRESHOLD_ETH
        : WHALE_WALL_THRESHOLD_DEFAULT / (orderbook.bestBid || 1);

      const largeBid = orderbook.bids.find(([, qty]) => qty >= whaleBidThreshold);
      const largeAsk = orderbook.asks.find(([, qty]) => qty >= whaleBidThreshold);

      if (largeBid) {
        whaleWallBid = { price: largeBid[0], qty: largeBid[1] };
        alerts.push({
          alertId: `whale-bid-${Date.now()}`,
          category: 'ORDERBOOK_WALL',
          severity: 'INFO',
          title: `🐳 Whale Buy Wall Detected — ${symbol}`,
          description: `Large bid wall of ${largeBid[1].toFixed(2)} units at $${largeBid[0].toFixed(2)}. Strong support level.`,
          actionableHint: 'This level may act as strong support. Consider entries above this wall with stop below it.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'WHALE_WALL_SUPPORT',
          symbol,
          confidence: 0.60,
          rationale: `Large bid wall (${largeBid[1].toFixed(1)} units) at $${largeBid[0].toFixed(2)} — strong support floor.`,
          suggestedAction: 'BUY',
          riskLevel: 'MEDIUM',
          suggestedPositionSizePct: 15,
          isProposalReady: true,
          generatedAt: now,
        });
      }

      if (largeAsk) {
        whaleWallAsk = { price: largeAsk[0], qty: largeAsk[1] };
        alerts.push({
          alertId: `whale-ask-${Date.now()}`,
          category: 'ORDERBOOK_WALL',
          severity: 'CAUTION',
          title: `🐳 Whale Sell Wall Detected — ${symbol}`,
          description: `Large ask wall of ${largeAsk[1].toFixed(2)} units at $${largeAsk[0].toFixed(2)}. Resistance ahead.`,
          actionableHint: 'Avoid chasing price into this resistance. Wait for wall to absorb or withdraw.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'WHALE_WALL_RESISTANCE',
          symbol,
          confidence: 0.55,
          rationale: `Large ask wall (${largeAsk[1].toFixed(1)} units) at $${largeAsk[0].toFixed(2)} — resistance ceiling.`,
          suggestedAction: 'WAIT',
          riskLevel: 'MEDIUM',
          suggestedPositionSizePct: 0,
          isProposalReady: false,
          generatedAt: now,
        });
      }

      // Spread analysis
      if (orderbook.spreadPct > SPREAD_EXTREME_PCT) {
        spreadStatus = 'EXTREME';
        alerts.push({
          alertId: `spread-extreme-${Date.now()}`,
          category: 'SPREAD_ANOMALY',
          severity: 'WARNING',
          title: `⚠️ Extreme Spread Detected — ${symbol} (${orderbook.spreadPct.toFixed(2)}%)`,
          description: `Bid-ask spread is ${orderbook.spreadPct.toFixed(2)}% — extremely wide, indicating very low liquidity.`,
          actionableHint: 'Avoid market orders. Do not execute trades until spread narrows.',
          shouldPauseTrading: true,
          shouldRejectProposal: true,
          generatedAt: now,
        });
      } else if (orderbook.spreadPct > SPREAD_WIDE_PCT) {
        spreadStatus = 'WIDE';
        alerts.push({
          alertId: `spread-wide-${Date.now()}`,
          category: 'SPREAD_ANOMALY',
          severity: 'CAUTION',
          title: `Spread Wide — ${symbol} (${orderbook.spreadPct.toFixed(2)}%)`,
          description: `Bid-ask spread is ${orderbook.spreadPct.toFixed(2)}% — above normal. Liquidity may be thin.`,
          actionableHint: 'Use limit orders. Be cautious with market orders.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
      } else if (orderbook.spreadPct < 0.05) {
        spreadStatus = 'TIGHT';
      }
    }

    // -----------------------------------------------------------------------
    // 3. Intelligence Signal Analysis (from FeatureEngine)
    // -----------------------------------------------------------------------
    let counterpartyBlocked = false;

    if (signal) {
      // Volume spike alert
      if (signal.inputs.volumeAnomaly) {
        alerts.push({
          alertId: `volume-spike-${Date.now()}`,
          category: 'VOLUME_SPIKE',
          severity: 'CAUTION',
          title: `📊 Volume Spike — ${symbol}`,
          description: 'Current volume is >2× average. Unusual activity detected.',
          actionableHint: 'Monitor for breakout confirmation or fake-out reversal. Wait for 1-2 candle confirmation before entry.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'VOLUME_SURGE_FOLLOW',
          symbol,
          confidence: 0.50,
          rationale: 'Volume spike >2× average — potential breakout or reversal imminent.',
          suggestedAction: 'WAIT',
          riskLevel: 'HIGH',
          suggestedPositionSizePct: 10,
          isProposalReady: false,
          generatedAt: now,
        });
      }

      // Volatility alert
      if (signal.inputs.marketVolatility === 'HIGH') {
        alerts.push({
          alertId: `high-vol-${Date.now()}`,
          category: 'VOLATILITY',
          severity: 'WARNING',
          title: `🔥 High Volatility — ${symbol}`,
          description: 'Market volatility is HIGH based on recent OHLCV range analysis.',
          actionableHint: 'Reduce position sizes. Widen stop-losses. Avoid leveraged entries.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
      }

      // Macro sentiment alert
      if (signal.inputs.macroSentiment === 'BULLISH') {
        alerts.push({
          alertId: `macro-bullish-${Date.now()}`,
          category: 'MACRO_SHIFT',
          severity: 'INFO',
          title: `🌊 Bullish Macro DeFi TVL Signal`,
          description: `DefiLlama TVL data shows majority of top chains are up. Macro tailwind detected.${signal.macroContext ? ` Total DeFi TVL: $${(signal.macroContext.totalDefiTvlUsd / 1e9).toFixed(1)}B.` : ''}`,
          actionableHint: 'Macro conditions are supportive. Higher confidence on long setups.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        if (signal.inputs.marketVolatility !== 'HIGH') {
          strategySignals.push({
            signalType: 'MACRO_BULLISH_ENTRY',
            symbol,
            confidence: 0.60,
            rationale: 'Bullish DefiLlama macro TVL + acceptable volatility = favorable macro backdrop.',
            suggestedAction: 'BUY',
            riskLevel: 'LOW',
            suggestedPositionSizePct: 25,
            isProposalReady: true,
            generatedAt: now,
          });
        }
      } else if (signal.inputs.macroSentiment === 'BEARISH') {
        alerts.push({
          alertId: `macro-bearish-${Date.now()}`,
          category: 'MACRO_SHIFT',
          severity: 'WARNING',
          title: `⬇️ Bearish Macro DeFi TVL Signal`,
          description: `DefiLlama TVL data shows majority of top chains are declining. Macro headwind detected.${signal.macroContext ? ` Total DeFi TVL: $${(signal.macroContext.totalDefiTvlUsd / 1e9).toFixed(1)}B.` : ''}`,
          actionableHint: 'Reduce position sizes. Avoid new longs until macro stabilizes.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'MACRO_BEARISH_CAUTION',
          symbol,
          confidence: 0.55,
          rationale: 'Bearish DefiLlama macro TVL — reduce risk exposure.',
          suggestedAction: 'REDUCE',
          riskLevel: 'HIGH',
          suggestedPositionSizePct: 5,
          isProposalReady: true,
          generatedAt: now,
        });
      }

      // Counterparty risk alert
      if (signal.inputs.counterpartyRisk === 'BLOCKED') {
        counterpartyBlocked = true;
        alerts.push({
          alertId: `counterparty-blocked-${Date.now()}`,
          category: 'COUNTERPARTY_RISK',
          severity: 'CRITICAL',
          title: `🚨 COUNTERPARTY BLOCKED — ${symbol}`,
          description: 'Arkham Intelligence has flagged this counterparty as BLOCKED. Transaction involves a high-risk wallet.',
          actionableHint: 'DO NOT proceed with any trade involving this counterparty. Contact compliance team.',
          shouldPauseTrading: true,
          shouldRejectProposal: true,
          generatedAt: now,
        });
        strategySignals.push({
          signalType: 'HOLD_CASH',
          symbol,
          confidence: 0.95,
          rationale: 'COUNTERPARTY_BLOCKED by Arkham Intelligence — all trades must be halted.',
          suggestedAction: 'HOLD',
          riskLevel: 'HIGH',
          suggestedPositionSizePct: 0,
          isProposalReady: false,
          generatedAt: now,
        });
      } else if (signal.inputs.counterpartyRisk === 'CAUTION') {
        alerts.push({
          alertId: `counterparty-caution-${Date.now()}`,
          category: 'COUNTERPARTY_RISK',
          severity: 'WARNING',
          title: `⚠️ Low Counterparty Risk Score — ${symbol}`,
          description: 'Arkham Intelligence reports a low risk passport score for this counterparty.',
          actionableHint: 'Proceed with reduced position size only. Monitor counterparty profile.',
          shouldPauseTrading: false,
          shouldRejectProposal: false,
          generatedAt: now,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 4. Market Regime Detection
    // -----------------------------------------------------------------------
    const regime = TradingSignalEngine.detectRegime(candles, orderbook, signal);

    // Regime change alert if unusual
    if (regime.regime === 'HIGH_VOLATILITY') {
      alerts.push({
        alertId: `regime-highvol-${Date.now()}`,
        category: 'REGIME_CHANGE',
        severity: 'WARNING',
        title: `⚡ High Volatility Regime — ${symbol}`,
        description: `Market is in HIGH_VOLATILITY regime (confidence: ${(regime.confidence * 100).toFixed(0)}%).`,
        actionableHint: 'Tighten risk parameters. Reduce position sizes by 50%. Widen stop-losses.',
        shouldPauseTrading: false,
        shouldRejectProposal: false,
        generatedAt: now,
      });
    } else if (regime.regime === 'LOW_LIQUIDITY') {
      alerts.push({
        alertId: `regime-lowliq-${Date.now()}`,
        category: 'REGIME_CHANGE',
        severity: 'WARNING',
        title: `🏜️ Low Liquidity Regime — ${symbol}`,
        description: `Market is in LOW_LIQUIDITY regime. Spread is wide and orderbook depth is thin.`,
        actionableHint: 'Avoid market orders entirely. Use limit orders only. Consider waiting for liquidity to return.',
        shouldPauseTrading: true,
        shouldRejectProposal: false,
        generatedAt: now,
      });
    }

    // -----------------------------------------------------------------------
    // 5. No Signal Fallback
    // -----------------------------------------------------------------------
    if (strategySignals.length === 0) {
      strategySignals.push({
        signalType: 'NO_CLEAR_SIGNAL',
        symbol,
        confidence: 0.3,
        rationale: 'Insufficient data or conflicting signals. No actionable setup detected.',
        suggestedAction: 'WAIT',
        riskLevel: 'LOW',
        suggestedPositionSizePct: 0,
        isProposalReady: false,
        generatedAt: now,
      });
    }

    // -----------------------------------------------------------------------
    // 6. Overall Risk Score (0–100)
    // -----------------------------------------------------------------------
    let overallRiskScore = 20; // baseline low risk
    if (signal?.inputs.marketVolatility === 'HIGH') overallRiskScore += 25;
    if (signal?.inputs.marketVolatility === 'MEDIUM') overallRiskScore += 10;
    if (signal?.inputs.volumeAnomaly) overallRiskScore += 10;
    if (spreadStatus === 'WIDE') overallRiskScore += 10;
    if (spreadStatus === 'EXTREME') overallRiskScore += 25;
    if (signal?.inputs.macroSentiment === 'BEARISH') overallRiskScore += 15;
    if (counterpartyBlocked) overallRiskScore += 30;
    if (regime.regime === 'HIGH_VOLATILITY') overallRiskScore += 10;
    overallRiskScore = Math.min(100, overallRiskScore);

    const tradingPaused = alerts.some((a) => a.shouldPauseTrading);

    // Sort alerts: CRITICAL → WARNING → CAUTION → INFO
    const severityOrder = { CRITICAL: 0, WARNING: 1, CAUTION: 2, INFO: 3 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Sort strategy signals by confidence descending
    strategySignals.sort((a, b) => b.confidence - a.confidence);

    return {
      symbol,
      regime,
      alerts,
      strategySignals,
      rsiCurrent,
      rsiZone,
      whaleWallBid,
      whaleWallAsk,
      spreadStatus,
      overallRiskScore,
      tradingPaused,
      analysedAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // Market Regime Detection
  // ---------------------------------------------------------------------------

  static detectRegime(
    candles: PriceCandle[],
    orderbook: OrderbookSnapshot | null,
    signal: IntelligenceSignal | null,
  ): MarketRegime {
    const now = new Date().toISOString();

    if (candles.length < 5) {
      return { regime: 'UNKNOWN', confidence: 0, description: 'Insufficient candle data', detectedAt: now };
    }

    // Compute recent price movement
    const recent = candles.slice(-10);
    const firstClose = recent[0].close;
    const lastClose = recent[recent.length - 1].close;
    const priceDeltaPct = ((lastClose - firstClose) / firstClose) * 100;

    // Compute avg range (volatility proxy)
    const avgRangePct = recent.reduce((sum, c) => sum + (c.high - c.low) / c.close, 0) / recent.length * 100;

    // Volume trend
    const firstHalfVol = recent.slice(0, 5).reduce((s, c) => s + c.volume, 0) / 5;
    const secondHalfVol = recent.slice(5).reduce((s, c) => s + c.volume, 0) / 5;
    const volumeTrend = secondHalfVol > firstHalfVol * 1.5 ? 'RISING' : secondHalfVol < firstHalfVol * 0.6 ? 'FALLING' : 'FLAT';

    // Spread check
    const spreadPct = orderbook?.spreadPct ?? 0;

    // Regime classification logic
    if (spreadStatus_from(spreadPct) === 'EXTREME' || spreadStatus_from(spreadPct) === 'WIDE') {
      return {
        regime: 'LOW_LIQUIDITY',
        confidence: 0.75,
        description: `Spread ${spreadPct.toFixed(2)}% indicates thin orderbook and low liquidity.`,
        detectedAt: now,
      };
    }

    if (avgRangePct > 3.0) {
      return {
        regime: 'HIGH_VOLATILITY',
        confidence: 0.80,
        description: `Average candle range ${avgRangePct.toFixed(2)}% exceeds 3% threshold — high volatility regime.`,
        detectedAt: now,
      };
    }

    if (priceDeltaPct > 2.5 && volumeTrend === 'RISING') {
      return {
        regime: 'TRENDING_UP',
        confidence: 0.70,
        description: `Price up ${priceDeltaPct.toFixed(2)}% with rising volume — uptrend regime.`,
        detectedAt: now,
      };
    }

    if (priceDeltaPct < -2.5 && volumeTrend === 'RISING') {
      return {
        regime: 'TRENDING_DOWN',
        confidence: 0.70,
        description: `Price down ${Math.abs(priceDeltaPct).toFixed(2)}% with rising volume — downtrend regime.`,
        detectedAt: now,
      };
    }

    if (Math.abs(priceDeltaPct) < 1.0 && avgRangePct < 1.5 && volumeTrend === 'FALLING') {
      return {
        regime: 'ACCUMULATION',
        confidence: 0.55,
        description: `Low volatility drift with declining volume — possible accumulation phase.`,
        detectedAt: now,
      };
    }

    if (Math.abs(priceDeltaPct) < 1.5) {
      return {
        regime: 'RANGE_BOUND',
        confidence: 0.60,
        description: `Price delta ${priceDeltaPct.toFixed(2)}% — market is oscillating within a range.`,
        detectedAt: now,
      };
    }

    return {
      regime: 'UNKNOWN',
      confidence: 0.30,
      description: 'Conflicting signals — regime undetermined.',
      detectedAt: now,
    };
  }
}

// Internal helper (no export)
function spreadStatus_from(spreadPct: number): 'TIGHT' | 'NORMAL' | 'WIDE' | 'EXTREME' {
  if (spreadPct > SPREAD_EXTREME_PCT) return 'EXTREME';
  if (spreadPct > SPREAD_WIDE_PCT) return 'WIDE';
  if (spreadPct < 0.05) return 'TIGHT';
  return 'NORMAL';
}
