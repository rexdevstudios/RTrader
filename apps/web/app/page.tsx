import React from 'react';

export default function OverviewPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0' }}>Platform Overview & Entitlement Dashboard</h1>
        <p style={{ color: '#94A3B8', margin: 0 }}>Operational SSOT: Neon Serverless PostgreSQL | 100% Native dRPC Infrastructure</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Launchpad Domain</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#38BDF8' }}>5 Modes Ready</div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>Bonding Curve, Fair Launch, Fixed Price</div>
        </div>

        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Trading Risk Gate</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#4ADE80' }}>Slippage Cap &le; 3%</div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>Non-withdrawal Binance Vault Active</div>
        </div>

        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>AI Agent Domain</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#A78BFA' }}>Proposal-Only Invariant</div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>Daytona Sandbox Container Isolated</div>
        </div>

        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Crypto Billing Rail</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#FACC15' }}>Auto-Validation 12 Blk</div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>dRPC Onchain Verification Active</div>
        </div>
      </div>
    </div>
  );
}
