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
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#38bdf8' }}>🚀 Degen Token Launchpad & Wizard</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Create pump.fun style fair launches and bonding curve tokens backed by Arkham creator risk passports.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left Column: Interactive Token Launch Form */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <h2 style={{ color: '#f8fafc', marginTop: 0, fontSize: '1.2rem' }}>📝 Launch Token Draft Wizard</h2>
          <form onSubmit={handleCreateDraft} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Token Name</label>
              <input
                type="text"
                placeholder="e.g. Degen Moon Alpha"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', padding: '0.6rem', borderRadius: '6px' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Token Symbol</label>
              <input
                type="text"
                placeholder="e.g. MOON"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', padding: '0.6rem', borderRadius: '6px' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Launch Model</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setMode('BONDING_CURVE')}
                  style={{
                    backgroundColor: mode === 'BONDING_CURVE' ? '#0284c7' : '#0f172a',
                    color: '#ffffff',
                    border: '1px solid #334155',
                    padding: '0.6rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  📈 Bonding Curve
                </button>
                <button
                  type="button"
                  onClick={() => setMode('FAIR_LAUNCH')}
                  style={{
                    backgroundColor: mode === 'FAIR_LAUNCH' ? '#16a34a' : '#0f172a',
                    color: '#ffffff',
                    border: '1px solid #334155',
                    padding: '0.6rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  ⚖️ Fair Launch
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Creator Wallet Address</label>
              <input
                type="text"
                value={creatorWallet}
                onChange={(e) => setCreatorWallet(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0f172a', color: '#f8fafc', border: '1px solid #334155', padding: '0.6rem', borderRadius: '6px', fontSize: '0.8rem' }}
              />
            </div>

            <button
              type="submit"
              disabled={isCreating}
              style={{
                backgroundColor: isCreating ? '#334155' : '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '0.75rem',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: isCreating ? 'not-allowed' : 'pointer',
                marginTop: '0.5rem',
              }}
            >
              {isCreating ? 'Validating Risk Passport...' : '🚀 Create Launch Draft'}
            </button>
          </form>
        </div>

        {/* Right Column: Draft & Risk Passport Inspector */}
        <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.5rem' }}>
          <h2 style={{ color: '#f8fafc', marginTop: 0, fontSize: '1.2rem' }}>🛡️ Risk Passport & Draft Summary</h2>

          {draftResult ? (
            <div style={{ backgroundColor: '#0f172a', padding: '1rem', borderRadius: '8px', border: '1px solid #334155', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Draft ID:</span>
                <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>{draftResult.draftId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Token:</span>
                <span style={{ color: '#34d399', fontWeight: 'bold' }}>{draftResult.name} (${draftResult.symbol})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Launch Mode:</span>
                <span style={{ color: '#a78bfa', fontWeight: 'bold' }}>{draftResult.mode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: '#94a3b8' }}>Arkham Risk Passport:</span>
                <span style={{ color: '#34d399', fontWeight: 'bold' }}>{draftResult.riskPassportScore} / 100 (LOW_RISK)</span>
              </div>
              <div style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.5rem', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold' }}>
                ✓ Draft Ready for Onchain Graduation Test
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: '#0f172a', padding: '2rem', textAlign: 'center', color: '#64748b', borderRadius: '8px', border: '1px dashed #334155' }}>
              Fill in token details and click "Create Launch Draft" to generate risk passport preview.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
