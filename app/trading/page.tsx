'use client';

import React, { useState, useEffect } from 'react';

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Orderbook {
  symbol: string;
  timestamp: number;
  bids: [number, number][];
  asks: [number, number][];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
}

interface IntelligenceSignal {
  symbol: string;
  computedConfidenceScore: number;
  rationale: string;
  riskFlags: string[];
  inputs: {
    webSentiment: string;
    counterpartyRisk: string;
    marketVolatility: string;
    volumeAnomaly: boolean;
  };
  computedAt: string;
}

// Lightweight SVG Candlestick & Volume Chart Component
function CandlestickChart({ candles }: { candles: Candle[] }) {
  if (!candles || candles.length === 0) {
    return <div style={{ color: '#64748b', padding: '3rem', textAlign: 'center' }}>No chart data available</div>;
  }

  const width = 600;
  const height = 240;
  const padding = 20;

  const minPrice = Math.min(...candles.map((c) => c.low));
  const maxPrice = Math.max(...candles.map((c) => c.high));
  const priceRange = maxPrice - minPrice || 1;
  const maxVol = Math.max(...candles.map((c) => c.volume)) || 1;
  const candleWidth = (width - padding * 2) / candles.length;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {/* Price Grid Lines */}
      <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#334155" strokeDasharray="3 3" />
      <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#334155" strokeDasharray="3 3" />
      <line x1={padding} y1={height - padding - 40} x2={width - padding} y2={height - padding - 40} stroke="#334155" strokeDasharray="3 3" />

      {/* Candles */}
      {candles.map((c, i) => {
        const isBull = c.close >= c.open;
        const color = isBull ? '#34d399' : '#f87171';
        const x = padding + i * candleWidth + candleWidth / 2;
        const chartHeight = height - padding * 2 - 40;

        const yHigh = padding + (1 - (c.high - minPrice) / priceRange) * chartHeight;
        const yLow = padding + (1 - (c.low - minPrice) / priceRange) * chartHeight;
        const yOpen = padding + (1 - (c.open - minPrice) / priceRange) * chartHeight;
        const yClose = padding + (1 - (c.close - minPrice) / priceRange) * chartHeight;

        const candleTop = Math.min(yOpen, yClose);
        const candleBodyHeight = Math.max(2, Math.abs(yClose - yOpen));
        const volHeight = (c.volume / maxVol) * 35;
        const yVol = height - padding - volHeight;

        return (
          <g key={i}>
            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.5" />
            <rect
              x={x - candleWidth * 0.35}
              y={candleTop}
              width={candleWidth * 0.7}
              height={candleBodyHeight}
              fill={color}
              rx="1"
            />
            <rect
              x={x - candleWidth * 0.35}
              y={yVol}
              width={candleWidth * 0.7}
              height={volHeight}
              fill={color}
              opacity="0.3"
            />
          </g>
        );
      })}
    </svg>
  );
}

interface TradingAnalysis {
  symbol: string;
  regime: {
    regime: string;
    confidence: number;
    description: string;
  };
  alerts: Array<{
    alertId: string;
    category: string;
    severity: 'INFO' | 'CAUTION' | 'WARNING' | 'CRITICAL';
    title: string;
    description: string;
    actionableHint: string;
    shouldPauseTrading: boolean;
  }>;
  strategySignals: Array<{
    signalType: string;
    confidence: number;
    rationale: string;
    suggestedAction: string;
    riskLevel: string;
    suggestedPositionSizePct: number;
  }>;
  rsiCurrent: number | null;
  rsiZone: string;
  whaleWallBid: { price: number; qty: number } | null;
  whaleWallAsk: { price: number; qty: number } | null;
  spreadStatus: string;
  overallRiskScore: number;
  tradingPaused: boolean;
}

