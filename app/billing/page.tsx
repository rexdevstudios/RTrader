import React from 'react';

export default function BillingPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#fbbf24' }}>💳 Billing & Payment Rails</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Multi-channel payment billing engine supporting Stripe subscriptions, wallet credit ledger, and automated dRPC onchain settlement.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Free Degen</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>100 Credits/mo | Paper Trading & Basic Launchpad View</p>
          <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38bdf8' }}>$0 / mo</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Token Creator</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>2,000 Credits/mo | Token Wizard & Fair Launch</p>
          <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38bdf8' }}>$29 / mo</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Pro Terminal Trader</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>5,000 Credits/mo | Binance Live Trading & WS Sync</p>
          <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38bdf8' }}>$99 / mo</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>AI Autonomous Agent</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>15,000 Credits/mo | Firecrawl, Arkham, & RSI Backtest</p>
          <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38bdf8' }}>$299 / mo</span>
        </div>
      </div>
    </div>
  );
}
