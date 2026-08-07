'use client';

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Bot, ShieldAlert, Settings2, FileCode2, Target, BrainCircuit, Activity, BarChart3, Wallet } from 'lucide-react';

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
    <div className="flex-col gap-lg">
      {/* Top Banner */}
      <div className="bg-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderRadius: '8px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, margin: '0 0 4px 0', color: '#D500F9', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={20} /> AI Agent Intelligence & Proposal Sandbox
          </h1>
          <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
            Proposal-only AI strategy engine with multi-factor fusion (Arkham, Firecrawl, Binance OHLCV, DefiLlama Macro TVL).
          </p>
        </div>
        <div className="flex-row gap-sm items-center">
          {userRole === 'SYSTEM_ADMIN' && (
            <span className="badge badge-admin">
              👑 FEATURE WEIGHT ADMIN ACTIVE
            </span>
          )}
          <span className="badge" style={{ backgroundColor: '#1C0D2E', color: '#D500F9', border: '1px solid #3B1566' }}>
            PROPOSAL-ONLY GUARANTEED
          </span>
        </div>
      </div>

      <div className="grid-2">
        {/* Left Card: Interactive Proposal Generator */}
        <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px' }}>
          <h2 style={{ color: 'var(--color-foreground)', marginTop: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Target size={18} /> Live Proposal Test Generator
          </h2>
          <p className="text-muted" style={{ fontSize: '12px', marginBottom: '20px' }}>
            Generate a real-time AI trade proposal backed by multi-source intelligence scoring.
          </p>

          <div className="flex-col gap-md">
            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Target Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="input"
                style={{ padding: '12px', color: 'var(--color-accent)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}
              >
                <option value="BTCUSDT">BTC / USDT</option>
                <option value="ETHUSDT">ETH / USDT</option>
                <option value="SOLUSDT">SOL / USDT</option>
                <option value="DEGEN/USDT">DEGEN / USDT</option>
              </select>
            </div>

            <div className="grid-2">
              <div className="flex-col gap-xs">
                <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Action</label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value as 'BUY' | 'SELL')}
                  className="input"
                  style={{ padding: '12px', fontWeight: 800 }}
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>

              <div className="flex-col gap-xs">
                <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Quantity</label>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
                  className="input"
                  style={{ padding: '12px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            {!isConnected ? (
              <div className="flex-col gap-xs" style={{ marginTop: '8px' }}>
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
                  className="btn-primary"
                  style={{ padding: '14px', justifyContent: 'center' }}
                >
                  <Wallet size={16} />
                  {isConnecting ? 'Connecting...' : 'Connect MetaMask to Generate AI Proposals'}
                </button>
                {connectError && (
                  <div style={{ color: 'var(--color-destructive)', fontSize: '12px', textAlign: 'center' }}>
                    {connectError}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleGenerateProposal}
                disabled={loading}
                className="btn-primary"
                style={{
                  backgroundColor: loading ? 'var(--color-panel)' : '#7C4DFF',
                  borderColor: loading ? 'var(--color-border)' : '#7C4DFF',
                  padding: '14px',
                  justifyContent: 'center',
                  marginTop: '8px'
                }}
              >
                {loading ? 'Generating Proposal via Feature Engine...' : '🚀 Generate Intelligence Proposal'}
              </button>
            )}

            {error && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-destructive)', border: '1px solid var(--color-destructive)', padding: '12px', borderRadius: '6px', fontSize: '12px' }}>
                ❌ {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Card: Generated Proposal Payload Display */}
        <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px' }}>
          <h2 style={{ color: 'var(--color-foreground)', marginTop: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <FileCode2 size={18} /> Proposal Output Inspector
          </h2>

          {proposal ? (
            <div className="bg-panel" style={{ padding: '16px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Proposal ID:</span>
                <span style={{ color: '#D500F9', fontWeight: 800 }}>{proposal.proposalId || proposal.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Confidence Score:</span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 900 }}>
                  {proposal.intelligenceSignal ? `${(proposal.intelligenceSignal.computedConfidenceScore * 100).toFixed(1)}%` : '85.0%'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Macro Sentiment:</span>
                <span style={{ color: '#00E5FF', fontWeight: 800 }}>
                  {proposal.intelligenceSignal?.inputs?.macroSentiment || 'UNAVAILABLE'}
                </span>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <span className="text-muted" style={{ display: 'block', marginBottom: '8px' }}>Signal Rationale:</span>
                <div style={{ color: 'var(--color-foreground)', backgroundColor: 'var(--color-background)', padding: '12px', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
                  {proposal.intelligenceSignal?.rationale || 'N/A'}
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-muted)', fontWeight: 700, padding: '8px', backgroundColor: 'var(--color-panel)', borderRadius: '4px', textAlign: 'center' }}>
                Status: PROPOSAL_ONLY • Approval Required: YES
              </div>
            </div>
          ) : (
            <div className="bg-panel flex-col items-center justify-center" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--color-muted)', borderRadius: '6px', border: '1px dashed var(--color-border)', fontSize: '13px' }}>
              <BrainCircuit size={32} style={{ marginBottom: '16px', opacity: 0.5 }} />
              Click "Generate Intelligence Proposal" to view live engine payload.
            </div>
          )}
        </div>
      </div>

      {/* Admin Feature Weight Inspector (Exclusive to SYSTEM_ADMIN) */}
      {(userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN') && (
        <div className="bg-panel" style={{ border: '1px solid #FF9100', borderRadius: '8px', padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 900, color: '#FFD600', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings2 size={18} /> System Admin: Multi-Factor Intelligence Engine Weights
          </h3>
          <div className="grid-4">
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: '#00E5FF', fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><ShieldAlert size={14} /> Arkham Intelligence</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>{(arkhamWeight * 100).toFixed(0)}%</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Counterparty & Sanctions Risk</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: '#D500F9', fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={14} /> Firecrawl Sentiment</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>{(firecrawlWeight * 100).toFixed(0)}%</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Web News & Social Buzz</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: 'var(--color-accent)', fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><BarChart3 size={14} /> Binance OHLCV & RSI</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>{(ohlcvWeight * 100).toFixed(0)}%</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Technical Momentum Indicators</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: '#FFC400', fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={14} /> DefiLlama Macro TVL</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>{(defillamaWeight * 100).toFixed(0)}%</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Chain Liquidity Inflow</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
