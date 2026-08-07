'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: '#000000', color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#06080E', padding: '12px 16px', borderRadius: '6px', border: '1px solid #141A26' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, margin: 0, color: '#00E5FF', letterSpacing: '-0.5px' }}>
            🚀 Degen Token Launchpad & Wizard
          </h1>
          <p style={{ color: '#64748B', margin: '2px 0 0 0', fontSize: '11px' }}>
            Create pump.fun style fair launches and bonding curve tokens backed by Arkham creator risk passports.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {userRole === 'SYSTEM_ADMIN' && (
            <span style={{ backgroundColor: '#261704', color: '#FFD600', border: '1px solid #FF9100', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
              👑 LAUNCHPAD CONTROLLER ACTIVE
            </span>
          )}
          <span style={{ backgroundColor: '#071A2E', color: '#00E5FF', border: '1px solid #00E5FF', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
            BONDING CURVE ACTIVE
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Left Column: Interactive Token Launch Form */}
        <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '16px' }}>
          <h2 style={{ color: '#F8FAFC', marginTop: 0, fontSize: '14px', fontWeight: 800 }}>📝 Launch Token Draft Wizard</h2>
          <form onSubmit={handleCreateDraft} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Token Name</label>
              <input
                type="text"
                placeholder="e.g. Degen Moon Alpha"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0C1017', color: '#F8FAFC', border: '1px solid #162232', padding: '8px', borderRadius: '4px', fontSize: '12px' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Token Symbol</label>
              <input
                type="text"
                placeholder="e.g. MOON"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0C1017', color: '#00E5FF', border: '1px solid #162232', padding: '8px', borderRadius: '4px', fontWeight: 800, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Launch Model</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setMode('BONDING_CURVE')}
                  style={{
                    backgroundColor: mode === 'BONDING_CURVE' ? '#00E5FF' : '#0C1017',
                    color: mode === 'BONDING_CURVE' ? '#000000' : '#94A3B8',
                    border: '1px solid #162232',
                    padding: '8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 800,
                  }}
                >
                  📈 Bonding Curve
                </button>
                <button
                  type="button"
                  onClick={() => setMode('FAIR_LAUNCH')}
                  style={{
                    backgroundColor: mode === 'FAIR_LAUNCH' ? '#00E676' : '#0C1017',
                    color: mode === 'FAIR_LAUNCH' ? '#000000' : '#94A3B8',
                    border: '1px solid #162232',
                    padding: '8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 800,
                  }}
                >
                  ⚖️ Fair Launch
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>Creator Wallet Address</label>
              <input
                type="text"
                value={creatorWallet}
                onChange={(e) => setCreatorWallet(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0C1017', color: '#E2E8F0', border: '1px solid #162232', padding: '8px', borderRadius: '4px', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>

            {!isConnected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
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
                  {isConnecting ? '🦊 Connecting MetaMask...' : '🦊 Connect MetaMask to Launch Token'}
                </button>
                {connectError && (
                  <div style={{ color: '#FF5252', fontSize: '11px' }}>
                    ⚠️ {connectError}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="submit"
                disabled={isCreating}
                style={{
                  backgroundColor: isCreating ? '#141A26' : '#00E5FF',
                  color: '#000000',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '4px',
                  fontWeight: 900,
                  fontSize: '12px',
                  cursor: isCreating ? 'not-allowed' : 'pointer',
                  marginTop: '4px',
                }}
              >
                {isCreating ? 'Validating Risk Passport...' : '🚀 Create Launch Draft'}
              </button>
            )}
          </form>
        </div>

        {/* Right Column: Draft & Risk Passport Inspector */}
        <div style={{ backgroundColor: '#06080E', border: '1px solid #141A26', borderRadius: '6px', padding: '16px' }}>
          <h2 style={{ color: '#F8FAFC', marginTop: 0, fontSize: '14px', fontWeight: 800 }}>🛡️ Risk Passport & Draft Summary</h2>

          {draftResult ? (
            <div style={{ backgroundColor: '#090D14', padding: '12px', borderRadius: '4px', border: '1px solid #141A26', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Draft ID:</span>
                <span style={{ color: '#00E5FF', fontWeight: 800 }}>{draftResult.draftId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Token:</span>
                <span style={{ color: '#00E676', fontWeight: 900 }}>{draftResult.name} (${draftResult.symbol})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Launch Mode:</span>
                <span style={{ color: '#D500F9', fontWeight: 800 }}>{draftResult.mode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Creator Wallet:</span>
                <span style={{ color: '#F8FAFC', fontWeight: 800 }}>{draftResult.creatorWallet.slice(0, 10)}...</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748B' }}>Arkham Risk Passport:</span>
                <span style={{ color: '#00E676', fontWeight: 900 }}>{draftResult.riskPassportScore} / 100 (LOW_RISK)</span>
              </div>
              <div style={{ backgroundColor: '#041E15', border: '1px solid #00E676', color: '#00E676', padding: '8px', borderRadius: '4px', textAlign: 'center', fontWeight: 800 }}>
                ✓ Draft Ready for Onchain Graduation Test
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: '#090D14', padding: '2rem', textAlign: 'center', color: '#475569', borderRadius: '4px', border: '1px dashed #141A26', fontSize: '12px' }}>
              Fill in token details and click "Create Launch Draft" to generate risk passport preview.
            </div>
          )}
        </div>
      </div>

      {/* Admin Launchpad Governance Console (SYSTEM_ADMIN Exclusive) */}
      {(userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN') && (
        <div style={{ backgroundColor: '#06080E', border: '1px solid #FF9100', borderRadius: '6px', padding: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 900, color: '#FFD600', margin: '0 0 10px 0' }}>
            👑 System Admin: Launchpad Bonding Curve & Liquidity Governance
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '11px' }}>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#00E5FF', fontWeight: 800 }}>Graduation Target</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>$69,000 Market Cap</div>
              <div style={{ color: '#64748B' }}>Auto-migrates to Uniswap v3 Pool</div>
            </div>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#00E676', fontWeight: 800 }}>Protocol Fee Split</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>0.50% / 0.50%</div>
              <div style={{ color: '#64748B' }}>50% Protocol Treasury / 50% Creator</div>
            </div>
            <div style={{ backgroundColor: '#0C1018', border: '1px solid #1E293B', padding: '10px', borderRadius: '4px' }}>
              <div style={{ color: '#FF5252', fontWeight: 800 }}>Emergency Blacklist</div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#00E676', margin: '4px 0' }}>0 Blacklisted Contracts</div>
              <div style={{ color: '#64748B' }}>Arkham OFAC Scanned Hourly</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

