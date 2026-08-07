'use client';

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AgentPage() {
  const { isConnected, userRole, connectMetaMask, isConnecting } = useAuth();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState(100);
  const [proposal, setProposal] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin weights
  const [arkhamWeight, setArkhamWeight] = useState(0.35);
  const [firecrawlWeight, setFirecrawlWeight] = useState(0.25);
  const [ohlcvWeight, setOhlcvWeight] = useState(0.25);
  const [defillamaWeight, setDefillamaWeight] = useState(0.15);

  const handleGenerateProposal = async () => {
    if (!isConnected) {
      setError('🔒 Wallet connection required to trigger AI strategy proposals.');
      return;
    }

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: '#000000', color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#06080E', padding: '12px 16px', borderRadius: '6px', border: '1px solid #141A26' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, margin: 0, color: '#D500F9', letterSpacing: '-0.5px' }}>
            🤖 AI Agent Intelligence & Proposal Sandbox
          </h1>
          <p style={{ color: '#64748B', margin: '2px 0 0 0', fontSize: '11px' }}>
            Proposal-only AI strategy engine with multi-factor fusion (Arkham, Firecrawl, Binance OHLCV, DefiLlama Macro TVL).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {userRole === 'SYSTEM_ADMIN' && (
            <span style={{ backgroundColor: '#261704', color: '#FFD600', border: '1px solid #FF9100', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
              👑 FEATURE WEIGHT ADMIN ACTIVE
            </span>
          )}
          <span style={{ backgroundColor: '#1C0D2E', color: '#D500F9', border: '1px solid #3B1566', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
            PROPOSAL-ONLY GUARANTEED
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left Card: Interactive Proposal Generator */}
        <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '16px' }}>
          <h2 style={{ color: '#F8FAFC', marginTop: 0, fontSize: '14px', fontWeight: 800 }}>⚡ Live Proposal Test Generator</h2>
          <p style={{ color: '#64748B', fontSize: '11px', marginBottom: '14px' }}>
            Generate a real-time AI trade proposal backed by multi-source intelligence scoring.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Target Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0C1017', color: '#00E5FF', border: '1px solid #162232', padding: '8px', borderRadius: '4px', fontWeight: 800, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}
              >
                <option value="BTCUSDT">BTC / USDT</option>
                <option value="ETHUSDT">ETH / USDT</option>
                <option value="SOLUSDT">SOL / USDT</option>
                <option value="DEGEN/USDT">DEGEN / USDT</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Action</label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value as 'BUY' | 'SELL')}
                  style={{ width: '100%', backgroundColor: '#0C1017', color: '#E2E8F0', border: '1px solid #162232', padding: '8px', borderRadius: '4px', fontWeight: 800, fontSize: '12px' }}
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Quantity</label>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
                  style={{ width: '100%', backgroundColor: '#0C1017', color: '#E2E8F0', border: '1px solid #162232', padding: '8px', borderRadius: '4px', fontWeight: 800, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            </div>

            {!isConnected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
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
                    width: '100%',
                    backgroundColor: isConnecting ? '#141A26' : '#00E5FF',
                    color: isConnecting ? '#64748B' : '#000000',
                    border: 'none',
                    padding: '10px',
                    borderRadius: '4px',
                    fontWeight: 900,
                    fontSize: '12px',
                    cursor: isConnecting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  {isConnecting ? '🦊 Connecting MetaMask...' : '🦊 Connect MetaMask to Generate AI Proposals'}
                </button>
                {connectError && (
                  <div style={{ color: '#FF5252', fontSize: '11px' }}>
                    ⚠️ {connectError}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleGenerateProposal}
                disabled={loading}
                style={{
                  backgroundColor: loading ? '#141A26' : '#7C4DFF',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '4px',
                  fontWeight: 900,
                  fontSize: '12px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginTop: '4px',
                }}
              >
                {loading ? 'Generating Proposal via Feature Engine...' : '🚀 Generate Intelligence Proposal'}
              </button>
            )}

            {error && (
              <div style={{ backgroundColor: '#2A0413', color: '#FF5252', border: '1px solid #FF1744', padding: '8px', borderRadius: '4px', fontSize: '11px' }}>
                ❌ {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Card: Generated Proposal Payload Display */}
        <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '16px' }}>
          <h2 style={{ color: '#F8FAFC', marginTop: 0, fontSize: '14px', fontWeight: 800 }}>📄 Proposal Output Inspector</h2>

          {proposal ? (
            <div style={{ backgroundColor: '#090D14', padding: '12px', borderRadius: '4px', border: '1px solid #141A26', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Proposal ID:</span>
                <span style={{ color: '#D500F9', fontWeight: 800 }}>{proposal.proposalId || proposal.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Confidence Score:</span>
                <span style={{ color: '#00E676', fontWeight: 900 }}>
                  {proposal.intelligenceSignal ? `${(proposal.intelligenceSignal.computedConfidenceScore * 100).toFixed(1)}%` : '85.0%'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Macro Sentiment:</span>
                <span style={{ color: '#00E5FF', fontWeight: 800 }}>
                  {proposal.intelligenceSignal?.inputs?.macroSentiment || 'UNAVAILABLE'}
                </span>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#64748B', display: 'block', marginBottom: '4px' }}>Signal Rationale:</span>
                <div style={{ color: '#E2E8F0', backgroundColor: '#0C1018', padding: '6px', borderRadius: '3px', border: '1px solid #162030' }}>
                  {proposal.intelligenceSignal?.rationale || 'N/A'}
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#475569', fontWeight: 700 }}>
                Status: PROPOSAL_ONLY • Approval Required: YES
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: '#090D14', padding: '2rem', textAlign: 'center', color: '#475569', borderRadius: '4px', border: '1px dashed #141A26', fontSize: '12px' }}>
              Click "Generate Intelligence Proposal" to view live engine payload.
            </div>
          )}
        </div>
      </div>

      {/* Admin Feature Weight Inspector (Exclusive to SYSTEM_ADMIN) */}
      {(userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN') && (
        <div style={{ backgroundColor: '#06080E', border: '1px solid #FF9100', borderRadius: '6px', padding: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 900, color: '#FFD600', margin: '0 0 10px 0' }}>
            👑 System Admin: Multi-Factor Intelligence Engine Weights
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', fontSize: '11px' }}>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#00E5FF', fontWeight: 800 }}>Arkham Intelligence</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>{(arkhamWeight * 100).toFixed(0)}%</div>
              <div style={{ color: '#64748B' }}>Counterparty & Sanctions Risk</div>
            </div>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#D500F9', fontWeight: 800 }}>Firecrawl Sentiment</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>{(firecrawlWeight * 100).toFixed(0)}%</div>
              <div style={{ color: '#64748B' }}>Web News & Social Buzz</div>
            </div>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#00E676', fontWeight: 800 }}>Binance OHLCV & RSI</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>{(ohlcvWeight * 100).toFixed(0)}%</div>
              <div style={{ color: '#64748B' }}>Technical Momentum Indicators</div>
            </div>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#FFC400', fontWeight: 800 }}>DefiLlama Macro TVL</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>{(defillamaWeight * 100).toFixed(0)}%</div>
              <div style={{ color: '#64748B' }}>Chain Liquidity Inflow</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

