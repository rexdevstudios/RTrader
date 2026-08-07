'use client';

import React, { useState } from 'react';

export default function LaunchpadPage() {
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [mode, setMode] = useState<'BONDING_CURVE' | 'FAIR_LAUNCH'>('BONDING_CURVE');
  const [creatorWallet, setCreatorWallet] = useState('0x1234567890123456789012345678901234567890');
  const [draftResult, setDraftResult] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);

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
        creatorWallet,
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
        <span style={{ backgroundColor: '#071A2E', color: '#00E5FF', border: '1px solid #00E5FF', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
          BONDING CURVE ACTIVE
        </span>
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
    </div>
  );
}
