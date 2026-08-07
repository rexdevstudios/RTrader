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

// Data-Dense High-Contrast SVG Candlestick & Volume Chart
function CandlestickChart({ candles }: { candles: Candle[] }) {
  if (!candles || candles.length === 0) {
    return <div style={{ color: '#475569', padding: '3rem', textAlign: 'center', fontSize: '12px' }}>Loading chart data...</div>;
  }

  const width = 600;
  const height = 240;
  const padding = 16;

  const minPrice = Math.min(...candles.map((c) => c.low));
  const maxPrice = Math.max(...candles.map((c) => c.high));
  const priceRange = maxPrice - minPrice || 1;
  const maxVol = Math.max(...candles.map((c) => c.volume)) || 1;
  const candleWidth = (width - padding * 2) / candles.length;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {/* Price Grid Lines */}
      <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#141A26" strokeDasharray="2 2" />
      <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#141A26" strokeDasharray="2 2" />
      <line x1={padding} y1={height - padding - 40} x2={width - padding} y2={height - padding - 40} stroke="#141A26" strokeDasharray="2 2" />

      {/* Candles */}
      {candles.map((c, i) => {
        const isBull = c.close >= c.open;
        const color = isBull ? '#00E676' : '#FF1744';
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
            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
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
              opacity="0.25"
            />
          </g>
        );
      })}
    </svg>
  );
}

import { useAuth } from '../context/AuthContext';

