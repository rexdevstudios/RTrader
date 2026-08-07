import React from 'react';

export default function TradingPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#34d399' }}>📈 Trading Terminal</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Binance-connected trading terminal with deterministic risk gate and automated order execution.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Deterministic Risk Gate</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Max Order Cap: $10,000 | Daily Loss Limit: $1,000 | Max Slippage: 3.0%
          </p>
          <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>Enforced</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Binance Security Vault</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            AES-256-GCM encrypted API key storage. Withdrawal permissions are strictly rejected.
          </p>
          <span style={{ backgroundColor: '#1e40af', color: '#60a5fa', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>No-Withdrawal Protected</span>
        </div>
      </div>
    </div>
  );
}
