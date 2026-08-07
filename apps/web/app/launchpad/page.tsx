import React from 'react';

export default function LaunchpadPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#38bdf8' }}>🚀 Degen Token Launchpad</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Create and explore pump.fun style fair launches and bonding curve tokens with automated risk passport scoring.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Fair Launch Mode</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Transparent 100% community allocation with anti-bot per-wallet caps and liquidity lock.
          </p>
          <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>Active</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Bonding Curve Mode</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Linear price curve graduating to DEX pair liquidity once raised threshold is met.
          </p>
          <span style={{ backgroundColor: '#1e40af', color: '#60a5fa', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>Active</span>
        </div>

        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '1.5rem' }}>
          <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Launch Risk Passport</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Arkham wallet profiling + Firecrawl whitepaper sentiment scoring for creator verification.
          </p>
          <span style={{ backgroundColor: '#831843', color: '#f472b6', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>Automated Risk Score</span>
        </div>
      </div>
    </div>
  );
}
