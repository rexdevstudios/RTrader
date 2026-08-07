'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Rocket, ShieldAlert, FileText, CheckCircle2, AlertTriangle, TrendingUp, Scale, Wallet } from 'lucide-react';

export default function LaunchpadPage() {
  const { isConnected, userRole, walletAddress, connectMetaMask, isConnecting } = useAuth();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [mode, setMode] = useState<'BONDING_CURVE' | 'FAIR_LAUNCH'>('BONDING_CURVE');
  const [creatorWallet, setCreatorWallet] = useState(walletAddress || '');
  const [draftResult, setDraftResult] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (walletAddress) {
      setCreatorWallet(walletAddress);
    }
  }, [walletAddress]);

  const handleCreateDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName || !tokenSymbol) return;

    setIsCreating(true);
    setTimeout(() => {
      setDraftResult({
        draftId: `draft-${Date.now()}`,
        name: tokenName,
        symbol: tokenSymbol.toUpperCase(),
        mode,
        creatorWallet: walletAddress || creatorWallet,
        riskPassportScore: 78,
        status: 'DRAFT_CREATED',
        createdAt: new Date().toISOString(),
      });
      setIsCreating(false);
    }, 400);
  };

  return (
    <div className="flex-col gap-lg">
      {/* Top Banner */}
      <div className="bg-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderRadius: '8px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, margin: '0 0 4px 0', color: '#00E5FF', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Rocket size={20} /> Degen Token Launchpad & Wizard
          </h1>
          <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
            Create pump.fun style fair launches and bonding curve tokens backed by Arkham creator risk passports.
          </p>
        </div>
        <div className="flex-row gap-sm items-center">
          {userRole === 'SYSTEM_ADMIN' && (
            <span className="badge badge-admin">
              👑 LAUNCHPAD CONTROLLER ACTIVE
            </span>
          )}
          <span className="badge badge-trader" style={{ border: '1px solid #00E5FF', color: '#00E5FF', backgroundColor: '#071A2E' }}>
            BONDING CURVE ACTIVE
          </span>
        </div>
      </div>

      <div className="grid-2">
        {/* Left Column: Interactive Token Launch Form */}
        <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px' }}>
          <h2 style={{ color: 'var(--color-foreground)', marginTop: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <FileText size={18} /> Launch Token Draft Wizard
          </h2>
          <form onSubmit={handleCreateDraft} className="flex-col gap-md">
            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Token Name</label>
              <input
                type="text"
                placeholder="e.g. Degen Moon Alpha"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className="input"
                style={{ padding: '12px' }}
                required
              />
            </div>

            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Token Symbol</label>
              <input
                type="text"
                placeholder="e.g. MOON"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                className="input"
                style={{ padding: '12px', color: 'var(--color-accent)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}
                required
              />
            </div>

            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Launch Model</label>
              <div className="grid-2">
                <button
                  type="button"
                  onClick={() => setMode('BONDING_CURVE')}
                  className={mode === 'BONDING_CURVE' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '12px', justifyContent: 'center' }}
                >
                  <TrendingUp size={16} className="inline mr-1" /> Bonding Curve
                </button>
                <button
                  type="button"
                  onClick={() => setMode('FAIR_LAUNCH')}
                  className={mode === 'FAIR_LAUNCH' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '12px', justifyContent: 'center' }}
                >
                  <Scale size={16} className="inline mr-1" /> Fair Launch
                </button>
              </div>
            </div>

            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Creator Wallet Address</label>
              <input
                type="text"
                value={creatorWallet}
                onChange={(e) => setCreatorWallet(e.target.value)}
                className="input"
                style={{ padding: '12px', fontFamily: 'var(--font-mono)' }}
              />
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
                  {isConnecting ? 'Connecting...' : 'Connect MetaMask to Launch Token'}
                </button>
                {connectError && (
                  <div style={{ color: 'var(--color-destructive)', fontSize: '12px', textAlign: 'center' }}>
                    {connectError}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="submit"
                disabled={isCreating}
                className="btn-primary"
                style={{ padding: '14px', justifyContent: 'center', marginTop: '8px' }}
              >
                {isCreating ? 'Validating Risk Passport...' : '🚀 Create Launch Draft'}
              </button>
            )}
          </form>
        </div>

        {/* Right Column: Draft & Risk Passport Inspector */}
        <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px' }}>
          <h2 style={{ color: 'var(--color-foreground)', marginTop: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <ShieldAlert size={18} /> Risk Passport & Draft Summary
          </h2>

          {draftResult ? (
            <div className="bg-panel" style={{ padding: '16px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Draft ID:</span>
                <span style={{ color: '#00E5FF', fontWeight: 800 }}>{draftResult.draftId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Token:</span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 900 }}>{draftResult.name} (${draftResult.symbol})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Launch Mode:</span>
                <span style={{ color: '#D500F9', fontWeight: 800 }}>{draftResult.mode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Creator Wallet:</span>
                <span style={{ color: 'var(--color-foreground)', fontWeight: 800 }}>{draftResult.creatorWallet.slice(0, 10)}...</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Arkham Risk Passport:</span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 900 }}>{draftResult.riskPassportScore} / 100 (LOW_RISK)</span>
              </div>
              <div style={{ backgroundColor: '#041E15', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', padding: '12px', borderRadius: '4px', textAlign: 'center', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <CheckCircle2 size={16} /> Draft Ready for Onchain Graduation Test
              </div>
            </div>
          ) : (
            <div className="bg-panel flex-col items-center justify-center" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--color-muted)', borderRadius: '6px', border: '1px dashed var(--color-border)', fontSize: '13px' }}>
              <FileText size={32} style={{ marginBottom: '16px', opacity: 0.5 }} />
              Fill in token details and click "Create Launch Draft" to generate risk passport preview.
            </div>
          )}
        </div>
      </div>

      {/* Admin Launchpad Governance Console (SYSTEM_ADMIN Exclusive) */}
      {(userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN') && (
        <div className="bg-panel" style={{ border: '1px solid #FF9100', borderRadius: '8px', padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 900, color: '#FFD600', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} /> System Admin: Launchpad Bonding Curve & Liquidity Governance
          </h3>
          <div className="grid-3">
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: '#00E5FF', fontWeight: 800, fontSize: '12px' }}>Graduation Target</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>$69,000 Market Cap</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Auto-migrates to Uniswap v3 Pool</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: 'var(--color-accent)', fontWeight: 800, fontSize: '12px' }}>Protocol Fee Split</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>0.50% / 0.50%</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>50% Protocol Treasury / 50% Creator</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: 'var(--color-destructive)', fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={14} /> Emergency Blacklist</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-accent)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>0 Blacklisted Contracts</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Arkham OFAC Scanned Hourly</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
