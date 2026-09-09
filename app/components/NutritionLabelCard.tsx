'use client';

import React from 'react';
import { ShieldCheck, AlertCircle, ShieldAlert, CheckCircle2 } from 'lucide-react';

export interface NutritionLabelProps {
  liquidityLocked: boolean;
  timeLockDays?: number;
  yieldStakingActive?: boolean;
  stakingApy?: number;
  autoCompounding?: boolean;
  mevProtected?: boolean;
  mintRevoked: boolean;
  creatorTrustScore: number;
  overallTier: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

export const NutritionLabelCard: React.FC<NutritionLabelProps> = ({
  liquidityLocked,
  timeLockDays,
  yieldStakingActive,
  stakingApy,
  autoCompounding = true,
  mevProtected = true,
  mintRevoked,
  creatorTrustScore,
  overallTier,
  reasons,
}) => {
  const isLow = overallTier === 'LOW';
  const isMed = overallTier === 'MEDIUM';

  const borderColor = isLow ? 'var(--color-accent, #00E676)' : isMed ? '#FFD600' : 'var(--color-destructive, #FF1744)';
  const badgeBg = isLow ? '#041E15' : isMed ? '#2A1F00' : '#2A050A';
  const textColor = isLow ? 'var(--color-accent, #00E676)' : isMed ? '#FFD600' : 'var(--color-destructive, #FF1744)';

  return (
    <div
      className="bg-panel"
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
        padding: '16px',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontWeight: 800, color: 'var(--color-foreground)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isLow ? <ShieldCheck size={16} color={textColor} /> : isMed ? <AlertCircle size={16} color={textColor} /> : <ShieldAlert size={16} color={textColor} />}
          INVESTOR NUTRITION LABEL
        </span>
        <span
          style={{
            backgroundColor: badgeBg,
            color: textColor,
            padding: '2px 8px',
            borderRadius: '4px',
            fontWeight: 800,
            fontSize: '11px',
            border: `1px solid ${borderColor}`,
          }}
        >
          {overallTier} RISK
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="text-muted">Liquidity Pool:</span>
          <span style={{ color: liquidityLocked ? 'var(--color-accent, #00E676)' : '#FFD600', fontWeight: 700 }}>
            {liquidityLocked ? 'LOCKED (100% SAFE)' : 'IN BONDING CURVE'}
          </span>
        </div>

        {timeLockDays !== undefined && timeLockDays > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-muted">Time-Lock Vault:</span>
            <span style={{ color: 'var(--color-accent, #00E676)', fontWeight: 700 }}>
              🔒 {timeLockDays} HARI TERKUNCI (ANTI-RUG)
            </span>
          </div>
        )}

        {yieldStakingActive && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-muted">Liquid Staking:</span>
            <span style={{ color: 'var(--color-accent, #00E676)', fontWeight: 700 }}>
              🌾 {stakingApy || 4.2}% APY YIELD (ACTIVE)
            </span>
          </div>
        )}

        {yieldStakingActive && autoCompounding && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-muted">Auto-Compounding:</span>
            <span style={{ color: 'var(--color-accent, #00E676)', fontWeight: 700 }}>
              🤖 WEEKLY (CHAINLINK KEEPER)
            </span>
          </div>
        )}

        {liquidityLocked && mevProtected && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-muted">MEV Protection:</span>
            <span style={{ color: 'var(--color-accent, #00E676)', fontWeight: 700 }}>
              🛡️ ACTIVE (MAX 1.5% SLIPPAGE)
            </span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="text-muted">Mint Function:</span>
          <span style={{ color: mintRevoked ? 'var(--color-accent, #00E676)' : 'var(--color-destructive, #FF1744)', fontWeight: 700 }}>
            {mintRevoked ? 'REVOKED (NO INFLATION)' : 'ACTIVE'}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="text-muted">Creator Trust Score:</span>
          <span style={{ color: creatorTrustScore >= 60 ? 'var(--color-accent, #00E676)' : '#FFD600', fontWeight: 800 }}>
            {creatorTrustScore}/100
          </span>
        </div>
      </div>

      {reasons.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', fontSize: '11px', color: 'var(--color-muted)' }}>
          {reasons.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
              <CheckCircle2 size={12} style={{ opacity: 0.6 }} />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