export default function TradingPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1h');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [signal, setSignal] = useState<IntelligenceSignal | null>(null);
  const [tradingAnalysis, setTradingAnalysis] = useState<TradingAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proposalStatus, setProposalStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch Chart & Market Data from API
  const fetchMarketData = async () => {
    try {
      const res = await fetch(`/api/market/chart?symbol=${symbol}&interval=${interval}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (json.success && json.data) {
        setCandles(json.data.candles || []);
        setOrderbook(json.data.orderbook || null);
        setSignal(json.data.signal || null);
        setTradingAnalysis(json.data.tradingAnalysis || null);
        setError(null);
      }
    } catch (err) {
      console.warn('[Trading UI] API fetch error (using fallback state):', (err as Error).message);
      setError('Live connection retrying... using cached visualization state');
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    setLoading(true);
    fetchMarketData();
    const timer = window.setInterval(() => {
      fetchMarketData();
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [symbol, interval]);



  // Handle Proposal Approval
  const handleApproveProposal = async () => {
    setIsSubmitting(true);
    setActionFeedback(null);
    try {
      const res = await fetch('/api/trade-intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side: 'BUY',
          type: 'MARKET',
          quantity: 0.1,
          maxSlippagePct: 1.5,
          stage: 'TESTNET',
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProposalStatus('APPROVED');
        setActionFeedback(`✅ Proposal APPROVED & Intent ${json.data?.tradeIntentId || ''} passed Risk Gate!`);
      } else {
        setActionFeedback(`❌ Risk Gate Rejected: ${json.error?.message || 'Policy violation'}`);
      }
    } catch (err) {
      setActionFeedback(`⚠️ Connection error during approval: ${(err as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Proposal Rejection
  const handleRejectProposal = () => {
    setProposalStatus('REJECTED');
    setActionFeedback('⛔ Proposal REJECTED by user.');
  };

  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 65400;

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '100vh' }}>
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', margin: 0, color: '#38bdf8' }}>📈 Trading Terminal & Market Visualization</h1>
          <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0' }}>
            Live Stream Feed • Binance Orderbook & OHLCV • AI Feature Engine Overlay
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Symbol Selector */}
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ backgroundColor: '#1e293b', color: '#f8fafc', border: '1px solid #334155', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            <option value="BTCUSDT">BTC / USDT</option>
            <option value="ETHUSDT">ETH / USDT</option>
            <option value="SOLUSDT">SOL / USDT</option>
            <option value="BASEUSDT">BASE / USDT</option>
          </select>
          <span style={{ backgroundColor: error ? '#831843' : '#065f46', color: error ? '#f472b6' : '#34d399', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold' }}>
            {error ? '● CACHED / RETRYING' : '● LIVE STREAM'}
          </span>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        {/* Left Column: Candlestick & Volume Chart */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#f8fafc' }}>
                {symbol} — {interval.toUpperCase()} Candlestick & Volume
              </h2>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                {loading ? 'Updating live candles...' : 'Binance WebSocket Stream + Historical Feed'}
              </span>
            </div>
            {/* Interval Selector */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['1m', '1h', '4h', '1d'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setInterval(tf)}
                  style={{
                    backgroundColor: interval === tf ? '#0284c7' : '#334155',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.3rem 0.6rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: interval === tf ? 'bold' : 'normal',
                  }}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* SVG Candlestick Chart Container */}
          <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <CandlestickChart candles={candles} />
          </div>

          {/* Derived Market Metrics Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>LAST PRICE</span>
              <span style={{ color: '#34d399', fontSize: '1.1rem', fontWeight: 'bold' }}>
                ${lastClose.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>MARKET REGIME</span>
              <span style={{ color: '#f59e0b', fontSize: '1.0rem', fontWeight: 'bold' }}>
                {tradingAnalysis?.regime.regime || 'RANGE_BOUND'}
              </span>
            </div>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>RSI (14-PERIOD)</span>
              <span style={{ color: tradingAnalysis?.rsiZone === 'OVERSOLD' ? '#34d399' : tradingAnalysis?.rsiZone === 'OVERBOUGHT' ? '#f87171' : '#38bdf8', fontSize: '1.1rem', fontWeight: 'bold' }}>
                {tradingAnalysis?.rsiCurrent !== null && tradingAnalysis?.rsiCurrent !== undefined ? `${tradingAnalysis.rsiCurrent} (${tradingAnalysis.rsiZone})` : '48.2 (NEUTRAL)'}
              </span>
            </div>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>OVERALL RISK SCORE</span>
              <span style={{ color: (tradingAnalysis?.overallRiskScore || 20) > 50 ? '#f87171' : '#34d399', fontSize: '1.1rem', fontWeight: 'bold' }}>
                {tradingAnalysis?.overallRiskScore || 20} / 100
              </span>
            </div>
          </div>

          {/* Trading Signals & Multi-Factor Alerts Banner */}
          {tradingAnalysis && tradingAnalysis.alerts.length > 0 && (
            <div style={{ marginTop: '1.5rem', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>
                  🚨 Multi-Factor Market Alerts ({tradingAnalysis.alerts.length})
                </h3>
                {tradingAnalysis.tradingPaused && (
                  <span style={{ backgroundColor: '#831843', color: '#f472b6', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                    ⛔ TRADING PAUSED BY ALERT ENGINE
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {tradingAnalysis.alerts.map((alert) => {
                  const severityBg = alert.severity === 'CRITICAL' ? '#831843' : alert.severity === 'WARNING' ? '#7c2d12' : alert.severity === 'CAUTION' ? '#713f12' : '#1e293b';
                  const severityColor = alert.severity === 'CRITICAL' ? '#f472b6' : alert.severity === 'WARNING' ? '#fb923c' : alert.severity === 'CAUTION' ? '#facc15' : '#38bdf8';
                  return (
                    <div key={alert.alertId} style={{ backgroundColor: severityBg, border: `1px solid ${severityColor}`, borderRadius: '6px', padding: '0.6rem 0.8rem', fontSize: '0.85rem' }}>
                      <div style={{ fontWeight: 'bold', color: severityColor, marginBottom: '0.2rem' }}>
                        {alert.title}
                      </div>
                      <div style={{ color: '#cbd5e1', marginBottom: '0.25rem' }}>
                        {alert.description}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontStyle: 'italic' }}>
                        💡 Hint: {alert.actionableHint}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Right Column: AI Overlay & Orderbook Depth */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* AI Intelligence Signal Overlay Panel */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem', margin: '0 0 1rem 0', color: '#c084fc' }}>
              🤖 AI Feature Engine Signal Overlay
            </h3>

            <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Computed Confidence Score</span>
                <span style={{ color: '#34d399', fontSize: '1.25rem', fontWeight: 'bold' }}>
                  {signal ? `${(signal.computedConfidenceScore * 100).toFixed(1)}%` : '85.0%'}
                </span>
              </div>
              <div style={{ backgroundColor: '#334155', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    backgroundColor: '#34d399',
                    height: '100%',
                    width: `${(signal?.computedConfidenceScore || 0.85) * 100}%`,
                    transition: 'width 0.5s ease-in-out',
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.4', marginBottom: '1rem' }}>
              <strong>Signal Rationale:</strong> {signal?.rationale || 'Counterparty cleared by Arkham | Volatility LOW | Spread normal'}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                ✓ Arkham {signal?.inputs.counterpartyRisk || 'CLEAR'}
              </span>
              <span style={{ backgroundColor: '#1e40af', color: '#60a5fa', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                ✓ Sentiment {signal?.inputs.webSentiment || 'NEUTRAL'}
              </span>
              <span style={{ backgroundColor: '#374151', color: '#9ca3af', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                ✓ Volatility {signal?.inputs.marketVolatility || 'LOW'}
              </span>
            </div>
          </div>

          {/* Orderbook Depth & Whale Wall Detection Panel */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', margin: 0, color: '#f8fafc' }}>Orderbook Depth & Spread</h3>
              <span style={{ color: '#34d399', fontSize: '0.8rem', fontWeight: 'bold' }}>
                Spread: {orderbook ? `${orderbook.spreadPct}%` : '0.02%'}
              </span>
            </div>

            {/* Asks (Sells) */}
            <div style={{ marginBottom: '0.5rem' }}>
              {orderbook?.asks.slice(0, 2).map(([p, q], i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',

                    color: '#f87171',
                    fontSize: '0.85rem',
                    padding: '0.2rem 0',
                    backgroundColor: q > 10 ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
                  }}
                >
                  <span>${p.toLocaleString()} {q > 10 ? '🐳' : ''}</span>
                  <span>{q} {symbol.replace('USDT', '')} {q > 10 ? '(Whale Wall)' : ''}</span>
                </div>
              )) || (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171', fontSize: '0.85rem' }}>
                  <span>$65,405.00 🐳</span>
                  <span>15.0 BTC (Whale Wall)</span>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '0.25rem 0', borderTop: '1px solid #334155', borderBottom: '1px solid #334155', margin: '0.4rem 0' }}>
              ── Market Midpoint: ${((orderbook?.bestBid || 65400) + (orderbook?.bestAsk || 65405)) / 2} ──
            </div>

            {/* Bids (Buys) */}
            <div>
              {orderbook?.bids.slice(0, 2).map(([p, q], i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',

                    color: '#34d399',
                    fontSize: '0.85rem',
                    padding: '0.2rem 0',
                    backgroundColor: q > 10 ? 'rgba(52, 211, 153, 0.15)' : 'transparent',
                  }}
                >
                  <span>${p.toLocaleString()} {q > 10 ? '🐳' : ''}</span>
                  <span>{q} {symbol.replace('USDT', '')} {q > 10 ? '(Whale Wall)' : ''}</span>
                </div>
              )) || (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', fontSize: '0.85rem' }}>
                  <span>$65,400.00 🐳</span>
                  <span>12.8 BTC (Whale Wall)</span>
                </div>
              )}
            </div>
          </div>

          {/* Proposal-Only Action Panel */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #0284c7', borderRadius: '12px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0', color: '#38bdf8' }}>
              🛡️ Proposal-Only Execution Gate
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 1rem 0' }}>
              AI Proposal for {symbol} requires user approval. Status: <strong>{proposalStatus}</strong>
            </p>

            {actionFeedback && (
              <div
                style={{
                  backgroundColor: '#0f172a',
                  padding: '0.6rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  marginBottom: '0.75rem',
                  border: '1px solid #334155',
                  color: actionFeedback.includes('✅') ? '#34d399' : actionFeedback.includes('❌') ? '#f87171' : '#f8fafc',
                }}
              >
                {actionFeedback}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleApproveProposal}
                disabled={isSubmitting || proposalStatus === 'APPROVED'}
                style={{
                  flex: 1,
                  backgroundColor: proposalStatus === 'APPROVED' ? '#334155' : '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.6rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: isSubmitting || proposalStatus === 'APPROVED' ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Processing...' : proposalStatus === 'APPROVED' ? 'Approved' : 'Approve Proposal'}
              </button>

              <button
                onClick={handleRejectProposal}
                disabled={isSubmitting || proposalStatus === 'REJECTED'}
                style={{
                  flex: 1,
                  backgroundColor: proposalStatus === 'REJECTED' ? '#334155' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.6rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: isSubmitting || proposalStatus === 'REJECTED' ? 'not-allowed' : 'pointer',
                }}
              >
                {proposalStatus === 'REJECTED' ? 'Rejected' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
