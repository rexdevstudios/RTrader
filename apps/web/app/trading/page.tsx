import React from 'react';

// Lightweight SVG Candlestick & Volume Chart Component
function CandlestickChart({ candles }: { candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> }) {
  if (!candles || candles.length === 0) {
    return <div style={{ color: '#64748b', padding: '2rem', textAlign: 'center' }}>No candle data available</div>;
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

        // Volume Bar (at bottom)
        const volHeight = (c.volume / maxVol) * 35;
        const yVol = height - padding - volHeight;

        return (
          <g key={i}>
            {/* High/Low Wick Line */}
            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.5" />
            {/* Candle Body */}
            <rect
              x={x - candleWidth * 0.35}
              y={candleTop}
              width={candleWidth * 0.7}
              height={candleBodyHeight}
              fill={color}
              rx="1"
            />
            {/* Volume Bar */}
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

export default function TradingPage() {
  const mockCandles = [
    { timestamp: 1, open: 64100, high: 64500, low: 63900, close: 64400, volume: 1200 },
    { timestamp: 2, open: 64400, high: 64600, low: 64200, close: 64300, volume: 950 },
    { timestamp: 3, open: 64300, high: 64800, low: 64150, close: 64750, volume: 1540 },
    { timestamp: 4, open: 64750, high: 64900, low: 64400, close: 64500, volume: 1100 },
    { timestamp: 5, open: 64500, high: 65200, low: 64450, close: 65150, volume: 2100 },
    { timestamp: 6, open: 65150, high: 65400, low: 64900, close: 65300, volume: 1800 },
    { timestamp: 7, open: 65300, high: 65600, low: 65100, close: 65550, volume: 2300 },
    { timestamp: 8, open: 65550, high: 65700, low: 65200, close: 65400, volume: 1400 },
  ];

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', margin: 0, color: '#38bdf8' }}>📈 Trading Terminal & Market Charting</h1>
          <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0' }}>
            Live Market Visualization • Binance Stream Listener • AI Intelligence Signal Overlay
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold' }}>
            ● LIVE STREAM CONNECTED
          </span>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        {/* Left Column: Candlestick & Volume Chart */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#f8fafc' }}>BTC/USDT — 1H Candlestick & Volume</h2>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Binance WebSocket Stream + Historical Feed</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={{ backgroundColor: '#334155', color: '#f8fafc', border: 'none', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer' }}>1M</button>
              <button style={{ backgroundColor: '#0284c7', color: '#ffffff', border: 'none', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>1H</button>
              <button style={{ backgroundColor: '#334155', color: '#f8fafc', border: 'none', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer' }}>4H</button>
              <button style={{ backgroundColor: '#334155', color: '#f8fafc', border: 'none', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer' }}>1D</button>
            </div>
          </div>

          {/* SVG Candlestick Chart */}
          <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <CandlestickChart candles={mockCandles} />
          </div>

          {/* Derived Market Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>LAST PRICE</span>
              <span style={{ color: '#34d399', fontSize: '1.1rem', fontWeight: 'bold' }}>$65,400.00</span>
            </div>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>1H VOLATILITY</span>
              <span style={{ color: '#38bdf8', fontSize: '1.1rem', fontWeight: 'bold' }}>1.42% (LOW)</span>
            </div>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>24H VOLUME</span>
              <span style={{ color: '#f8fafc', fontSize: '1.1rem', fontWeight: 'bold' }}>14,820 BTC</span>
            </div>
            <div style={{ backgroundColor: '#0f172a', padding: '0.8rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>VOLUME ANOMALY</span>
              <span style={{ color: '#a78bfa', fontSize: '1.1rem', fontWeight: 'bold' }}>NORMAL (1.1×)</span>
            </div>
          </div>
        </div>

        {/* Right Column: Intelligence Signal Overlay & Orderbook Depth */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* AI Intelligence Overlay */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem', margin: '0 0 1rem 0', color: '#c084fc' }}>
              🤖 AI Feature Engine Signal Overlay
            </h3>

            <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Computed Confidence Score</span>
                <span style={{ color: '#34d399', fontSize: '1.25rem', fontWeight: 'bold' }}>85.0%</span>
              </div>
              <div style={{ backgroundColor: '#334155', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ backgroundColor: '#34d399', height: '100%', width: '85%' }} />
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.4', marginBottom: '1rem' }}>
              <strong>Signal Rationale:</strong> Counterparty cleared by Arkham (EXCHANGE, score: 95/100) | Market volatility LOW (1.42%) | Spread normal (0.02%) | Web sentiment POSITIVE (0.78)
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                ✓ Arkham Clear
              </span>
              <span style={{ backgroundColor: '#1e40af', color: '#60a5fa', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                ✓ Firecrawl Sentiment 0.78
              </span>
              <span style={{ backgroundColor: '#374151', color: '#9ca3af', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                ✓ Volatility Low
              </span>
            </div>
          </div>

          {/* Orderbook Depth & Whale Wall Alert */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', margin: 0, color: '#f8fafc' }}>Orderbook Depth & Spread</h3>
              <span style={{ color: '#34d399', fontSize: '0.8rem', fontWeight: 'bold' }}>Spread: 0.02%</span>
            </div>

            {/* Asks (Sells) */}
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                <span>65,410.00</span>
                <span>3.80 BTC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171', fontSize: '0.85rem', padding: '0.2rem 0', backgroundColor: 'rgba(248, 113, 113, 0.1)' }}>
                <span>65,405.00 🐳</span>
                <span>15.00 BTC (Whale Wall)</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '0.25rem 0', borderTop: '1px solid #334155', borderBottom: '1px solid #334155', margin: '0.4rem 0' }}>
              ── Market Midpoint: $65,402.50 ──
            </div>

            {/* Bids (Buys) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', fontSize: '0.85rem', padding: '0.2rem 0', backgroundColor: 'rgba(52, 211, 153, 0.1)' }}>
                <span>65,400.00 🐳</span>
                <span>12.80 BTC (Whale Wall)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                <span>65,395.00</span>
                <span>4.20 BTC</span>
              </div>
            </div>
          </div>

          {/* Proposal-Only Action Panel */}
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #0284c7', borderRadius: '12px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0', color: '#38bdf8' }}>
              🛡️ Proposal-Only Execution Gate
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 1rem 0' }}>
              AI Proposal #prop-8291 requires explicit user approval. Deterministic Risk Gate will evaluate intent upon approval.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button style={{ flex: 1, backgroundColor: '#16a34a', color: '#ffffff', border: 'none', padding: '0.6rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                Approve Proposal
              </button>
              <button style={{ flex: 1, backgroundColor: '#dc2626', color: '#ffffff', border: 'none', padding: '0.6rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
