import React from 'react';

export default function AgentPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#a78bfa' }}>🤖 AI Agent Intelligence</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Proposal-only AI strategy engine with computed intelligence confidence scores and RSI backtesting.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Proposal-Only Model</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            AI agents generate proposals with confidence scores and rationale. User approval is mandatory before trade execution.
          </p>
          <span style={{ backgroundColor: '#581c87', color: '#c084fc', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>Proposal-Only (No Direct Execution)</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Feature Engine Fusion</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Aggregates Arkham counterparty risk, Firecrawl web sentiment, and Binance orderbook/OHLCV volatility.
          </p>
          <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>Multi-Source Signals</span>
        </div>
      </div>
    </div>
  );
}