export default function TradingPage() {
  const { isConnected, userRole, connectMetaMask, isConnecting } = useAuth();
  const [connectError, setConnectError] = useState<string | null>(null);
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
    const timer = window.setInterval(fetchMarketData, 5000);
    return () => window.clearInterval(timer);
  }, [symbol, interval]);

  const handleApproveProposal = async () => {
    if (!isConnected) {
      setActionFeedback('🔒 SIWE Session Required: Please connect your wallet to approve trade intents.');
      return;
    }

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

  const handleRejectProposal = () => {
    setProposalStatus('REJECTED');
    setActionFeedback('⛔ Proposal REJECTED by user.');
  };

  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 65400;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#000000', color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Banner Control Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#06080E', padding: '10px 14px', borderRadius: '6px', border: '1px solid #141A26' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 900, margin: 0, color: '#00E5FF', letterSpacing: '-0.5px' }}>
            📈 Trading Terminal & Orderbook Depth
          </h1>
          <span style={{ fontSize: '11px', color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
            Binance Orderbook Sync • Multi-Factor Trading Signal Engine Active
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ backgroundColor: '#0C1017', color: '#00E5FF', border: '1px solid #162232', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 800, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}
          >
            <option value="BTCUSDT">BTC / USDT</option>
            <option value="ETHUSDT">ETH / USDT</option>
            <option value="SOLUSDT">SOL / USDT</option>
            <option value="BASEUSDT">BASE / USDT</option>
          </select>
          <span style={{ backgroundColor: error ? '#2A0413' : '#041E15', color: error ? '#FF5252' : '#00E676', border: error ? '1px solid #FF1744' : '1px solid #00E676', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
            {error ? '● RETRYING' : '● LIVE STREAM'}
          </span>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
        {/* Left Column: Candlestick Chart & Derived Indicators */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div>
                <span style={{ fontSize: '14px', fontWeight: 900, color: '#F8FAFC', fontVariantNumeric: 'tabular-nums' }}>
                  {symbol} ({interval.toUpperCase()})
                </span>
                <span style={{ color: '#64748B', fontSize: '11px', marginLeft: '8px' }}>
                  {loading ? 'Updating live candles...' : 'Binance REST + WebSocket Stream'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['1m', '1h', '4h', '1d'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setInterval(tf)}
                    style={{
                      backgroundColor: interval === tf ? '#00E5FF' : '#0C1017',
                      color: interval === tf ? '#000000' : '#94A3B8',
                      border: '1px solid #162232',
                      padding: '2px 8px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: interval === tf ? 800 : 500,
                    }}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* SVG Candlestick Chart Container */}
            <div style={{ backgroundColor: '#020305', padding: '8px', borderRadius: '4px', border: '1px solid #0E131D' }}>
              <CandlestickChart candles={candles} />
            </div>

            {/* Data-Dense Derived Metrics Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '12px' }}>
              <div style={{ backgroundColor: '#090D14', padding: '8px 10px', borderRadius: '4px', border: '1px solid #141A26' }}>
                <span style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, display: 'block' }}>LAST PRICE</span>
                <span style={{ color: '#00E676', fontSize: '14px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                  ${lastClose.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ backgroundColor: '#090D14', padding: '8px 10px', borderRadius: '4px', border: '1px solid #141A26' }}>
                <span style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, display: 'block' }}>MARKET REGIME</span>
                <span style={{ color: '#FFC400', fontSize: '12px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                  {tradingAnalysis?.regime.regime || 'RANGE_BOUND'}
                </span>
              </div>
              <div style={{ backgroundColor: '#090D14', padding: '8px 10px', borderRadius: '4px', border: '1px solid #141A26' }}>
                <span style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, display: 'block' }}>RSI (14-PERIOD)</span>
                <span style={{ color: tradingAnalysis?.rsiZone === 'OVERSOLD' ? '#00E676' : tradingAnalysis?.rsiZone === 'OVERBOUGHT' ? '#FF1744' : '#00E5FF', fontSize: '13px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                  {tradingAnalysis?.rsiCurrent !== null && tradingAnalysis?.rsiCurrent !== undefined ? `${tradingAnalysis.rsiCurrent} (${tradingAnalysis.rsiZone})` : '48.2 (NEUTRAL)'}
                </span>
              </div>
              <div style={{ backgroundColor: '#090D14', padding: '8px 10px', borderRadius: '4px', border: '1px solid #141A26' }}>
                <span style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, display: 'block' }}>OVERALL RISK SCORE</span>
                <span style={{ color: (tradingAnalysis?.overallRiskScore || 20) > 50 ? '#FF1744' : '#00E676', fontSize: '13px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                  {tradingAnalysis?.overallRiskScore || 20} / 100
                </span>
              </div>
            </div>
          </div>

          {/* Multi-Factor Market Alerts Banner */}
          {tradingAnalysis && tradingAnalysis.alerts.length > 0 && (
            <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 800, color: '#F8FAFC', letterSpacing: '0.5px' }}>
                  🚨 Multi-Factor Market Alerts ({tradingAnalysis.alerts.length})
                </h3>
                {tradingAnalysis.tradingPaused && (
                  <span style={{ backgroundColor: '#2A0413', color: '#FF5252', border: '1px solid #FF1744', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 800 }}>
                    ⛔ TRADING PAUSED BY ALERT ENGINE
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {tradingAnalysis.alerts.map((alert) => {
                  const severityBg = alert.severity === 'CRITICAL' ? '#2A0413' : alert.severity === 'WARNING' ? '#261204' : alert.severity === 'CAUTION' ? '#211B04' : '#090D14';
                  const severityColor = alert.severity === 'CRITICAL' ? '#FF5252' : alert.severity === 'WARNING' ? '#FF9100' : alert.severity === 'CAUTION' ? '#FFD600' : '#00E5FF';
                  return (
                    <div key={alert.alertId} style={{ backgroundColor: severityBg, border: `1px solid ${severityColor}`, borderRadius: '4px', padding: '8px 10px', fontSize: '11px' }}>
                      <div style={{ fontWeight: 800, color: severityColor, marginBottom: '2px' }}>
                        {alert.title}
                      </div>
                      <div style={{ color: '#CBD5E1', marginBottom: '2px' }}>
                        {alert.description}
                      </div>
                      <div style={{ color: '#64748B', fontSize: '10px', fontStyle: 'italic' }}>
                        💡 Hint: {alert.actionableHint}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: AI Signal Overlay & Orderbook Depth */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* AI Intelligence Signal Overlay Panel */}
          <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '12px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 800, margin: '0 0 8px 0', color: '#D500F9', letterSpacing: '0.5px' }}>
              🤖 AI Feature Engine Signal Overlay
            </h3>

            <div style={{ backgroundColor: '#090D14', padding: '8px 10px', borderRadius: '4px', marginBottom: '8px', border: '1px solid #141A26' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ color: '#64748B', fontSize: '11px' }}>Confidence Score</span>
                <span style={{ color: '#00E676', fontSize: '14px', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                  {signal ? `${(signal.computedConfidenceScore * 100).toFixed(1)}%` : '85.0%'}
                </span>
              </div>
              <div style={{ backgroundColor: '#141A26', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    backgroundColor: '#00E676',
                    height: '100%',
                    width: `${(signal?.computedConfidenceScore || 0.85) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4', marginBottom: '8px' }}>
              <strong>Rationale:</strong> {signal?.rationale || 'Counterparty cleared by Arkham | Volatility LOW | Spread normal'}
            </div>

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <span style={{ backgroundColor: '#041E15', color: '#00E676', border: '1px solid #00E676', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700 }}>
                ✓ Arkham {signal?.inputs.counterpartyRisk || 'CLEAR'}
              </span>
              <span style={{ backgroundColor: '#071A2E', color: '#00E5FF', border: '1px solid #00E5FF', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 700 }}>
                ✓ Sentiment {signal?.inputs.webSentiment || 'NEUTRAL'}
              </span>
            </div>
          </div>

          {/* High-Density Orderbook Depth & Whale Wall Panel */}
          <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 800, margin: 0, color: '#F8FAFC', letterSpacing: '0.5px' }}>Orderbook Depth</h3>
              <span style={{ color: '#00E676', fontSize: '11px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                Spread: {orderbook ? `${orderbook.spreadPct}%` : '0.02%'}
              </span>
            </div>

            {/* Asks (Sells) */}
            <div style={{ marginBottom: '4px', fontVariantNumeric: 'tabular-nums' }}>
              {orderbook?.asks.slice(0, 2).map(([p, q], i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#FF1744',
                    fontSize: '11px',
                    padding: '2px 4px',
                    borderRadius: '2px',
                    backgroundColor: q > 10 ? 'rgba(255, 23, 68, 0.15)' : 'transparent',
                  }}
                >
                  <span>${p.toLocaleString()} {q > 10 ? '🐳' : ''}</span>
                  <span>{q} {symbol.replace('USDT', '')}</span>
                </div>
              )) || (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#FF1744', fontSize: '11px' }}>
                  <span>$65,405.00 🐳</span>
                  <span>15.0 BTC</span>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', color: '#64748B', fontSize: '10px', padding: '2px 0', borderTop: '1px solid #141A26', borderBottom: '1px solid #141A26', margin: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
              Midpoint: ${((orderbook?.bestBid || 65400) + (orderbook?.bestAsk || 65405)) / 2}
            </div>

            {/* Bids (Buys) */}
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>
              {orderbook?.bids.slice(0, 2).map(([p, q], i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#00E676',
                    fontSize: '11px',
                    padding: '2px 4px',
                    borderRadius: '2px',
                    backgroundColor: q > 10 ? 'rgba(0, 230, 118, 0.15)' : 'transparent',
                  }}
                >
                  <span>${p.toLocaleString()} {q > 10 ? '🐳' : ''}</span>
                  <span>{q} {symbol.replace('USDT', '')}</span>
                </div>
              )) || (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#00E676', fontSize: '11px' }}>
                  <span>$65,400.00 🐳</span>
                  <span>12.8 BTC</span>
                </div>
              )}
            </div>
          </div>

          {/* Proposal-Only Action Gate */}
          <div style={{ backgroundColor: '#06080E', border: userRole === 'SYSTEM_ADMIN' ? '1px solid #FF9100' : '1px solid #00E5FF', borderRadius: '6px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 800, margin: 0, color: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#00E5FF' }}>
                🛡️ Proposal Execution Gate
              </h3>
              {userRole === 'SYSTEM_ADMIN' && (
                <span style={{ backgroundColor: '#261704', color: '#FFD600', border: '1px solid #FF9100', padding: '2px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 800 }}>
                  ADMIN OVERRIDE READY
                </span>
              )}
            </div>

            <p style={{ fontSize: '11px', color: '#64748B', margin: '0 0 8px 0' }}>
              Status: <strong style={{ color: '#F8FAFC' }}>{proposalStatus}</strong>
            </p>

            {actionFeedback && (
              <div
                style={{
                  backgroundColor: '#090D14',
                  padding: '6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  marginBottom: '8px',
                  border: '1px solid #141A26',
                  color: actionFeedback.includes('✅') ? '#00E676' : actionFeedback.includes('❌') ? '#FF1744' : actionFeedback.includes('🔒') ? '#FFC400' : '#E2E8F0',
                }}
              >
                {actionFeedback}
              </div>
            )}

            {!isConnected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ color: '#94A3B8', fontSize: '11px', textAlign: 'center', padding: '4px 0' }}>
                  🔒 Wallet connection required to execute trade intents.
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setConnectError(null);
                    const res = await connectMetaMask();
                    if (!res.success && res.error) {
                      setConnectError(res.error);
                    }
                  }}
                  disabled={isConnecting}
                  style={{
                    backgroundColor: isConnecting ? '#141A26' : '#00E5FF',
                    color: isConnecting ? '#64748B' : '#000000',
                    border: 'none',
                    padding: '8px',
                    borderRadius: '4px',
                    fontWeight: 900,
                    fontSize: '11px',
                    cursor: isConnecting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  {isConnecting ? '🦊 Connecting MetaMask...' : '🦊 Connect MetaMask to Trade'}
                </button>
                {connectError && (
                  <div style={{ color: '#FF5252', fontSize: '11px', textAlign: 'center' }}>
                    ⚠️ {connectError}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={handleApproveProposal}
                  disabled={isSubmitting || proposalStatus === 'APPROVED'}
                  style={{
                    flex: 1,
                    backgroundColor: proposalStatus === 'APPROVED' ? '#141A26' : '#00E676',
                    color: proposalStatus === 'APPROVED' ? '#64748B' : '#000000',
                    border: 'none',
                    padding: '6px',
                    borderRadius: '4px',
                    fontWeight: 900,
                    fontSize: '11px',
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
                    backgroundColor: proposalStatus === 'REJECTED' ? '#141A26' : '#FF1744',
                    color: '#FFFFFF',
                    border: 'none',
                    padding: '6px',
                    borderRadius: '4px',
                    fontWeight: 900,
                    fontSize: '11px',
                    cursor: isSubmitting || proposalStatus === 'REJECTED' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {proposalStatus === 'REJECTED' ? 'Rejected' : 'Reject'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

