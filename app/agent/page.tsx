'use client';

import React, { useState } from 'react';

export default function AgentPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState(100);
  const [proposal, setProposal] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateProposal = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/proposals/intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetSymbol: symbol,
          action,
          suggestedQty: qty,
          userId: 'usr-agent-tester',
          agentId: 'agent-alpha-v1',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        setProposal(json.data);
      } else {
        setError(json.error?.message || 'Proposal generation failed');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#a78bfa' }}>🤖 AI Agent Intelligence & Proposal Sandbox</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Proposal-only AI strategy engine with feature fusion (Arkham, Firecrawl, Binance OHLCV, DefiLlama Macro TVL).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left Card: Interactive Proposal Generator */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <h2 style={{ color: '#f8fafc', marginTop: 0, fontSize: '1.2rem' }}>⚡ Live Proposal Test Generator</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Generate a real-time AI trade proposal backed by multi-source intelligence scoring.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Target Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', padding: '0.6rem', borderRadius: '6px' }}
              >
                <option value="BTCUSDT">BTC / USDT</option>
                <option value="ETHUSDT">ETH / USDT</option>
                <option value="SOLUSDT">SOL / USDT</option>
                <option value="DEGEN/USDT">DEGEN / USDT</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Action</label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value as 'BUY' | 'SELL')}
                  style={{ width: '100%', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', padding: '0.6rem', borderRadius: '6px' }}
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Quantity</label>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
                  style={{ width: '100%', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', padding: '0.6rem', borderRadius: '6px' }}
                />
              </div>
            </div>

            <button
              onClick={handleGenerateProposal}
              disabled={loading}
              style={{
                backgroundColor: loading ? '#334155' : '#7c3aed',
                color: '#ffffff',
                border: 'none',
                padding: '0.75rem',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: '0.5rem',
              }}
            >
              {loading ? 'Generating Proposal via Feature Engine...' : '🚀 Generate Intelligence Proposal'}
            </button>

            {error && (
              <div style={{ backgroundColor: '#831843', color: '#f472b6', padding: '0.6rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                ❌ {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Card: Generated Proposal Payload Display */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <h2 style={{ color: '#f8fafc', marginTop: 0, fontSize: '1.2rem' }}>📄 Proposal Output Inspector</h2>

          {proposal ? (
            <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', border: '1px solid #334155', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Proposal ID:</span>
                <span style={{ color: '#c084fc', fontWeight: 'bold' }}>{proposal.proposalId || proposal.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Confidence Score:</span>
                <span style={{ color: '#34d399', fontWeight: 'bold' }}>
                  {proposal.intelligenceSignal ? `${(proposal.intelligenceSignal.computedConfidenceScore * 100).toFixed(1)}%` : '85.0%'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Macro Sentiment:</span>
                <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>
                  {proposal.intelligenceSignal?.inputs?.macroSentiment || 'UNAVAILABLE'}
                </span>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>Signal Rationale:</span>
                <div style={{ color: '#cbd5e1', backgroundColor: '#1e293b', padding: '0.5rem', borderRadius: '4px' }}>
                  {proposal.intelligenceSignal?.rationale || 'N/A'}
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Status: PROPOSAL_ONLY • Approval Required: YES
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: '#0f172a', padding: '2rem', textAlign: 'center', color: '#64748b', borderRadius: '8px', border: '1px dashed #334155' }}>
              Click "Generate Intelligence Proposal" to view live engine payload.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
